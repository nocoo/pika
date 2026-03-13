/**
 * Driver registry.
 *
 * Auto-detects available coding agent sources on disk and constructs
 * the active driver set. Only drivers whose source directories exist
 * are included.
 *
 * The registry returns:
 * - `fileDrivers`: File-based drivers (Claude, Codex, Gemini, OpenCode JSON, VSCode Copilot)
 * - `dbDrivers`: DB-based drivers (OpenCode SQLite)
 * - `discoverOpts`: Resolved paths for driver discovery
 *
 * Usage:
 *   const { fileDrivers, dbDrivers, discoverOpts } = await buildDriverSet();
 *   for (const driver of fileDrivers) {
 *     const files = await driver.discover(discoverOpts);
 *     // ... process each file
 *   }
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FileCursorBase } from "@pika/core";
import type { FileDriver, DiscoverOpts, SyncContext } from "./types.js";
import { claudeSessionDriver } from "./session/claude.js";
import { codexSessionDriver } from "./session/codex.js";
import { geminiSessionDriver } from "./session/gemini.js";
import { createOpenCodeJsonDriver } from "./session/opencode.js";
import { vscodeCopilotSessionDriver } from "./session/vscode-copilot.js";

// ---------------------------------------------------------------------------
// Default paths (macOS)
// ---------------------------------------------------------------------------

export interface DefaultPaths {
  claudeDir: string;
  codexSessionsDir: string;
  geminiDir: string;
  openCodeDir: string;
  vscodeCopilotDirs: string[];
}

/**
 * Resolve default source directories for the current platform.
 *
 * All paths are absolute, using the current user's home directory.
 * Currently macOS-only; Linux paths would differ for VSCode Copilot.
 */
export function resolveDefaultPaths(home?: string): DefaultPaths {
  const h = home ?? homedir();

  return {
    claudeDir: join(h, ".claude"),
    codexSessionsDir: join(h, ".codex", "sessions"),
    geminiDir: join(h, ".gemini"),
    openCodeDir: join(h, ".local", "share", "opencode"),
    vscodeCopilotDirs: [
      join(h, "Library", "Application Support", "Code", "User"),
      join(h, "Library", "Application Support", "Code - Insiders", "User"),
    ],
  };
}

// ---------------------------------------------------------------------------
// Existence probing
// ---------------------------------------------------------------------------

/** Check if a path exists (file or directory). */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Driver set
// ---------------------------------------------------------------------------

export interface DriverSet {
  /** File-based drivers whose source directories exist. */
  fileDrivers: FileDriver<FileCursorBase>[];

  /**
   * DB-based drivers.
   *
   * Currently only OpenCode SQLite. The caller is responsible for
   * providing the SQLite binding (bun:sqlite or better-sqlite3).
   * If the DB file exists, the registry signals readiness but does NOT
   * construct the driver instance (it needs runtime deps).
   */
  dbDriversAvailable: boolean;

  /** Resolved discovery options for file drivers. */
  discoverOpts: DiscoverOpts;

  /** Resolved default paths (for callers that need them, e.g. for DB path). */
  paths: DefaultPaths;
}

/**
 * Build the active driver set by probing the filesystem.
 *
 * Checks each source directory and only includes drivers whose
 * directories exist. This avoids unnecessary work during sync.
 *
 * @param overrides - Override default paths (useful for testing).
 * @param syncCtx - Shared sync context for cross-driver communication (OpenCode dedup).
 */
export async function buildDriverSet(
  overrides?: Partial<DefaultPaths>,
  syncCtx?: SyncContext,
): Promise<DriverSet> {
  const paths = { ...resolveDefaultPaths(), ...overrides };

  // Probe all source directories in parallel
  const [
    claudeExists,
    codexExists,
    geminiExists,
    openCodeExists,
    openCodeDbExists,
    ...vscodeDirExists
  ] = await Promise.all([
    exists(paths.claudeDir),
    exists(paths.codexSessionsDir),
    exists(paths.geminiDir),
    exists(paths.openCodeDir),
    exists(join(paths.openCodeDir, "opencode.db")),
    ...paths.vscodeCopilotDirs.map((d) => exists(d)),
  ]);

  // Build discover opts with only existing paths
  const discoverOpts: DiscoverOpts = {};

  if (claudeExists) discoverOpts.claudeDir = paths.claudeDir;
  if (codexExists) discoverOpts.codexSessionsDir = paths.codexSessionsDir;
  if (geminiExists) discoverOpts.geminiDir = paths.geminiDir;

  if (openCodeExists) {
    discoverOpts.openCodeMessageDir = join(
      paths.openCodeDir,
      "storage",
      "message",
    );
  }

  if (openCodeDbExists) {
    discoverOpts.openCodeDbPath = join(paths.openCodeDir, "opencode.db");
  }

  // Filter VSCode dirs to only those that exist
  const activeVscodeDirs = paths.vscodeCopilotDirs.filter(
    (_, i) => vscodeDirExists[i],
  );
  if (activeVscodeDirs.length > 0) {
    discoverOpts.vscodeCopilotDirs = activeVscodeDirs;
  }

  // Build file driver list
  const fileDrivers: FileDriver<FileCursorBase>[] = [];

  if (claudeExists) fileDrivers.push(claudeSessionDriver);
  if (codexExists) fileDrivers.push(codexSessionDriver);
  if (geminiExists) fileDrivers.push(geminiSessionDriver);
  if (openCodeExists) fileDrivers.push(createOpenCodeJsonDriver(syncCtx));
  if (activeVscodeDirs.length > 0) {
    fileDrivers.push(vscodeCopilotSessionDriver);
  }

  return {
    fileDrivers,
    dbDriversAvailable: openCodeDbExists,
    discoverOpts,
    paths,
  };
}
