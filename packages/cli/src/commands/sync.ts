import { defineCommand } from "citty";
import { join } from "node:path";
import consola from "consola";
import { CONFIG_DIR } from "@pika/core";
import { ConfigManager } from "../config/manager";
import { CursorStore } from "../storage/cursor-store";
import { buildDriverSet } from "../drivers/registry";
import type { SyncContext } from "../drivers/types";
import { runSyncPipeline } from "./sync-pipeline";

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
  },
  async run({ args }) {
    const isDev = args.dev as boolean;
    const doUpload = args.upload as boolean;

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
    const syncCtx: SyncContext = {
      dirMtimes: cursorState.dirMtimes ? { ...cursorState.dirMtimes } : undefined,
    };
    const driverSet = await buildDriverSet(undefined, syncCtx);

    if (driverSet.fileDrivers.length === 0 && !driverSet.dbDriversAvailable) {
      consola.info("No AI tool sessions found");
      return;
    }

    consola.start(
      `Syncing ${driverSet.fileDrivers.length} source(s)...`,
    );

    // Run pipeline
    const result = await runSyncPipeline(
      {
        fileDrivers: driverSet.fileDrivers,
        discoverOpts: driverSet.discoverOpts,
        cursorState,
        syncCtx,
      },
      {
        upload: doUpload,
        apiUrl: config.getApiUrl(),
        apiKey: config.getToken() ?? "",
        userId: config.getDeviceId(),
        },
    );

    // Save cursor state
    await cursorStore.save(result.cursorState);

    // Report results
    consola.success(
      `Parsed ${result.totalParsed} session(s) from ${result.totalFiles} file(s) (${result.totalSkipped} unchanged)`,
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
      consola.warn(
        `${result.parseErrors.length} parse error(s) in this run`,
      );
    }
  },
});
