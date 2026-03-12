/**
 * Codex CLI session driver.
 *
 * Strategy: Byte-offset incremental parsing of one-file-per-session JSONL.
 *
 * Discovery: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * Change detection: inode + mtimeMs + size triple-check
 * Resume: byte-offset + cumulative token totals (for diff computation)
 * Parser: parseCodexFile(filePath, startOffset) -> single ParseResult
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CodexCursor, ParseResult } from "@pika/core";
import { fileUnchanged } from "../../utils/file-changed.js";
import { parseCodexFile } from "../../parsers/codex.js";
import type {
  FileDriver,
  DiscoverOpts,
  CodexResumeState,
  FileFingerprint,
} from "../types.js";

// ---------------------------------------------------------------------------
// Discovery: find rollout-*.jsonl files under {codexSessionsDir}/
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree recursively, collecting files matching a filter.
 * Returns early (empty) if the directory does not exist or is unreadable.
 */
async function walkFiltered(
  dir: string,
  results: string[],
  filter: (name: string) => boolean,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiltered(fullPath, results, filter);
    } else if (entry.isFile() && filter(entry.name)) {
      results.push(fullPath);
    }
  }
}

async function discoverCodexFiles(
  codexSessionsDir: string,
): Promise<string[]> {
  try {
    await stat(codexSessionsDir);
  } catch {
    return [];
  }

  const results: string[] = [];
  await walkFiltered(codexSessionsDir, results, (name) =>
    name.startsWith("rollout-") && name.endsWith(".jsonl"),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export const codexSessionDriver: FileDriver<CodexCursor> = {
  source: "codex",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.codexSessionsDir) return [];
    return discoverCodexFiles(opts.codexSessionsDir);
  },

  shouldSkip(
    cursor: CodexCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(
    cursor: CodexCursor | undefined,
    fingerprint: FileFingerprint,
  ): CodexResumeState {
    // No cursor or different inode -> full re-scan from offset 0
    if (!cursor || cursor.inode !== fingerprint.inode) {
      return { kind: "codex", startOffset: 0, lastTotalTokens: 0, lastModel: null };
    }

    // File shrunk -> re-scan (file was re-written/truncated)
    if (cursor.offset > fingerprint.size) {
      return { kind: "codex", startOffset: 0, lastTotalTokens: 0, lastModel: null };
    }

    // Resume from where we left off, carrying cumulative state
    return {
      kind: "codex",
      startOffset: cursor.offset,
      lastTotalTokens: cursor.lastTotalTokens,
      lastModel: cursor.lastModel,
    };
  },

  async parse(
    filePath: string,
    resume: CodexResumeState,
  ): Promise<ParseResult[]> {
    const result = await parseCodexFile(filePath, resume.startOffset);
    // parseCodexFile returns a single ParseResult (one session per file)
    // Return as array for the FileDriver interface
    return [result];
  },

  buildCursor(
    fingerprint: FileFingerprint,
    results: ParseResult[],
  ): CodexCursor {
    // Extract cumulative token totals and model from the parse result
    let lastTotalTokens = 0;
    let lastModel: string | null = null;

    if (results.length > 0) {
      const session = results[0].canonical;
      lastTotalTokens =
        session.totalInputTokens + session.totalOutputTokens;
      lastModel = session.model;
    }

    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: fingerprint.size, // next resume point = end of file
      lastTotalTokens,
      lastModel,
      updatedAt: new Date().toISOString(),
    };
  },
};
