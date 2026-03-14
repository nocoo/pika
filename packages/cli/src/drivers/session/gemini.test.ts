/**
 * Tests for Gemini CLI session driver.
 *
 * Covers: discover, shouldSkip, resumeState, parse, buildCursor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GeminiCursor, ParseResult } from "@pika/core";
import type { GeminiParseResult } from "../../parsers/gemini";
import type { FileFingerprint } from "../../utils/file-changed";
import { geminiSessionDriver } from "./gemini";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSession(
  messages: unknown[],
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    sessionId: "test-session-id",
    projectHash: "abc123def456",
    startTime: "2025-01-15T10:00:00.000Z",
    lastUpdated: "2025-01-15T10:05:00.000Z",
    messages,
    ...overrides,
  });
}

function userMsg(text: string, ts: string): unknown {
  return {
    id: `user-${Date.now()}`,
    timestamp: ts,
    type: "user",
    content: [{ text }],
  };
}

function geminiMsg(
  content: string,
  ts: string,
  model = "gemini-3-flash-preview",
  tokens?: { input: number; output: number; cached: number },
): unknown {
  return {
    id: `gemini-${Date.now()}`,
    timestamp: ts,
    type: "gemini",
    content,
    model,
    tokens: tokens ?? { input: 100, output: 20, cached: 0, thoughts: 0, tool: 0, total: 120 },
    toolCalls: [],
    thoughts: [],
  };
}

const fp = (overrides: Partial<FileFingerprint> = {}): FileFingerprint => ({
  inode: 12345,
  mtimeMs: 1700000000000,
  size: 4096,
  ...overrides,
});

function makeGeminiCursor(
  overrides: Partial<GeminiCursor> = {},
): GeminiCursor {
  return {
    inode: 12345,
    mtimeMs: 1700000000000,
    size: 4096,
    messageIndex: 0,
    lastTotalTokens: 0,
    lastModel: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// discover()
// ---------------------------------------------------------------------------

describe("geminiSessionDriver.discover", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-driver-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when geminiDir is absent", async () => {
    const files = await geminiSessionDriver.discover({});
    expect(files).toEqual([]);
  });

  it("returns empty array when geminiDir does not exist", async () => {
    const files = await geminiSessionDriver.discover({
      geminiDir: join(tmpDir, "nonexistent"),
    });
    expect(files).toEqual([]);
  });

  it("returns empty array when tmp dir does not exist", async () => {
    // geminiDir exists but has no tmp/ subdirectory
    const files = await geminiSessionDriver.discover({ geminiDir: tmpDir });
    expect(files).toEqual([]);
  });

  it("discovers session-*.json files under tmp/*/chats/", async () => {
    const chatsDir = join(tmpDir, "tmp", "abc123hash", "chats");
    await mkdir(chatsDir, { recursive: true });
    await writeFile(
      join(chatsDir, "session-2025-01-15T10-00-abc123.json"),
      buildSession([]),
    );
    await writeFile(join(chatsDir, "other.json"), "{}");
    await writeFile(join(chatsDir, "session.txt"), "ignored");

    const files = await geminiSessionDriver.discover({ geminiDir: tmpDir });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/session-.*\.json$/);
  });

  it("discovers files across multiple project hash directories", async () => {
    const dir1 = join(tmpDir, "tmp", "hash1", "chats");
    const dir2 = join(tmpDir, "tmp", "hash2", "chats");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(
      join(dir1, "session-2025-01-15T10-00-aaa.json"),
      buildSession([]),
    );
    await writeFile(
      join(dir2, "session-2025-01-16T10-00-bbb.json"),
      buildSession([]),
    );

    const files = await geminiSessionDriver.discover({ geminiDir: tmpDir });
    expect(files).toHaveLength(2);
  });

  it("ignores non-session JSON files", async () => {
    const chatsDir = join(tmpDir, "tmp", "abc123", "chats");
    await mkdir(chatsDir, { recursive: true });
    await writeFile(join(chatsDir, "config.json"), "{}");
    await writeFile(join(chatsDir, "metadata.json"), "{}");

    const files = await geminiSessionDriver.discover({ geminiDir: tmpDir });
    expect(files).toEqual([]);
  });

  it("handles project dir without chats subdirectory", async () => {
    const projectDir = join(tmpDir, "tmp", "abc123");
    await mkdir(projectDir, { recursive: true });
    // No chats/ subdirectory

    const files = await geminiSessionDriver.discover({ geminiDir: tmpDir });
    expect(files).toEqual([]);
  });

  it("ignores files directly in tmp/ (not in project dirs)", async () => {
    const tmpSubDir = join(tmpDir, "tmp");
    await mkdir(tmpSubDir, { recursive: true });
    await writeFile(
      join(tmpSubDir, "session-stray.json"),
      buildSession([]),
    );

    const files = await geminiSessionDriver.discover({ geminiDir: tmpDir });
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shouldSkip()
// ---------------------------------------------------------------------------

describe("geminiSessionDriver.shouldSkip", () => {
  it("returns false when cursor is undefined (first scan)", () => {
    expect(geminiSessionDriver.shouldSkip(undefined, fp())).toBe(false);
  });

  it("returns true when inode + mtimeMs + size all match", () => {
    const cursor = makeGeminiCursor();
    expect(geminiSessionDriver.shouldSkip(cursor, fp())).toBe(true);
  });

  it("returns false when inode differs", () => {
    const cursor = makeGeminiCursor({ inode: 99999 });
    expect(geminiSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when mtimeMs differs", () => {
    const cursor = makeGeminiCursor({ mtimeMs: 9999999999999 });
    expect(geminiSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when size differs", () => {
    const cursor = makeGeminiCursor({ size: 9999 });
    expect(geminiSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resumeState()
// ---------------------------------------------------------------------------

describe("geminiSessionDriver.resumeState", () => {
  it("returns index 0 with empty state when cursor is undefined", () => {
    const resume = geminiSessionDriver.resumeState(undefined, fp());
    expect(resume).toEqual({
      kind: "array-index",
      startIndex: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
  });

  it("returns cursor index + cumulative state when inode matches", () => {
    const cursor = makeGeminiCursor({
      messageIndex: 10,
      lastTotalTokens: 500,
      lastModel: "gemini-3-pro",
    });
    const resume = geminiSessionDriver.resumeState(
      cursor,
      fp({ size: 8192 }),
    );
    expect(resume).toEqual({
      kind: "array-index",
      startIndex: 10,
      lastTotalTokens: 500,
      lastModel: "gemini-3-pro",
    });
  });

  it("returns index 0 when inode differs (file replaced)", () => {
    const cursor = makeGeminiCursor({
      inode: 99999,
      messageIndex: 10,
      lastTotalTokens: 500,
    });
    const resume = geminiSessionDriver.resumeState(cursor, fp());
    expect(resume).toEqual({
      kind: "array-index",
      startIndex: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
  });

  it("returns index 0 when file shrunk (re-written)", () => {
    const cursor = makeGeminiCursor({
      size: 8192,
      messageIndex: 10,
    });
    const resume = geminiSessionDriver.resumeState(
      cursor,
      fp({ size: 1024 }),
    );
    expect(resume).toEqual({
      kind: "array-index",
      startIndex: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe("geminiSessionDriver.parse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-parse-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a simple Gemini session file", async () => {
    const chatsDir = join(tmpDir, "tmp", "hash1", "chats");
    await mkdir(chatsDir, { recursive: true });
    const filePath = join(chatsDir, "session-2025-01-15T10-00-abc123.json");
    await writeFile(
      filePath,
      buildSession([
        userMsg("Hello Gemini", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi there!", "2025-01-15T10:00:01.000Z"),
      ]),
    );

    const results = await geminiSessionDriver.parse(filePath, {
      kind: "array-index",
      startIndex: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("gemini:test-session-id");
    expect(results[0].canonical.source).toBe("gemini-cli");
    expect(results[0].canonical.messages).toHaveLength(2);
  });

  it("handles incremental parsing from startIndex", async () => {
    const filePath = join(tmpDir, "session.json");
    await writeFile(
      filePath,
      buildSession([
        userMsg("First", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Reply 1", "2025-01-15T10:00:01.000Z"),
        userMsg("Second", "2025-01-15T10:00:02.000Z"),
        geminiMsg("Reply 2", "2025-01-15T10:00:03.000Z"),
      ]),
    );

    const results = await geminiSessionDriver.parse(filePath, {
      kind: "array-index",
      startIndex: 2,
      lastTotalTokens: 0,
      lastModel: null,
    });
    expect(results).toHaveLength(1);
    // Full canonical snapshot: all 4 messages
    expect(results[0].canonical.messages).toHaveLength(4);
    expect(results[0].canonical.messages[0].content).toBe("First");
  });

  it("returns result with empty messages for empty file", async () => {
    const filePath = join(tmpDir, "empty.json");
    await writeFile(filePath, "");

    const results = await geminiSessionDriver.parse(filePath, {
      kind: "array-index",
      startIndex: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(0);
  });

  it("returns result for missing file", async () => {
    const results = await geminiSessionDriver.parse(
      join(tmpDir, "nonexistent.json"),
      { kind: "array-index", startIndex: 0, lastTotalTokens: 0, lastModel: null },
    );
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildCursor()
// ---------------------------------------------------------------------------

describe("geminiSessionDriver.buildCursor", () => {
  it("builds cursor with fingerprint and totals from result", () => {
    const fingerprint = fp({ size: 8192 });
    const results: GeminiParseResult[] = [
      {
        canonical: {
          sessionKey: "gemini:test",
          source: "gemini-cli",
          parserRevision: 1,
          schemaVersion: 1,
          startedAt: "2025-01-15T10:00:00Z",
          lastMessageAt: "2025-01-15T10:05:00Z",
          durationSeconds: 300,
          projectRef: null,
          projectName: null,
          model: "gemini-3-flash-preview",
          title: null,
          messages: [
            { role: "user", content: "Hello", timestamp: "2025-01-15T10:00:00Z" },
            { role: "assistant", content: "Hi!", timestamp: "2025-01-15T10:00:01Z" },
          ],
          totalInputTokens: 500,
          totalOutputTokens: 200,
          totalCachedTokens: 50,
          snapshotAt: "2025-01-15T10:05:00Z",
        },
        raw: {
          sessionKey: "gemini:test",
          source: "gemini-cli",
          parserRevision: 1,
          collectedAt: "2025-01-15T10:05:00Z",
          sourceFiles: [],
        },
        // Source had 3 messages (user, gemini, info) but canonical only has 2
        sourceMessageCount: 3,
      },
    ];

    const cursor = geminiSessionDriver.buildCursor(fingerprint, results);
    expect(cursor.inode).toBe(12345);
    expect(cursor.mtimeMs).toBe(1700000000000);
    expect(cursor.size).toBe(8192);
    expect(cursor.messageIndex).toBe(3); // source message count, not canonical
    expect(cursor.lastTotalTokens).toBe(700); // 500 + 200
    expect(cursor.lastModel).toBe("gemini-3-flash-preview");
    expect(cursor.updatedAt).toBeDefined();
  });

  it("builds cursor with zero values when no results", () => {
    const fingerprint = fp({ size: 1024 });
    const cursor = geminiSessionDriver.buildCursor(fingerprint, []);
    expect(cursor.messageIndex).toBe(0);
    expect(cursor.lastTotalTokens).toBe(0);
    expect(cursor.lastModel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// source property
// ---------------------------------------------------------------------------

describe("geminiSessionDriver.source", () => {
  it("has source set to gemini-cli", () => {
    expect(geminiSessionDriver.source).toBe("gemini-cli");
  });
});
