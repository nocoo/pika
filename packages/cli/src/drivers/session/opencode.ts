/**
 * OpenCode JSON file session driver.
 *
 * Strategy: Per-file triple-check + message-dir mtime.
 *
 * Discovery: ~/.local/share/opencode/storage/session/{projectId}/ses_*.json
 * Change detection: inode+mtimeMs+size per session file
 *                   + message/{sessionId}/ dir mtime (catches new messages)
 * Resume: full re-parse (OpenCode sessions are small JSON files, not append logs)
 * Parser: parseOpenCodeJsonSession(sessionJsonPath, messageDir, partDir)
 *
 * After parsing, deposits session state into SyncContext.openCodeSessionState
 * for SQLite driver cross-source dedup.
 */

import { readdir, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import type { OpenCodeCursor, ParseResult } from "@pika/core";
import { fileUnchanged } from "../../utils/file-changed";
import { parseOpenCodeJsonSession } from "../../parsers/opencode";
import type {
  FileDriver,
  DiscoverOpts,
  OpenCodeJsonResumeState,
  FileFingerprint,
  SyncContext,
} from "../types";

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
 * Also stat `message/{sessionId}/` for each discovered session file and
 * store the mtime in ctx.openCodeMsgDirMtimes so that shouldSkip() can
 * detect new messages even when the session JSON itself is unchanged.
 *
 * Note: We intentionally do NOT use a dir-mtime skip optimization for
 * the project dirs. Session JSON content changes (e.g. time.updated)
 * and new messages in message/ subdirs do not update the parent
 * directory's mtime, so skipping readdir based on dir mtime would
 * cause changed sessions to be missed. readdir on small directories
 * is cheap; per-file shouldSkip() provides the real optimization.
 */
async function discoverOpenCodeJsonFiles(
  messageDir: string,
  ctx?: SyncContext,
  inodeToFilePath?: Map<number, string>,
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
  const msgDirMtimes: Record<string, number> = {};

  for (const projEntry of projectDirs) {
    if (!projEntry.isDirectory()) continue;

    const projDir = join(sessionDir, projEntry.name);

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
        const filePath = join(projDir, fileEntry.name);
        results.push(filePath);

        // Stat the session file to populate inode→filePath map for shouldSkip
        if (inodeToFilePath) {
          try {
            const fileStat = await stat(filePath);
            inodeToFilePath.set(fileStat.ino, filePath);
          } catch {
            // File may have been deleted between readdir and stat
          }
        }

        // Stat message/{sessionId}/ to detect new messages.
        // Session filename is `{sessionId}.json`, strip `.json` for dir name.
        const sessionId = basename(fileEntry.name, ".json");
        const sessionMsgDir = join(messageDir, sessionId);
        try {
          const msgStat = await stat(sessionMsgDir);
          msgDirMtimes[filePath] = msgStat.mtimeMs;
        } catch {
          // No message dir yet — session has no messages
        }
      }
    }
  }

  // Store message dir mtimes in context for shouldSkip() and buildCursor()
  if (ctx) {
    ctx.openCodeMsgDirMtimes = msgDirMtimes;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

/**
 * Create an OpenCode JSON file driver.
 *
 * Accepts an optional SyncContext for message-dir mtime tracking and
 * cross-source session state sharing.
 */
export function createOpenCodeJsonDriver(
  syncCtx?: SyncContext,
): FileDriver<OpenCodeCursor> {
  // Internal map: inode → filePath, populated during discover().
  // Enables shouldSkip() to look up message dir mtime by filePath
  // when it only receives a FileFingerprint (which contains inode).
  const inodeToFilePath = new Map<number, string>();

  return {
    source: "opencode",

    async discover(opts: DiscoverOpts): Promise<string[]> {
      if (!opts.openCodeMessageDir) return [];
      inodeToFilePath.clear();
      return discoverOpenCodeJsonFiles(
        opts.openCodeMessageDir,
        syncCtx,
        inodeToFilePath,
      );
    },

    shouldSkip(
      cursor: OpenCodeCursor | undefined,
      fingerprint: FileFingerprint,
    ): boolean {
      // Session file itself must be unchanged
      if (!fileUnchanged(cursor, fingerprint)) return false;

      // Even when the session JSON file is unchanged, new messages may
      // have arrived in message/{sessionId}/. Check the message dir
      // mtime recorded during discover() against the cursor's saved value.
      if (cursor && syncCtx?.openCodeMsgDirMtimes) {
        const filePath = inodeToFilePath.get(fingerprint.inode);
        if (filePath) {
          const currentMsgMtime = syncCtx.openCodeMsgDirMtimes[filePath];

          // If cursor lacks messageDirMtimeMs (old cursor format), re-parse
          if (cursor.messageDirMtimeMs === undefined) return false;

          // If message dir mtime changed, re-parse
          if (currentMsgMtime !== undefined && currentMsgMtime !== cursor.messageDirMtimeMs) {
            return false;
          }

          // If message dir appeared (didn't exist before, exists now), re-parse
          if (cursor.messageDirMtimeMs === undefined && currentMsgMtime !== undefined) {
            return false;
          }
        }
      }

      return true;
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
      // Look up message dir mtime from discover() context
      const filePath = inodeToFilePath.get(fingerprint.inode);
      const messageDirMtimeMs =
        filePath && syncCtx?.openCodeMsgDirMtimes
          ? syncCtx.openCodeMsgDirMtimes[filePath]
          : undefined;

      return {
        inode: fingerprint.inode,
        mtimeMs: fingerprint.mtimeMs,
        size: fingerprint.size,
        messageDirMtimeMs,
        updatedAt: new Date().toISOString(),
      };
    },
  };
}
