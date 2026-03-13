/**
 * OpenCode JSON file session driver.
 *
 * Strategy: Dir mtime optimization + per-file triple-check.
 *
 * Discovery: ~/.local/share/opencode/storage/session/{projectId}/ses_*.json
 * Change detection: session-dir mtime (fast skip) + inode+mtimeMs+size per file
 * Resume: full re-parse (OpenCode sessions are small JSON files, not append logs)
 * Parser: parseOpenCodeJsonSession(sessionJsonPath, messageDir, partDir)
 *
 * After parsing, deposits session state into SyncContext.openCodeSessionState
 * for SQLite driver cross-source dedup.
 */

import { readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { OpenCodeCursor, ParseResult } from "@pika/core";
import { fileUnchanged } from "../../utils/file-changed.js";
import { parseOpenCodeJsonSession } from "../../parsers/opencode.js";
import type {
  FileDriver,
  DiscoverOpts,
  OpenCodeJsonResumeState,
  FileFingerprint,
  SyncContext,
} from "../types.js";

// ---------------------------------------------------------------------------
// Discovery: find ses_*.json files under {storageDir}/session/*/
// ---------------------------------------------------------------------------

/**
 * Discover OpenCode session JSON files.
 *
 * Layout: {openCodeMessageDir}/../session/{projectId}/ses_*.json
 * The DiscoverOpts.openCodeMessageDir points to the message dir;
 * we derive the session/part dirs as siblings.
 *
 * Dir mtime optimization: if a project dir's mtime matches the cached value,
 * skip the readdir entirely — no files in that dir have been added/removed.
 * Per-file shouldSkip() will catch content changes on the next round.
 */
async function discoverOpenCodeJsonFiles(
  messageDir: string,
  ctx?: SyncContext,
): Promise<string[]> {
  const storageDir = dirname(messageDir); // storage/
  const sessionDir = join(storageDir, "session");

  try {
    await stat(sessionDir);
  } catch {
    return [];
  }

  let projectDirs;
  try {
    projectDirs = await readdir(sessionDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  const prevDirMtimes = ctx?.dirMtimes ?? {};
  const newDirMtimes: Record<string, number> = {};

  for (const projEntry of projectDirs) {
    if (!projEntry.isDirectory()) continue;

    const projDir = join(sessionDir, projEntry.name);

    let dirStat;
    try {
      dirStat = await stat(projDir);
    } catch {
      continue;
    }

    const dirMtime = dirStat.mtimeMs;
    newDirMtimes[projDir] = dirMtime;

    // Dir mtime optimization: if mtime unchanged, skip readdir.
    // No files added/removed/renamed in this dir since last scan.
    if (prevDirMtimes[projDir] === dirMtime) {
      continue;
    }

    let sessionFiles;
    try {
      sessionFiles = await readdir(projDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of sessionFiles) {
      if (
        fileEntry.isFile() &&
        fileEntry.name.startsWith("ses_") &&
        fileEntry.name.endsWith(".json")
      ) {
        results.push(join(projDir, fileEntry.name));
      }
    }
  }

  // Update dirMtimes in context for persistence
  if (ctx) {
    ctx.dirMtimes = newDirMtimes;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

/**
 * Create an OpenCode JSON file driver.
 *
 * Accepts an optional SyncContext for dir-mtime optimization and
 * cross-source session state sharing.
 */
export function createOpenCodeJsonDriver(
  syncCtx?: SyncContext,
): FileDriver<OpenCodeCursor> {
  return {
    source: "opencode",

    async discover(opts: DiscoverOpts): Promise<string[]> {
      if (!opts.openCodeMessageDir) return [];
      return discoverOpenCodeJsonFiles(opts.openCodeMessageDir, syncCtx);
    },

    shouldSkip(
      cursor: OpenCodeCursor | undefined,
      fingerprint: FileFingerprint,
    ): boolean {
      return fileUnchanged(cursor, fingerprint);
    },

    resumeState(
      _cursor: OpenCodeCursor | undefined,
      _fingerprint: FileFingerprint,
    ): OpenCodeJsonResumeState {
      // OpenCode JSON files are complete snapshots (not append logs).
      // Always full re-parse if not skipped by shouldSkip.
      return { kind: "opencode-json" };
    },

    async parse(
      filePath: string,
      _resume: OpenCodeJsonResumeState,
    ): Promise<ParseResult[]> {
      // Derive storage dirs from the session file path
      // Session file: storage/session/{projectId}/ses_*.json
      // Message dir:  storage/message/
      // Part dir:     storage/part/
      const sessionDir = dirname(filePath);         // storage/session/{projectId}
      const projectSessionDir = dirname(sessionDir); // storage/session
      const storageDir = dirname(projectSessionDir);  // storage
      const messageDir = join(storageDir, "message");
      const partDir = join(storageDir, "part");

      const result = await parseOpenCodeJsonSession(
        filePath,
        messageDir,
        partDir,
      );

      // Deposit session state for SQLite driver cross-source dedup
      if (syncCtx) {
        if (!syncCtx.openCodeSessionState) {
          syncCtx.openCodeSessionState = new Map();
        }
        syncCtx.openCodeSessionState.set(result.canonical.sessionKey, {
          lastMessageAt: result.canonical.lastMessageAt,
          totalMessages: result.canonical.messages.length,
        });
      }

      return [result];
    },

    buildCursor(
      fingerprint: FileFingerprint,
      _results: ParseResult[],
    ): OpenCodeCursor {
      return {
        inode: fingerprint.inode,
        mtimeMs: fingerprint.mtimeMs,
        size: fingerprint.size,
        updatedAt: new Date().toISOString(),
      };
    },
  };
}
