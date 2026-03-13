/**
 * VSCode Copilot session driver.
 *
 * Strategy: CRDT replay with incremental request-level dedup.
 *
 * Discovery: Walk vscodeCopilotDirs[] for:
 *   - workspaceStorage/{hash}/chatSessions/*.jsonl  (workspace sessions)
 *   - globalStorage/emptyWindowChatSessions/*.jsonl  (global sessions)
 *
 * Change detection: inode + mtimeMs + size triple-check
 * Resume: byte-offset + processedRequestIds (CRDT must replay from start,
 *   but only new requests are extracted as messages)
 * Parser: parseVscodeCopilotFile(filePath, startOffset, processedRequestIds, workspaceFolder)
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { VscodeCopilotCursor, ParseResult } from "@pika/core";
import { fileUnchanged } from "../../utils/file-changed.js";
import {
  parseVscodeCopilotFile,
  extractWorkspaceFolder,
  type VscodeCopilotParseResult,
} from "../../parsers/vscode-copilot.js";
import type {
  FileDriver,
  DiscoverOpts,
  VscodeCopilotResumeState,
  FileFingerprint,
} from "../types.js";

// ---------------------------------------------------------------------------
// Discovery helpers
// ---------------------------------------------------------------------------

/**
 * Collect .jsonl files from a single directory (non-recursive).
 * Returns empty array if dir does not exist or is unreadable.
 */
async function collectJsonl(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

/**
 * Discover VSCode Copilot session files under a single base directory.
 *
 * Scans two locations:
 * 1. workspaceStorage/{hash}/chatSessions/*.jsonl
 * 2. globalStorage/emptyWindowChatSessions/*.jsonl
 */
async function discoverInBaseDir(baseDir: string): Promise<string[]> {
  const results: string[] = [];

  // 1. Workspace sessions: workspaceStorage/*/chatSessions/*.jsonl
  const wsDir = join(baseDir, "workspaceStorage");
  try {
    const wsDirEntries = await readdir(wsDir, { withFileTypes: true });
    for (const entry of wsDirEntries) {
      if (!entry.isDirectory()) continue;
      const chatDir = join(wsDir, entry.name, "chatSessions");
      const files = await collectJsonl(chatDir);
      results.push(...files);
    }
  } catch {
    // workspaceStorage doesn't exist — skip
  }

  // 2. Global sessions: globalStorage/emptyWindowChatSessions/*.jsonl
  const globalDir = join(
    baseDir,
    "globalStorage",
    "emptyWindowChatSessions",
  );
  const globalFiles = await collectJsonl(globalDir);
  results.push(...globalFiles);

  return results;
}

// ---------------------------------------------------------------------------
// State shared between parse() and buildCursor()
// ---------------------------------------------------------------------------

/**
 * Cached newRequestIds from the most recent parse() call.
 *
 * The FileDriver interface requires parse() to return ParseResult[],
 * but the cursor needs newRequestIds from VscodeCopilotParseResult.
 * We store them here as a side channel, consumed by buildCursor().
 *
 * This is safe because the driver loop is sequential:
 *   parse(file) → buildCursor(file) → next file
 */
let lastNewRequestIds: string[] = [];
let lastProcessedRequestIds: string[] = [];

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export const vscodeCopilotSessionDriver: FileDriver<VscodeCopilotCursor> = {
  source: "vscode-copilot",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.vscodeCopilotDirs || opts.vscodeCopilotDirs.length === 0) {
      return [];
    }

    const results: string[] = [];
    for (const baseDir of opts.vscodeCopilotDirs) {
      const files = await discoverInBaseDir(baseDir);
      results.push(...files);
    }
    return results;
  },

  shouldSkip(
    cursor: VscodeCopilotCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(
    cursor: VscodeCopilotCursor | undefined,
    fingerprint: FileFingerprint,
  ): VscodeCopilotResumeState {
    // No cursor or different inode → full scan
    if (!cursor || cursor.inode !== fingerprint.inode) {
      return { kind: "vscode-copilot", startOffset: 0, processedRequestIds: [] };
    }

    // File shrunk → full re-scan (file was re-written)
    if (cursor.offset > fingerprint.size) {
      return { kind: "vscode-copilot", startOffset: 0, processedRequestIds: [] };
    }

    // Resume from where we left off
    return {
      kind: "vscode-copilot",
      startOffset: cursor.offset,
      processedRequestIds: cursor.processedRequestIds,
    };
  },

  async parse(
    filePath: string,
    resume: VscodeCopilotResumeState,
  ): Promise<ParseResult[]> {
    // Pre-resolve workspace folder (avoids redundant fs reads inside parser)
    const workspaceFolder = await extractWorkspaceFolder(filePath);

    const result: VscodeCopilotParseResult = await parseVscodeCopilotFile(
      filePath,
      resume.startOffset,
      resume.processedRequestIds,
      workspaceFolder,
    );

    // Stash for buildCursor()
    lastNewRequestIds = result.newRequestIds;
    lastProcessedRequestIds = resume.processedRequestIds;

    // If no messages were extracted, return empty
    if (result.canonical.messages.length === 0) return [];

    return [result];
  },

  buildCursor(
    fingerprint: FileFingerprint,
    _results: ParseResult[],
  ): VscodeCopilotCursor {
    // Merge previous + new request IDs
    const allIds = [...lastProcessedRequestIds, ...lastNewRequestIds];

    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: fingerprint.size, // next resume = end of file
      processedRequestIds: allIds,
      updatedAt: new Date().toISOString(),
    };
  },
};
