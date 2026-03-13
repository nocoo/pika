/**
 * Tests for OpenCode JSON file session driver.
 *
 * Covers: discover (with dir mtime optimization), shouldSkip, resumeState,
 * parse (with SyncContext openCodeSessionState deposit), buildCursor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OpenCodeCursor, ParseResult } from "@pika/core";
import type { FileFingerprint, SyncContext } from "../types.js";
import { createOpenCodeJsonDriver } from "./opencode.js";

// ---------------------------------------------------------------------------
// Helpers: build fixture files
// ---------------------------------------------------------------------------

function writeSessionJson(
  dir: string,
  sessionId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const data = {
    id: sessionId,
    projectID: "proj_abc123",
    directory: "/home/user/myproject",
    title: "Test session",
    time: { created: 1700000000000, updated: 1700000300000 },
    ...overrides,
  };
  return writeFile(
    join(dir, `${sessionId}.json`),
    JSON.stringify(data),
  );
}

function writeMessageJson(
  messageDir: string,
  sessionId: string,
  messageId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const msgDir = join(messageDir, sessionId);
  const data = {
    id: messageId,
    sessionID: sessionId,
    role: "user",
    time: { created: 1700000001000 },
    ...overrides,
  };
  return mkdir(msgDir, { recursive: true }).then(() =>
    writeFile(join(msgDir, `${messageId}.json`), JSON.stringify(data)),
  );
}

function writePartJson(
  partDir: string,
  messageId: string,
  partId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const pDir = join(partDir, messageId);
  const data = {
    id: partId,
    type: "text",
    text: "Hello world",
    messageID: messageId,
    ...overrides,
  };
  return mkdir(pDir, { recursive: true }).then(() =>
    writeFile(join(pDir, `${partId}.json`), JSON.stringify(data)),
  );
}

const fp = (overrides: Partial<FileFingerprint> = {}): FileFingerprint => ({
  inode: 12345,
  mtimeMs: 1700000000000,
  size: 256,
  ...overrides,
});

function makeCursor(
  overrides: Partial<OpenCodeCursor> = {},
): OpenCodeCursor {
  return {
    inode: 12345,
    mtimeMs: 1700000000000,
    size: 256,
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// discover()
// ---------------------------------------------------------------------------

describe("openCodeJsonDriver.discover", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-oc-json-driver-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when openCodeMessageDir is absent", async () => {
    const driver = createOpenCodeJsonDriver();
    const files = await driver.discover({});
    expect(files).toEqual([]);
  });

  it("returns empty array when session dir does not exist", async () => {
    const driver = createOpenCodeJsonDriver();
    // messageDir exists but session/ sibling doesn't
    const messageDir = join(tmpDir, "storage", "message");
    await mkdir(messageDir, { recursive: true });
    const files = await driver.discover({ openCodeMessageDir: messageDir });
    expect(files).toEqual([]);
  });

  it("discovers ses_*.json files under session/{projectId}/", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessionDir = join(storageDir, "session", "proj_abc123");
    const messageDir = join(storageDir, "message");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });

    await writeSessionJson(sessionDir, "ses_001");
    await writeFile(join(sessionDir, "other.json"), "{}"); // not ses_ prefix
    await writeFile(join(sessionDir, "ses_002.txt"), "ignored"); // not .json

    const driver = createOpenCodeJsonDriver();
    const files = await driver.discover({ openCodeMessageDir: messageDir });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/ses_001\.json$/);
  });

  it("discovers files across multiple project directories", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessDir1 = join(storageDir, "session", "proj_a");
    const sessDir2 = join(storageDir, "session", "proj_b");
    const messageDir = join(storageDir, "message");
    await mkdir(sessDir1, { recursive: true });
    await mkdir(sessDir2, { recursive: true });
    await mkdir(messageDir, { recursive: true });

    await writeSessionJson(sessDir1, "ses_001");
    await writeSessionJson(sessDir2, "ses_002");

    const driver = createOpenCodeJsonDriver();
    const files = await driver.discover({ openCodeMessageDir: messageDir });
    expect(files).toHaveLength(2);
  });

  it("ignores non-directory entries in session dir", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessionDir = join(storageDir, "session");
    const messageDir = join(storageDir, "message");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });

    // Write a file directly in session/ (not a project dir)
    await writeFile(join(sessionDir, "stray.json"), "{}");

    const driver = createOpenCodeJsonDriver();
    const files = await driver.discover({ openCodeMessageDir: messageDir });
    expect(files).toEqual([]);
  });

  it("updates dirMtimes in SyncContext", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessDir = join(storageDir, "session", "proj_a");
    const messageDir = join(storageDir, "message");
    await mkdir(sessDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await writeSessionJson(sessDir, "ses_001");

    const ctx: SyncContext = {};
    const driver = createOpenCodeJsonDriver(ctx);
    await driver.discover({ openCodeMessageDir: messageDir });

    expect(ctx.dirMtimes).toBeDefined();
    expect(Object.keys(ctx.dirMtimes!)).toHaveLength(1);
    const key = Object.keys(ctx.dirMtimes!)[0];
    expect(key).toContain("proj_a");
    expect(typeof ctx.dirMtimes![key]).toBe("number");
  });

  it("skips readdir when dir mtime matches cached value", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessDir = join(storageDir, "session", "proj_a");
    const messageDir = join(storageDir, "message");
    await mkdir(sessDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await writeSessionJson(sessDir, "ses_001");

    // First pass: populate dirMtimes
    const ctx: SyncContext = {};
    const driver = createOpenCodeJsonDriver(ctx);
    const firstFiles = await driver.discover({ openCodeMessageDir: messageDir });
    expect(firstFiles).toHaveLength(1);
    expect(ctx.dirMtimes).toBeDefined();
    const cachedMtime = ctx.dirMtimes![Object.keys(ctx.dirMtimes!)[0]];

    // Second pass: same driver + same ctx, dir mtime unchanged → skip readdir → return empty
    const secondFiles = await driver.discover({ openCodeMessageDir: messageDir });
    expect(secondFiles).toHaveLength(0);
    // dirMtimes should still be populated (refreshed from stat)
    expect(ctx.dirMtimes).toBeDefined();
    expect(ctx.dirMtimes![Object.keys(ctx.dirMtimes!)[0]]).toBe(cachedMtime);
  });

  it("re-reads dir when mtime changes after adding a file", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessDir = join(storageDir, "session", "proj_a");
    const messageDir = join(storageDir, "message");
    await mkdir(sessDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await writeSessionJson(sessDir, "ses_001");

    // First pass
    const ctx: SyncContext = {};
    const driver = createOpenCodeJsonDriver(ctx);
    await driver.discover({ openCodeMessageDir: messageDir });

    // Wait a tiny bit then add a new file to change dir mtime
    await new Promise((r) => setTimeout(r, 50));
    await writeSessionJson(sessDir, "ses_002");

    // Second pass: dir mtime changed → should rediscover
    const files = await driver.discover({ openCodeMessageDir: messageDir });
    expect(files).toHaveLength(2);
  });

  it("handles unreadable project directory gracefully", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessDir = join(storageDir, "session", "proj_a");
    const messageDir = join(storageDir, "message");
    await mkdir(sessDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await writeSessionJson(sessDir, "ses_001");

    // Make it unreadable — create a second project dir that we can't readdir
    const badDir = join(storageDir, "session", "proj_bad");
    await mkdir(badDir, { recursive: true });
    // Write a file in it
    await writeSessionJson(badDir, "ses_bad");

    // The driver should discover files from both (both readable in this test)
    const driver = createOpenCodeJsonDriver();
    const files = await driver.discover({ openCodeMessageDir: messageDir });
    expect(files).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// shouldSkip()
// ---------------------------------------------------------------------------

describe("openCodeJsonDriver.shouldSkip", () => {
  const driver = createOpenCodeJsonDriver();

  it("returns false when cursor is undefined (first scan)", () => {
    expect(driver.shouldSkip(undefined, fp())).toBe(false);
  });

  it("returns true when inode + mtimeMs + size all match", () => {
    const cursor = makeCursor();
    expect(driver.shouldSkip(cursor, fp())).toBe(true);
  });

  it("returns false when inode differs", () => {
    const cursor = makeCursor({ inode: 99999 });
    expect(driver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when mtimeMs differs", () => {
    const cursor = makeCursor({ mtimeMs: 9999999999999 });
    expect(driver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when size differs", () => {
    const cursor = makeCursor({ size: 9999 });
    expect(driver.shouldSkip(cursor, fp())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resumeState()
// ---------------------------------------------------------------------------

describe("openCodeJsonDriver.resumeState", () => {
  const driver = createOpenCodeJsonDriver();

  it("always returns opencode-json kind regardless of cursor", () => {
    expect(driver.resumeState(undefined, fp())).toEqual({
      kind: "opencode-json",
    });
  });

  it("returns opencode-json kind even with existing cursor", () => {
    const cursor = makeCursor();
    expect(driver.resumeState(cursor, fp())).toEqual({
      kind: "opencode-json",
    });
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe("openCodeJsonDriver.parse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-oc-json-parse-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a complete OpenCode session from JSON files", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessionDir = join(storageDir, "session", "proj_abc");
    const messageDir = join(storageDir, "message");
    const partDir = join(storageDir, "part");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await mkdir(partDir, { recursive: true });

    // Write session
    await writeSessionJson(sessionDir, "ses_001");

    // Write user message + part
    await writeMessageJson(messageDir, "ses_001", "msg_001", {
      role: "user",
      time: { created: 1700000001000 },
    });
    await writePartJson(partDir, "msg_001", "prt_001", {
      type: "text",
      text: "Hello from user",
    });

    // Write assistant message + part
    await writeMessageJson(messageDir, "ses_001", "msg_002", {
      role: "assistant",
      time: { created: 1700000002000 },
      modelID: "claude-sonnet-4-20250514",
      tokens: { input: 100, output: 50, cache: { read: 10 } },
    });
    await writePartJson(partDir, "msg_002", "prt_002", {
      type: "text",
      text: "Hello from assistant",
    });

    const filePath = join(sessionDir, "ses_001.json");
    const driver = createOpenCodeJsonDriver();
    const results = await driver.parse(filePath, { kind: "opencode-json" });

    expect(results).toHaveLength(1);
    const session = results[0].canonical;
    expect(session.sessionKey).toBe("opencode:ses_001");
    expect(session.source).toBe("opencode");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[0].content).toBe("Hello from user");
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[1].content).toBe("Hello from assistant");
    expect(session.totalInputTokens).toBe(100);
    expect(session.totalOutputTokens).toBe(50);
  });

  it("deposits openCodeSessionState into SyncContext", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessionDir = join(storageDir, "session", "proj_abc");
    const messageDir = join(storageDir, "message");
    const partDir = join(storageDir, "part");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await mkdir(partDir, { recursive: true });

    await writeSessionJson(sessionDir, "ses_001");
    await writeMessageJson(messageDir, "ses_001", "msg_001", {
      role: "user",
      time: { created: 1700000001000 },
    });
    await writePartJson(partDir, "msg_001", "prt_001", {
      type: "text",
      text: "test",
    });

    const ctx: SyncContext = {};
    const driver = createOpenCodeJsonDriver(ctx);
    const filePath = join(sessionDir, "ses_001.json");
    await driver.parse(filePath, { kind: "opencode-json" });

    expect(ctx.openCodeSessionState).toBeDefined();
    expect(ctx.openCodeSessionState!.has("opencode:ses_001")).toBe(true);
    const info = ctx.openCodeSessionState!.get("opencode:ses_001")!;
    expect(info.totalMessages).toBe(1);
    expect(info.lastMessageAt).toBeDefined();
  });

  it("returns empty result for missing session file", async () => {
    const driver = createOpenCodeJsonDriver();
    const results = await driver.parse(
      join(tmpDir, "nonexistent.json"),
      { kind: "opencode-json" },
    );
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(0);
  });

  it("returns empty result for session with no messages", async () => {
    const storageDir = join(tmpDir, "storage");
    const sessionDir = join(storageDir, "session", "proj_abc");
    await mkdir(sessionDir, { recursive: true });
    // No message dir
    await writeSessionJson(sessionDir, "ses_empty");

    const filePath = join(sessionDir, "ses_empty.json");
    const driver = createOpenCodeJsonDriver();
    const results = await driver.parse(filePath, { kind: "opencode-json" });
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildCursor()
// ---------------------------------------------------------------------------

describe("openCodeJsonDriver.buildCursor", () => {
  const driver = createOpenCodeJsonDriver();

  it("builds cursor with fingerprint data", () => {
    const fingerprint = fp({ size: 512 });
    const results: ParseResult[] = [
      {
        canonical: {
          sessionKey: "opencode:ses_001",
          source: "opencode",
          parserRevision: 1,
          schemaVersion: 1,
          startedAt: "2025-01-15T10:00:00Z",
          lastMessageAt: "2025-01-15T10:05:00Z",
          durationSeconds: 300,
          projectRef: null,
          projectName: null,
          model: "claude-sonnet-4-20250514",
          title: "Test",
          messages: [],
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalCachedTokens: 10,
          snapshotAt: "2025-01-15T10:05:00Z",
        },
        raw: {
          sessionKey: "opencode:ses_001",
          source: "opencode",
          parserRevision: 1,
          collectedAt: "2025-01-15T10:05:00Z",
          sourceFiles: [],
        },
      },
    ];

    const cursor = driver.buildCursor(fingerprint, results);
    expect(cursor.inode).toBe(12345);
    expect(cursor.mtimeMs).toBe(1700000000000);
    expect(cursor.size).toBe(512);
    expect(cursor.updatedAt).toBeDefined();
  });

  it("builds cursor with zero results", () => {
    const cursor = driver.buildCursor(fp(), []);
    expect(cursor.inode).toBe(12345);
    expect(cursor.mtimeMs).toBe(1700000000000);
    expect(cursor.size).toBe(256);
    expect(cursor.updatedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// source property
// ---------------------------------------------------------------------------

describe("openCodeJsonDriver.source", () => {
  it("has source set to opencode", () => {
    const driver = createOpenCodeJsonDriver();
    expect(driver.source).toBe("opencode");
  });
});
