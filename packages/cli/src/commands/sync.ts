import { basename, join } from "node:path";
import type { OpenCodeSqliteCursor } from "@pika/core";
import { CONFIG_DIR, SOURCES } from "@pika/core";
import { defineCommand } from "citty";
import consola from "consola";
import { ConfigManager } from "../config/manager";
import type { DriverSet } from "../drivers/registry";
import { buildDriverSet } from "../drivers/registry";
import type { OpenDbFn } from "../drivers/session/opencode-sqlite";
import { createOpenCodeSqliteDriver } from "../drivers/session/opencode-sqlite";
import type { DbDriver, SyncContext } from "../drivers/types";
import { CursorStore } from "../storage/cursor-store";
import type { SyncProgressLogger } from "./sync-pipeline";
import { runSyncPipeline } from "./sync-pipeline";

// ── DB driver construction (extracted for testability) ────────

/**
 * Construct the OpenCode SQLite DB driver when available.
 *
 * Extracted from the command handler so the wiring decision is testable
 * independently of the full CLI lifecycle (citty, config, cursors, etc.).
 *
 * @param openDbOverride — inject OpenDbFn for testing (avoids bun:sqlite import)
 */
export async function buildDbDriver(
  driverSet: DriverSet,
  openDbOverride?: OpenDbFn,
): Promise<DbDriver<OpenCodeSqliteCursor> | undefined> {
  if (!driverSet.dbDriversAvailable || !driverSet.discoverOpts.openCodeDbPath) {
    return undefined;
  }

  let openDb: OpenDbFn;
  if (openDbOverride) {
    openDb = openDbOverride;
  } else {
    // bun:sqlite is a Bun built-in with no TS type declarations.
    // Use a variable so tsc doesn't try to resolve the module specifier.
    // Runtime type safety is enforced by the OpenDbFn contract.
    const modId = "bun:sqlite";
    const bunSqlite = await import(modId);
    openDb = (path, opts) =>
      new bunSqlite.Database(path, { readonly: opts?.readonly ?? true });
  }

  return createOpenCodeSqliteDriver(
    openDb,
    driverSet.discoverOpts.openCodeDbPath,
  );
}

export default defineCommand({
  meta: {
    name: "sync",
    description: "Parse local sessions and upload to Pika",
  },
  args: {
    upload: {
      type: "boolean",
      default: true,
      description: "Upload parsed sessions (default: true)",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
    source: {
      type: "string",
      description: `Filter sources (comma-separated). Valid: ${SOURCES.join(", ")}`,
    },
  },
  async run({ args }) {
    const isDev = args.dev as boolean;
    const doUpload = args.upload as boolean;

    // Parse --source filter
    let sourceFilter: Set<string> | undefined;
    if (args.source) {
      const requested = (args.source as string).split(",").map((s) => s.trim());
      const invalid = requested.filter(
        (s) => !(SOURCES as readonly string[]).includes(s),
      );
      if (invalid.length > 0) {
        consola.error(
          `Unknown source(s): ${invalid.join(", ")}. Valid: ${SOURCES.join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }
      sourceFilter = new Set(requested);
      consola.info(`Filtering to source(s): ${requested.join(", ")}`);
    }

    // Load config
    const configDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? "~",
      ".config",
      CONFIG_DIR,
    );
    const config = new ConfigManager(configDir, isDev);

    if (doUpload && !config.isLoggedIn()) {
      consola.error("Not logged in. Run: pika login");
      process.exitCode = 1;
      return;
    }

    // Load cursor state
    const cursorStore = new CursorStore(configDir);
    const cursorState = await cursorStore.load();

    // Build driver set
    const syncCtx: SyncContext = {};
    const driverSet = await buildDriverSet(undefined, syncCtx, sourceFilter);

    if (driverSet.fileDrivers.length === 0 && !driverSet.dbDriversAvailable) {
      consola.info("No AI tool sessions found");
      return;
    }

    // Construct SQLite driver when DB is available
    const dbDriver = await buildDbDriver(driverSet);

    const sourceCount = driverSet.fileDrivers.length + (dbDriver ? 1 : 0);
    consola.start(`Syncing ${sourceCount} source(s)...`);

    // Build progress logger backed by consola
    const logger: SyncProgressLogger = {
      discoverStart(source) {
        consola.info(`  [${source}] Scanning...`);
      },
      discoverDone(source, fileCount) {
        consola.info(`  [${source}] Found ${fileCount} file(s)`);
      },
      parseDone(source, filePath, sessionCount) {
        consola.info(
          `  [${source}] Parsed ${sessionCount} session(s) from ${basename(filePath)}`,
        );
      },
      uploadMetadataStart(sessionCount) {
        consola.info(`Uploading metadata for ${sessionCount} session(s)...`);
      },
      uploadMetadataDone(ingested, conflicts) {
        const parts = [`${ingested} ingested`];
        if (conflicts > 0) parts.push(`${conflicts} conflicts`);
        consola.info(`Metadata upload done: ${parts.join(", ")}`);
      },
      uploadContentStart(sessionCount) {
        consola.info(`Uploading content for ${sessionCount} session(s)...`);
      },
      uploadContentProgress(done, total) {
        consola.info(`  Content: ${done}/${total}`);
      },
      uploadContentDone(uploaded, skipped, errors) {
        const parts = [`${uploaded} uploaded`, `${skipped} skipped`];
        if (errors > 0) parts.push(`${errors} errors`);
        consola.info(`Content upload done: ${parts.join(", ")}`);
      },
      dbDriverStart(source) {
        consola.info(`  [${source}] Querying database...`);
      },
      dbDriverDone(source, sessionCount) {
        consola.info(`  [${source}] Found ${sessionCount} session(s) from DB`);
      },
    };

    // Run pipeline
    const result = await runSyncPipeline(
      {
        fileDrivers: driverSet.fileDrivers,
        dbDriver,
        discoverOpts: driverSet.discoverOpts,
        cursorState,
        syncCtx,
      },
      {
        upload: doUpload,
        apiUrl: config.getApiUrl(),
        apiKey: config.getToken() ?? "",
        userId: "cli", // server overrides with authenticated userId from X-User-Id header
        logger,
      },
    );

    // Save cursor state
    await cursorStore.save(result.cursorState);

    // Report results
    consola.success(
      `Parsed ${result.totalParsed} session(s) from ${result.totalFiles} file(s) (${result.totalSkipped} unchanged${result.totalEmpty > 0 ? `, ${result.totalEmpty} empty skipped` : ""})`,
    );

    if (result.uploadResult) {
      consola.success(
        `Uploaded ${result.uploadResult.totalIngested} session(s) in ${result.uploadResult.totalBatches} batch(es)`,
      );
      if (result.uploadResult.totalConflicts > 0) {
        consola.warn(
          `${result.uploadResult.totalConflicts} session(s) had version conflicts (skipped)`,
        );
      }
    }

    if (result.contentResult) {
      consola.success(
        `Content: ${result.contentResult.uploaded} uploaded, ${result.contentResult.skipped} skipped`,
      );
      if (result.contentResult.errors.length > 0) {
        consola.warn(
          `${result.contentResult.errors.length} content upload error(s)`,
        );
      }
    }

    if (result.parseErrors.length > 0) {
      consola.warn(`${result.parseErrors.length} parse error(s) in this run`);
    }
  },
});
