/**
 * Gemini CLI session driver.
 *
 * Strategy: Array-index incremental parsing of JSON session files.
 *
 * Discovery: ~/.gemini/tmp/{projectHash}/chats/session-*.json
 * Change detection: inode + mtimeMs + size triple-check
 * Resume: array index into messages[] + cumulative token state
 * Parser: parseGeminiFile(filePath, startIndex) -> single ParseResult
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GeminiCursor, ParseResult } from "@pika/core";
import { fileUnchanged } from "../../utils/file-changed";
import { parseGeminiFile } from "../../parsers/gemini";
import type {
  FileDriver,
  DiscoverOpts,
  ArrayIndexResumeState,
  FileFingerprint,
} from "../types";

// ---------------------------------------------------------------------------
// Discovery: find session-*.json files under {geminiDir}/tmp/*/chats/
// ---------------------------------------------------------------------------

async function discoverGeminiFiles(
  geminiDir: string,
): Promise<string[]> {
  const tmpDir = join(geminiDir, "tmp");

  try {
    await stat(tmpDir);
  } catch {
    return [];
  }

  const results: string[] = [];

  // Walk tmp/ for project hash directories
  let projectDirs;
  try {
    projectDirs = await readdir(tmpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const projEntry of projectDirs) {
    if (!projEntry.isDirectory()) continue;

    const chatsDir = join(tmpDir, projEntry.name, "chats");
    let chatFiles;
    try {
      chatFiles = await readdir(chatsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const chatEntry of chatFiles) {
      if (
        chatEntry.isFile() &&
        chatEntry.name.startsWith("session-") &&
        chatEntry.name.endsWith(".json")
      ) {
        results.push(join(chatsDir, chatEntry.name));
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export const geminiSessionDriver: FileDriver<GeminiCursor> = {
  source: "gemini-cli",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.geminiDir) return [];
    return discoverGeminiFiles(opts.geminiDir);
  },

  shouldSkip(
    cursor: GeminiCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(
    cursor: GeminiCursor | undefined,
    fingerprint: FileFingerprint,
  ): ArrayIndexResumeState {
    // No cursor or different inode -> full re-scan from index 0
    if (!cursor || cursor.inode !== fingerprint.inode) {
      return {
        kind: "array-index",
        startIndex: 0,
        lastTotalTokens: 0,
        lastModel: null,
      };
    }

    // File shrunk -> re-scan (file was re-written/truncated)
    if (cursor.size > fingerprint.size) {
      return {
        kind: "array-index",
        startIndex: 0,
        lastTotalTokens: 0,
        lastModel: null,
      };
    }

    // Resume from where we left off, carrying cumulative state
    return {
      kind: "array-index",
      startIndex: cursor.messageIndex,
      lastTotalTokens: cursor.lastTotalTokens,
      lastModel: cursor.lastModel,
    };
  },

  async parse(
    filePath: string,
    resume: ArrayIndexResumeState,
  ): Promise<ParseResult[]> {
    const result = await parseGeminiFile(filePath, resume.startIndex);
    return [result];
  },

  buildCursor(
    fingerprint: FileFingerprint,
    results: ParseResult[],
  ): GeminiCursor {
    let lastTotalTokens = 0;
    let lastModel: string | null = null;
    let messageIndex = 0;

    if (results.length > 0) {
      const session = results[0].canonical;
      lastTotalTokens =
        session.totalInputTokens + session.totalOutputTokens;
      lastModel = session.model;
      // Count all messages (user + assistant + tool) to determine next index
      // For Gemini, we need the source messages count, not canonical messages
      // Approximate: the canonical messages correspond to processed source messages
      messageIndex = session.messages.length;
    }

    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      messageIndex,
      lastTotalTokens,
      lastModel,
      updatedAt: new Date().toISOString(),
    };
  },
};
