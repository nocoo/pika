/**
 * Tests for Codex CLI session driver.
 *
 * Covers: discover, shouldSkip, resumeState, parse, buildCursor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CodexCursor, ParseResult } from "@pika/core";
import type { FileFingerprint } from "../../utils/file-changed.js";
import { codexSessionDriver } from "./codex.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a session_meta JSONL line */
function sessionMeta(
  id: string,
  cwd: string,
  ts: string,
): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: ts,
    payload: { id, cwd, model_provider: "openai", timestamp: ts },
  });
}

/** Build a turn_context JSONL line */
function turnContext(model: string, cwd?: string): string {
  return JSON.stringify({
    type: "turn_context",
    timestamp: new Date().toISOString(),
    payload: { model, cwd: cwd ?? "/test", sandbox_policy: "full-auto" },
  });
}

/** Build a user_message event_msg JSONL line */
function userMsg(message: string, ts: string): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: { type: "user_message", message },
  });
}

/** Build an agent_message event_msg JSONL line */
function agentMsg(message: string, ts: string): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: { type: "agent_message", message },
  });
}

/** Build a token_count event_msg JSONL line */
function tokenCount(
  inputTokens: number,
  outputTokens: number,
  ts: string,
): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cached_input_tokens: 0,
          total_tokens: inputTokens + outputTokens,
        },
      },
    },
  });
}

/** Build a function_call response_item JSONL line */
function functionCall(name: string, args: string, ts: string): string {
  return JSON.stringify({
    type: "response_item",
    timestamp: ts,
    payload: { type: "function_call", name, arguments: args },
  });
}

const fp = (overrides: Partial<FileFingerprint> = {}): FileFingerprint => ({
  inode: 12345,
  mtimeMs: 1700000000000,
  size: 4096,
  ...overrides,
});

function makeCodexCursor(
  overrides: Partial<CodexCursor> = {},
): CodexCursor {
  return {
    inode: 12345,
    mtimeMs: 1700000000000,
    size: 4096,
    offset: 100,
    lastTotalTokens: 0,
    lastModel: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// discover()
// ---------------------------------------------------------------------------

describe("codexSessionDriver.discover", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-codex-driver-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when codexSessionsDir is absent", async () => {
    const files = await codexSessionDriver.discover({});
    expect(files).toEqual([]);
  });

  it("returns empty array when codexSessionsDir does not exist", async () => {
    const files = await codexSessionDriver.discover({
      codexSessionsDir: join(tmpDir, "nonexistent"),
    });
    expect(files).toEqual([]);
  });

  it("discovers rollout-*.jsonl files under sessions dir", async () => {
    const dayDir = join(tmpDir, "2025", "01", "15");
    await mkdir(dayDir, { recursive: true });
    await writeFile(
      join(dayDir, "rollout-2025-01-15T10-30-00-abc123.jsonl"),
      "{}",
    );
    await writeFile(join(dayDir, "other.txt"), "ignored");
    await writeFile(join(dayDir, "not-rollout.jsonl"), "ignored");

    const files = await codexSessionDriver.discover({
      codexSessionsDir: tmpDir,
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/rollout-.*\.jsonl$/);
  });

  it("discovers files across multiple date directories", async () => {
    const dir1 = join(tmpDir, "2025", "01", "15");
    const dir2 = join(tmpDir, "2025", "01", "16");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(
      join(dir1, "rollout-2025-01-15T10-30-00-abc123.jsonl"),
      "{}",
    );
    await writeFile(
      join(dir2, "rollout-2025-01-16T11-00-00-def456.jsonl"),
      "{}",
    );

    const files = await codexSessionDriver.discover({
      codexSessionsDir: tmpDir,
    });
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes("abc123"))).toBe(true);
    expect(files.some((f) => f.includes("def456"))).toBe(true);
  });

  it("ignores non-rollout JSONL files", async () => {
    const dayDir = join(tmpDir, "2025", "01", "15");
    await mkdir(dayDir, { recursive: true });
    await writeFile(join(dayDir, "summary.jsonl"), "{}");
    await writeFile(join(dayDir, "debug.jsonl"), "{}");

    const files = await codexSessionDriver.discover({
      codexSessionsDir: tmpDir,
    });
    expect(files).toEqual([]);
  });

  it("handles empty sessions directory", async () => {
    const files = await codexSessionDriver.discover({
      codexSessionsDir: tmpDir,
    });
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shouldSkip()
// ---------------------------------------------------------------------------

describe("codexSessionDriver.shouldSkip", () => {
  it("returns false when cursor is undefined (first scan)", () => {
    expect(codexSessionDriver.shouldSkip(undefined, fp())).toBe(false);
  });

  it("returns true when inode + mtimeMs + size all match", () => {
    const cursor = makeCodexCursor();
    expect(codexSessionDriver.shouldSkip(cursor, fp())).toBe(true);
  });

  it("returns false when inode differs", () => {
    const cursor = makeCodexCursor({ inode: 99999 });
    expect(codexSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when mtimeMs differs", () => {
    const cursor = makeCodexCursor({ mtimeMs: 9999999999999 });
    expect(codexSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when size differs", () => {
    const cursor = makeCodexCursor({ size: 9999 });
    expect(codexSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resumeState()
// ---------------------------------------------------------------------------

describe("codexSessionDriver.resumeState", () => {
  it("returns offset 0 with empty state when cursor is undefined", () => {
    const resume = codexSessionDriver.resumeState(undefined, fp());
    expect(resume).toEqual({
      kind: "codex",
      startOffset: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
  });

  it("returns cursor offset + cumulative state when inode matches", () => {
    const cursor = makeCodexCursor({
      offset: 2048,
      lastTotalTokens: 500,
      lastModel: "o3-mini",
    });
    const resume = codexSessionDriver.resumeState(
      cursor,
      fp({ size: 4096 }),
    );
    expect(resume).toEqual({
      kind: "codex",
      startOffset: 2048,
      lastTotalTokens: 500,
      lastModel: "o3-mini",
    });
  });

  it("returns offset 0 when inode differs (file rotated)", () => {
    const cursor = makeCodexCursor({ inode: 99999, offset: 2048 });
    const resume = codexSessionDriver.resumeState(cursor, fp());
    expect(resume).toEqual({
      kind: "codex",
      startOffset: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
  });

  it("returns offset 0 when file shrunk (re-written)", () => {
    const cursor = makeCodexCursor({ offset: 8192 });
    const resume = codexSessionDriver.resumeState(
      cursor,
      fp({ size: 1024 }),
    );
    expect(resume).toEqual({
      kind: "codex",
      startOffset: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
  });

  it("preserves lastModel=null when cursor has no model", () => {
    const cursor = makeCodexCursor({
      offset: 500,
      lastModel: null,
    });
    const resume = codexSessionDriver.resumeState(
      cursor,
      fp({ size: 1000 }),
    );
    expect(resume.lastModel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe("codexSessionDriver.parse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-codex-parse-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a simple Codex session file", async () => {
    const filePath = join(
      tmpDir,
      "rollout-2025-01-15T10-30-00-abc123.jsonl",
    );
    const lines = [
      sessionMeta("ses-codex-1", "/home/user/project", "2025-01-15T10:30:00Z"),
      turnContext("o3-mini"),
      userMsg("Hello Codex", "2025-01-15T10:30:01Z"),
      agentMsg("Hi there!", "2025-01-15T10:30:02Z"),
      tokenCount(100, 50, "2025-01-15T10:30:02Z"),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const results = await codexSessionDriver.parse(filePath, {
      kind: "codex",
      startOffset: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("codex:ses-codex-1");
    expect(results[0].canonical.source).toBe("codex");
    expect(results[0].canonical.messages).toHaveLength(2);
    expect(results[0].canonical.model).toBe("o3-mini");
    expect(results[0].canonical.totalInputTokens).toBe(100);
    expect(results[0].canonical.totalOutputTokens).toBe(50);
  });

  it("handles incremental parsing from byte offset", async () => {
    const filePath = join(
      tmpDir,
      "rollout-2025-01-15T10-30-00-inc123.jsonl",
    );
    const line1 = sessionMeta(
      "ses-inc",
      "/home/user/project",
      "2025-01-15T10:30:00Z",
    );
    const line2 = userMsg("First message", "2025-01-15T10:30:01Z");
    const line3 = agentMsg("First reply", "2025-01-15T10:30:02Z");

    // Write initial chunk
    const firstChunk = line1 + "\n" + line2 + "\n" + line3 + "\n";
    await writeFile(filePath, firstChunk);
    const offset = Buffer.byteLength(firstChunk, "utf8");

    // Append more lines
    const line4 = userMsg("Second message", "2025-01-15T10:30:03Z");
    const line5 = agentMsg("Second reply", "2025-01-15T10:30:04Z");
    const secondChunk = line4 + "\n" + line5 + "\n";
    await writeFile(filePath, firstChunk + secondChunk);

    // Parse from offset should only get appended content
    const results = await codexSessionDriver.parse(filePath, {
      kind: "codex",
      startOffset: offset,
      lastTotalTokens: 0,
      lastModel: null,
    });
    expect(results).toHaveLength(1);
    // Only the 2 messages from second chunk (session_meta is in first chunk)
    expect(results[0].canonical.messages).toHaveLength(2);
  });

  it("returns a result with empty messages for empty file", async () => {
    const filePath = join(
      tmpDir,
      "rollout-2025-01-15T10-30-00-empty123.jsonl",
    );
    await writeFile(filePath, "");

    const results = await codexSessionDriver.parse(filePath, {
      kind: "codex",
      startOffset: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
    // parseCodexFile returns an empty result for empty files, wrapped in array
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(0);
  });

  it("returns a result for missing file", async () => {
    const results = await codexSessionDriver.parse(
      join(tmpDir, "rollout-2025-01-15T10-30-00-missing.jsonl"),
      { kind: "codex", startOffset: 0, lastTotalTokens: 0, lastModel: null },
    );
    // parseCodexFile returns buildEmptyResult for non-existent files
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(0);
  });

  it("includes tool calls in parsed messages", async () => {
    const filePath = join(
      tmpDir,
      "rollout-2025-01-15T10-30-00-tools123.jsonl",
    );
    const lines = [
      sessionMeta("ses-tools", "/project", "2025-01-15T10:30:00Z"),
      turnContext("o3-mini"),
      userMsg("Run ls", "2025-01-15T10:30:01Z"),
      functionCall("shell", '{"command":"ls"}', "2025-01-15T10:30:02Z"),
      agentMsg("Done!", "2025-01-15T10:30:03Z"),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const results = await codexSessionDriver.parse(filePath, {
      kind: "codex",
      startOffset: 0,
      lastTotalTokens: 0,
      lastModel: null,
    });
    expect(results).toHaveLength(1);
    // user + function_call (tool) + agent
    expect(results[0].canonical.messages).toHaveLength(3);
    const toolMsg = results[0].canonical.messages.find(
      (m) => m.role === "tool",
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolName).toBe("shell");
  });
});

// ---------------------------------------------------------------------------
// buildCursor()
// ---------------------------------------------------------------------------

describe("codexSessionDriver.buildCursor", () => {
  it("builds cursor with fingerprint and token totals from result", () => {
    const fingerprint = fp({ size: 8192 });
    const results: ParseResult[] = [
      {
        canonical: {
          sessionKey: "codex:test",
          source: "codex",
          parserRevision: 1,
          schemaVersion: 1,
          startedAt: "2025-01-15T10:30:00Z",
          lastMessageAt: "2025-01-15T10:35:00Z",
          durationSeconds: 300,
          projectRef: null,
          projectName: null,
          model: "o3-mini",
          title: null,
          messages: [],
          totalInputTokens: 500,
          totalOutputTokens: 200,
          totalCachedTokens: 50,
          snapshotAt: "2025-01-15T10:35:00Z",
        },
        raw: {
          sessionKey: "codex:test",
          source: "codex",
          parserRevision: 1,
          collectedAt: "2025-01-15T10:35:00Z",
          sourceFiles: [],
        },
      },
    ];

    const cursor = codexSessionDriver.buildCursor(fingerprint, results);
    expect(cursor.inode).toBe(12345);
    expect(cursor.mtimeMs).toBe(1700000000000);
    expect(cursor.size).toBe(8192);
    expect(cursor.offset).toBe(8192);
    expect(cursor.lastTotalTokens).toBe(700); // 500 + 200
    expect(cursor.lastModel).toBe("o3-mini");
    expect(cursor.updatedAt).toBeDefined();
    expect(new Date(cursor.updatedAt).getTime()).toBeGreaterThan(0);
  });

  it("builds cursor with zero tokens when no results", () => {
    const fingerprint = fp({ size: 1024 });
    const cursor = codexSessionDriver.buildCursor(fingerprint, []);
    expect(cursor.offset).toBe(1024);
    expect(cursor.lastTotalTokens).toBe(0);
    expect(cursor.lastModel).toBeNull();
  });

  it("sets offset to fingerprint size (end of file)", () => {
    const fingerprint = fp({ size: 2048 });
    const cursor = codexSessionDriver.buildCursor(fingerprint, []);
    expect(cursor.offset).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// source property
// ---------------------------------------------------------------------------

describe("codexSessionDriver.source", () => {
  it("has source set to codex", () => {
    expect(codexSessionDriver.source).toBe("codex");
  });
});
