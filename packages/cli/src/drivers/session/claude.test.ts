/**
 * Tests for Claude Code session driver.
 *
 * Covers: discover, shouldSkip, resumeState, parse, buildCursor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ClaudeCursor } from "@pika/core";
import type { FileFingerprint } from "../../utils/file-changed";
import { claudeSessionDriver } from "./claude";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLine(
  sessionId: string,
  type: "user" | "assistant",
  content: string,
  ts: string,
  extra: Record<string, unknown> = {},
): string {
  if (type === "user") {
    return JSON.stringify({
      type: "user",
      sessionId,
      timestamp: ts,
      message: { role: "human", content },
      ...extra,
    });
  }
  return JSON.stringify({
    type: "assistant",
    sessionId,
    timestamp: ts,
    message: {
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: content }],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
    },
    ...extra,
  });
}

const fp = (overrides: Partial<FileFingerprint> = {}): FileFingerprint => ({
  inode: 12345,
  mtimeMs: 1700000000000,
  size: 4096,
  ...overrides,
});

// ---------------------------------------------------------------------------
// discover()
// ---------------------------------------------------------------------------

describe("claudeSessionDriver.discover", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-claude-driver-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when claudeDir is absent", async () => {
    const files = await claudeSessionDriver.discover({});
    expect(files).toEqual([]);
  });

  it("returns empty array when claudeDir does not exist", async () => {
    const files = await claudeSessionDriver.discover({
      claudeDir: join(tmpDir, "nonexistent"),
    });
    expect(files).toEqual([]);
  });

  it("discovers .jsonl files under projects/", async () => {
    const projectDir = join(tmpDir, "projects", "-Users-test-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "session.jsonl"), "{}");
    await writeFile(join(projectDir, "other.txt"), "ignored");

    const files = await claudeSessionDriver.discover({ claudeDir: tmpDir });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/session\.jsonl$/);
  });

  it("discovers multiple .jsonl files across project dirs", async () => {
    const dir1 = join(tmpDir, "projects", "-Users-test-project1");
    const dir2 = join(tmpDir, "projects", "-Users-test-project2");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir1, "a.jsonl"), "{}");
    await writeFile(join(dir2, "b.jsonl"), "{}");

    const files = await claudeSessionDriver.discover({ claudeDir: tmpDir });
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("a.jsonl"))).toBe(true);
    expect(files.some((f) => f.endsWith("b.jsonl"))).toBe(true);
  });

  it("discovers .jsonl files in nested subdirectories", async () => {
    const nested = join(tmpDir, "projects", "-Users-test", "sub", "deep");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "session.jsonl"), "{}");

    const files = await claudeSessionDriver.discover({ claudeDir: tmpDir });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/session\.jsonl$/);
  });
});

// ---------------------------------------------------------------------------
// shouldSkip()
// ---------------------------------------------------------------------------

describe("claudeSessionDriver.shouldSkip", () => {
  it("returns false when cursor is undefined (first scan)", () => {
    expect(claudeSessionDriver.shouldSkip(undefined, fp())).toBe(false);
  });

  it("returns true when inode + mtimeMs + size all match", () => {
    const cursor: ClaudeCursor = {
      inode: 12345,
      mtimeMs: 1700000000000,
      size: 4096,
      offset: 100,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(claudeSessionDriver.shouldSkip(cursor, fp())).toBe(true);
  });

  it("returns false when inode differs", () => {
    const cursor: ClaudeCursor = {
      inode: 99999,
      mtimeMs: 1700000000000,
      size: 4096,
      offset: 100,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(claudeSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when mtimeMs differs", () => {
    const cursor: ClaudeCursor = {
      inode: 12345,
      mtimeMs: 9999999999999,
      size: 4096,
      offset: 100,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(claudeSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when size differs", () => {
    const cursor: ClaudeCursor = {
      inode: 12345,
      mtimeMs: 1700000000000,
      size: 9999,
      offset: 100,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(claudeSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resumeState()
// ---------------------------------------------------------------------------

describe("claudeSessionDriver.resumeState", () => {
  it("returns offset 0 when cursor is undefined (first scan)", () => {
    const resume = claudeSessionDriver.resumeState(undefined, fp());
    expect(resume).toEqual({ kind: "byte-offset", startOffset: 0 });
  });

  it("returns cursor offset when file is same inode (appended data)", () => {
    const cursor: ClaudeCursor = {
      inode: 12345,
      mtimeMs: 1700000000000,
      size: 2048,
      offset: 2048,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const resume = claudeSessionDriver.resumeState(
      cursor,
      fp({ size: 4096 }),
    );
    expect(resume).toEqual({ kind: "byte-offset", startOffset: 2048 });
  });

  it("returns offset 0 when inode differs (file rotated)", () => {
    const cursor: ClaudeCursor = {
      inode: 99999,
      mtimeMs: 1700000000000,
      size: 2048,
      offset: 2048,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const resume = claudeSessionDriver.resumeState(cursor, fp());
    expect(resume).toEqual({ kind: "byte-offset", startOffset: 0 });
  });

  it("returns offset 0 when file shrunk (re-written)", () => {
    const cursor: ClaudeCursor = {
      inode: 12345,
      mtimeMs: 1700000000000,
      size: 8192,
      offset: 8192,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    // Current file is smaller than cursor offset
    const resume = claudeSessionDriver.resumeState(
      cursor,
      fp({ size: 1024 }),
    );
    expect(resume).toEqual({ kind: "byte-offset", startOffset: 0 });
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe("claudeSessionDriver.parse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-claude-parse-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a simple conversation file", async () => {
    const filePath = join(tmpDir, "session.jsonl");
    const lines = [
      makeLine("ses-1", "user", "Hello", "2024-01-01T00:00:00.000Z"),
      makeLine("ses-1", "assistant", "Hi!", "2024-01-01T00:00:01.000Z"),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const results = await claudeSessionDriver.parse(filePath, {
      kind: "byte-offset",
      startOffset: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("claude:ses-1");
    expect(results[0].canonical.messages).toHaveLength(2);
  });

  it("handles incremental parsing from byte offset", async () => {
    const filePath = join(tmpDir, "session.jsonl");
    const line1 = makeLine("ses-1", "user", "First", "2024-01-01T00:00:00.000Z");
    const line2 = makeLine("ses-1", "assistant", "Reply1", "2024-01-01T00:00:01.000Z");
    const line3 = makeLine("ses-1", "user", "Second", "2024-01-01T00:00:02.000Z");
    const line4 = makeLine("ses-1", "assistant", "Reply2", "2024-01-01T00:00:03.000Z");

    // Write initial lines
    const firstChunk = line1 + "\n" + line2 + "\n";
    await writeFile(filePath, firstChunk);
    const offset = Buffer.byteLength(firstChunk, "utf8");

    // Append more lines
    const secondChunk = line3 + "\n" + line4 + "\n";
    await writeFile(filePath, firstChunk + secondChunk);

    // Parse from offset should only get the second chunk
    const results = await claudeSessionDriver.parse(filePath, {
      kind: "byte-offset",
      startOffset: offset,
    });
    expect(results).toHaveLength(1);
    // Only the 2 messages from second chunk
    expect(results[0].canonical.messages).toHaveLength(2);
  });

  it("handles multi-session files", async () => {
    const filePath = join(tmpDir, "multi.jsonl");
    const lines = [
      makeLine("ses-A", "user", "Hello A", "2024-01-01T00:00:00.000Z"),
      makeLine("ses-A", "assistant", "Hi A!", "2024-01-01T00:00:01.000Z"),
      makeLine("ses-B", "user", "Hello B", "2024-01-01T00:00:02.000Z"),
      makeLine("ses-B", "assistant", "Hi B!", "2024-01-01T00:00:03.000Z"),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const results = await claudeSessionDriver.parse(filePath, {
      kind: "byte-offset",
      startOffset: 0,
    });
    expect(results).toHaveLength(2);
    const keys = results.map((r) => r.canonical.sessionKey).sort();
    expect(keys).toEqual(["claude:ses-A", "claude:ses-B"]);
  });

  it("returns empty array for empty file", async () => {
    const filePath = join(tmpDir, "empty.jsonl");
    await writeFile(filePath, "");

    const results = await claudeSessionDriver.parse(filePath, {
      kind: "byte-offset",
      startOffset: 0,
    });
    expect(results).toEqual([]);
  });

  it("returns empty array for missing file", async () => {
    const results = await claudeSessionDriver.parse(
      join(tmpDir, "nonexistent.jsonl"),
      { kind: "byte-offset", startOffset: 0 },
    );
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCursor()
// ---------------------------------------------------------------------------

describe("claudeSessionDriver.buildCursor", () => {
  it("builds cursor with fingerprint and offset = file size", () => {
    const fingerprint = fp({ size: 8192 });
    const cursor = claudeSessionDriver.buildCursor(fingerprint, []);
    expect(cursor.inode).toBe(12345);
    expect(cursor.mtimeMs).toBe(1700000000000);
    expect(cursor.size).toBe(8192);
    expect(cursor.offset).toBe(8192);
    expect(cursor.updatedAt).toBeDefined();
    expect(new Date(cursor.updatedAt).getTime()).toBeGreaterThan(0);
  });

  it("sets offset to fingerprint size regardless of results", () => {
    const fingerprint = fp({ size: 1024 });
    // Even with results, offset should be the file size (end of file)
    const cursor = claudeSessionDriver.buildCursor(fingerprint, []);
    expect(cursor.offset).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// Integration: source property
// ---------------------------------------------------------------------------

describe("claudeSessionDriver.source", () => {
  it("has source set to claude-code", () => {
    expect(claudeSessionDriver.source).toBe("claude-code");
  });
});
