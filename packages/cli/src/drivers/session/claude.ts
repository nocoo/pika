/**
 * Claude Code session driver.
 *
 * Strategy: Byte-offset incremental parsing of JSONL files.
 *
 * Discovery: ~/.claude/projects/ ** /*.jsonl
 * Change detection: inode + mtimeMs + size triple-check
 * Resume: byte-offset into JSONL file (appended data only)
 * Parser: parseClaudeFileMulti(filePath, startOffset)
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudeCursor, ParseResult } from "@pika/core";
import { fileUnchanged } from "../../utils/file-changed";
import { parseClaudeFileMulti } from "../../parsers/claude";
import type {
  FileDriver,
  DiscoverOpts,
  ByteOffsetResumeState,
  FileFingerprint,
} from "../types";

// ---------------------------------------------------------------------------
// Discovery: find all .jsonl files under {claudeDir}/projects/
// ---------------------------------------------------------------------------

async function discoverClaudeFiles(claudeDir: string): Promise<string[]> {
  const projectsDir = join(claudeDir, "projects");

  try {
    await stat(projectsDir);
  } catch {
    return [];
  }

  const results: string[] = [];
  await walkJsonl(projectsDir, results);
  return results;
}

/** Recursively collect .jsonl files from a directory tree */
async function walkJsonl(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export const claudeSessionDriver: FileDriver<ClaudeCursor> = {
  source: "claude-code",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.claudeDir) return [];
    return discoverClaudeFiles(opts.claudeDir);
  },

  shouldSkip(
    cursor: ClaudeCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(
    cursor: ClaudeCursor | undefined,
    fingerprint: FileFingerprint,
  ): ByteOffsetResumeState {
    // No cursor or different inode → full re-scan from offset 0
    if (!cursor || cursor.inode !== fingerprint.inode) {
      return { kind: "byte-offset", startOffset: 0 };
    }

    // File shrunk → re-scan (file was re-written/truncated)
    if (cursor.offset > fingerprint.size) {
      return { kind: "byte-offset", startOffset: 0 };
    }

    // Resume from where we left off
    return { kind: "byte-offset", startOffset: cursor.offset };
  },

  async parse(
    filePath: string,
    resume: ByteOffsetResumeState,
  ): Promise<ParseResult[]> {
    return parseClaudeFileMulti(filePath, resume.startOffset);
  },

  buildCursor(
    fingerprint: FileFingerprint,
    _results: ParseResult[],
  ): ClaudeCursor {
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: fingerprint.size, // next resume point = end of file
      updatedAt: new Date().toISOString(),
    };
  },
};
