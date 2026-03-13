/**
 * Tests for VSCode Copilot session driver.
 *
 * Covers: discover, shouldSkip, resumeState, parse, buildCursor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VscodeCopilotCursor } from "@pika/core";
import type { FileFingerprint } from "../../utils/file-changed.js";
import { vscodeCopilotSessionDriver } from "./vscode-copilot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotOp(opts?: {
  sessionId?: string;
  creationDate?: string;
  requests?: Record<string, unknown>[];
  selectedModel?: string;
}): string {
  const v: Record<string, unknown> = {
    sessionId: opts?.sessionId ?? "test-session-001",
    creationDate: opts?.creationDate ?? "2026-01-01T00:00:00.000Z",
    requests: opts?.requests ?? [],
  };
  if (opts?.selectedModel !== undefined) {
    v.inputState = { selectedModel: opts.selectedModel };
  }
  return JSON.stringify({ kind: 0, v });
}

function appendRequestOp(req: Record<string, unknown>): string {
  return JSON.stringify({ kind: 2, k: ["requests"], v: req });
}

function appendResponseChunkOp(
  requestIndex: number,
  chunk: Record<string, unknown>,
): string {
  return JSON.stringify({
    kind: 2,
    k: ["requests", requestIndex, "response"],
    v: chunk,
  });
}

function setResultOp(
  requestIndex: number,
  result: Record<string, unknown>,
): string {
  return JSON.stringify({
    kind: 1,
    k: ["requests", requestIndex, "result"],
    v: result,
  });
}

function setModelStateOp(
  requestIndex: number,
  modelState: Record<string, unknown>,
): string {
  return JSON.stringify({
    kind: 1,
    k: ["requests", requestIndex, "modelState"],
    v: modelState,
  });
}

function makeRequest(opts?: {
  requestId?: string;
  timestamp?: number;
  modelId?: string;
  text?: string;
}): Record<string, unknown> {
  return {
    requestId: opts?.requestId ?? "req-001",
    timestamp: opts?.timestamp ?? 1767225600000, // 2026-01-01T00:00:00Z
    modelId: opts?.modelId ?? "gpt-4o",
    message: { text: opts?.text ?? "Hello" },
    response: [],
  };
}

/** Build a minimal session JSONL file content string */
function buildSessionContent(lines: string[]): string {
  return lines.join("\n") + "\n";
}

const fp = (overrides: Partial<FileFingerprint> = {}): FileFingerprint => ({
  inode: 12345,
  mtimeMs: 1700000000000,
  size: 4096,
  ...overrides,
});

function makeCursor(
  overrides: Partial<VscodeCopilotCursor> = {},
): VscodeCopilotCursor {
  return {
    inode: 12345,
    mtimeMs: 1700000000000,
    size: 4096,
    offset: 100,
    processedRequestIds: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// discover()
// ---------------------------------------------------------------------------

describe("vscodeCopilotSessionDriver.discover", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-copilot-driver-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when vscodeCopilotDirs is absent", async () => {
    const files = await vscodeCopilotSessionDriver.discover({});
    expect(files).toEqual([]);
  });

  it("returns empty array when vscodeCopilotDirs is empty array", async () => {
    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [],
    });
    expect(files).toEqual([]);
  });

  it("returns empty array when base dir does not exist", async () => {
    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [join(tmpDir, "nonexistent")],
    });
    expect(files).toEqual([]);
  });

  it("discovers workspace session files", async () => {
    const wsHash = "abc123hash";
    const chatDir = join(tmpDir, "workspaceStorage", wsHash, "chatSessions");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "session1.jsonl"), "{}");
    await writeFile(join(chatDir, "session2.jsonl"), "{}");
    await writeFile(join(chatDir, "notajsonl.txt"), "ignored");

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [tmpDir],
    });
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("discovers global session files", async () => {
    const globalDir = join(
      tmpDir,
      "globalStorage",
      "emptyWindowChatSessions",
    );
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "global-session.jsonl"), "{}");

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [tmpDir],
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/global-session\.jsonl$/);
  });

  it("discovers files from both workspace and global dirs", async () => {
    // Workspace
    const chatDir = join(
      tmpDir,
      "workspaceStorage",
      "ws1",
      "chatSessions",
    );
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "ws.jsonl"), "{}");

    // Global
    const globalDir = join(
      tmpDir,
      "globalStorage",
      "emptyWindowChatSessions",
    );
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "global.jsonl"), "{}");

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [tmpDir],
    });
    expect(files).toHaveLength(2);
  });

  it("discovers from multiple workspace hash directories", async () => {
    for (const hash of ["hash1", "hash2", "hash3"]) {
      const chatDir = join(tmpDir, "workspaceStorage", hash, "chatSessions");
      await mkdir(chatDir, { recursive: true });
      await writeFile(join(chatDir, "session.jsonl"), "{}");
    }

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [tmpDir],
    });
    expect(files).toHaveLength(3);
  });

  it("discovers from multiple base directories", async () => {
    const baseDir1 = join(tmpDir, "Code");
    const baseDir2 = join(tmpDir, "CodeInsiders");

    // Set up workspace files in each
    const dir1 = join(baseDir1, "workspaceStorage", "ws1", "chatSessions");
    const dir2 = join(baseDir2, "workspaceStorage", "ws2", "chatSessions");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir1, "a.jsonl"), "{}");
    await writeFile(join(dir2, "b.jsonl"), "{}");

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [baseDir1, baseDir2],
    });
    expect(files).toHaveLength(2);
  });

  it("skips workspace hash entries that are not directories", async () => {
    const wsDir = join(tmpDir, "workspaceStorage");
    await mkdir(wsDir, { recursive: true });
    // Create a file instead of directory
    await writeFile(join(wsDir, "notadir"), "file");

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [tmpDir],
    });
    expect(files).toEqual([]);
  });

  it("handles missing chatSessions subdirectory gracefully", async () => {
    // Workspace hash dir exists but has no chatSessions
    const wsHashDir = join(tmpDir, "workspaceStorage", "orphan");
    await mkdir(wsHashDir, { recursive: true });

    const files = await vscodeCopilotSessionDriver.discover({
      vscodeCopilotDirs: [tmpDir],
    });
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shouldSkip()
// ---------------------------------------------------------------------------

describe("vscodeCopilotSessionDriver.shouldSkip", () => {
  it("returns false when cursor is undefined (first scan)", () => {
    expect(vscodeCopilotSessionDriver.shouldSkip(undefined, fp())).toBe(
      false,
    );
  });

  it("returns true when inode + mtimeMs + size all match", () => {
    const cursor = makeCursor();
    expect(vscodeCopilotSessionDriver.shouldSkip(cursor, fp())).toBe(true);
  });

  it("returns false when inode differs", () => {
    const cursor = makeCursor({ inode: 99999 });
    expect(vscodeCopilotSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when mtimeMs differs", () => {
    const cursor = makeCursor({ mtimeMs: 9999999999999 });
    expect(vscodeCopilotSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });

  it("returns false when size differs", () => {
    const cursor = makeCursor({ size: 9999 });
    expect(vscodeCopilotSessionDriver.shouldSkip(cursor, fp())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resumeState()
// ---------------------------------------------------------------------------

describe("vscodeCopilotSessionDriver.resumeState", () => {
  it("returns offset 0 with empty processedRequestIds when cursor is undefined", () => {
    const resume = vscodeCopilotSessionDriver.resumeState(undefined, fp());
    expect(resume).toEqual({
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });
  });

  it("returns cursor offset + processedRequestIds when inode matches", () => {
    const cursor = makeCursor({
      offset: 2048,
      processedRequestIds: ["req-001", "req-002"],
    });
    const resume = vscodeCopilotSessionDriver.resumeState(
      cursor,
      fp({ size: 4096 }),
    );
    expect(resume).toEqual({
      kind: "vscode-copilot",
      startOffset: 2048,
      processedRequestIds: ["req-001", "req-002"],
    });
  });

  it("returns offset 0 when inode differs (file rotated)", () => {
    const cursor = makeCursor({
      inode: 99999,
      offset: 2048,
      processedRequestIds: ["req-001"],
    });
    const resume = vscodeCopilotSessionDriver.resumeState(cursor, fp());
    expect(resume).toEqual({
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });
  });

  it("returns offset 0 when file shrunk (re-written)", () => {
    const cursor = makeCursor({
      offset: 8192,
      processedRequestIds: ["req-001"],
    });
    const resume = vscodeCopilotSessionDriver.resumeState(
      cursor,
      fp({ size: 1024 }),
    );
    expect(resume).toEqual({
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });
  });

  it("preserves processedRequestIds from cursor", () => {
    const ids = ["req-a", "req-b", "req-c"];
    const cursor = makeCursor({
      offset: 500,
      processedRequestIds: ids,
    });
    const resume = vscodeCopilotSessionDriver.resumeState(
      cursor,
      fp({ size: 1000 }),
    );
    expect(resume.processedRequestIds).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe("vscodeCopilotSessionDriver.parse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-copilot-parse-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Create a session file inside a workspace-like directory structure */
  async function createSessionFile(
    content: string,
    opts?: { workspaceFolder?: string; fileName?: string },
  ): Promise<string> {
    const wsHash = "ws-" + Math.random().toString(36).slice(2, 8);
    const chatDir = join(tmpDir, "workspaceStorage", wsHash, "chatSessions");
    await mkdir(chatDir, { recursive: true });

    // Write workspace.json for project ref resolution
    if (opts?.workspaceFolder) {
      const wsJsonPath = join(tmpDir, "workspaceStorage", wsHash, "workspace.json");
      await writeFile(
        wsJsonPath,
        JSON.stringify({ folder: `file://${opts.workspaceFolder}` }),
      );
    }

    const fileName = opts?.fileName ?? "session.jsonl";
    const filePath = join(chatDir, fileName);
    await writeFile(filePath, content);
    return filePath;
  }

  it("parses a simple conversation", async () => {
    const content = buildSessionContent([
      snapshotOp({ sessionId: "ses-001" }),
      appendRequestOp(
        makeRequest({ requestId: "req-001", text: "Hello" }),
      ),
      appendResponseChunkOp(0, { value: "Hi there!" }),
      setResultOp(0, {
        metadata: { promptTokens: 100, outputTokens: 50 },
      }),
      setModelStateOp(0, { value: 1, completedAt: "2026-01-01T00:01:00.000Z" }),
    ]);

    const filePath = await createSessionFile(content);

    const results = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("copilot:ses-001");
    expect(results[0].canonical.source).toBe("vscode-copilot");
    expect(results[0].canonical.messages.length).toBeGreaterThanOrEqual(1);
    expect(results[0].canonical.totalInputTokens).toBe(100);
    expect(results[0].canonical.totalOutputTokens).toBe(50);
  });

  it("resolves workspace folder from sibling workspace.json", async () => {
    const content = buildSessionContent([
      snapshotOp({ sessionId: "ses-ws" }),
      appendRequestOp(makeRequest({ requestId: "req-ws" })),
      appendResponseChunkOp(0, { value: "Done" }),
      setModelStateOp(0, { value: 1 }),
    ]);

    const filePath = await createSessionFile(content, {
      workspaceFolder: "/Users/test/my-project",
    });

    const results = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0].canonical.projectName).toBe("my-project");
    expect(results[0].canonical.projectRef).toBeTruthy();
  });

  it("returns empty array when file has no requests", async () => {
    const content = buildSessionContent([snapshotOp()]);
    const filePath = await createSessionFile(content);

    const results = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });

    expect(results).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    const filePath = await createSessionFile("");

    const results = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });

    expect(results).toEqual([]);
  });

  it("returns empty array for nonexistent file", async () => {
    const results = await vscodeCopilotSessionDriver.parse(
      join(tmpDir, "nonexistent.jsonl"),
      { kind: "vscode-copilot", startOffset: 0, processedRequestIds: [] },
    );

    expect(results).toEqual([]);
  });

  it("skips previously processed requests (incremental)", async () => {
    const content = buildSessionContent([
      snapshotOp({ sessionId: "ses-inc" }),
      appendRequestOp(
        makeRequest({ requestId: "req-old", text: "Old question" }),
      ),
      appendResponseChunkOp(0, { value: "Old answer" }),
      setModelStateOp(0, { value: 1 }),
      appendRequestOp(
        makeRequest({
          requestId: "req-new",
          text: "New question",
          timestamp: 1767225660000,
        }),
      ),
      appendResponseChunkOp(1, { value: "New answer" }),
      setModelStateOp(1, { value: 1 }),
    ]);

    const filePath = await createSessionFile(content);

    // First parse: get both requests
    const results1 = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });
    expect(results1).toHaveLength(1);
    // Should have user + assistant for both requests
    expect(results1[0].canonical.messages.length).toBeGreaterThanOrEqual(4);

    // Second parse: skip old request
    const results2 = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: ["req-old"],
    });
    expect(results2).toHaveLength(1);
    // Should only have messages from req-new
    expect(results2[0].canonical.messages.length).toBeGreaterThanOrEqual(2);
    // Verify the first user message is the new one
    const userMsg = results2[0].canonical.messages.find(
      (m) => m.role === "user",
    );
    expect(userMsg?.content).toContain("New question");
  });

  it("returns empty when all requests are already processed", async () => {
    const content = buildSessionContent([
      snapshotOp({ sessionId: "ses-done" }),
      appendRequestOp(makeRequest({ requestId: "req-a" })),
      appendResponseChunkOp(0, { value: "Answer" }),
      setModelStateOp(0, { value: 1 }),
    ]);

    const filePath = await createSessionFile(content);

    const results = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: ["req-a"],
    });

    expect(results).toEqual([]);
  });

  it("includes model info from session state", async () => {
    const content = buildSessionContent([
      snapshotOp({
        sessionId: "ses-model",
        selectedModel: "claude-sonnet-4-20250514",
      }),
      appendRequestOp(makeRequest({ requestId: "req-m1", modelId: "gpt-4o" })),
      appendResponseChunkOp(0, { value: "Response" }),
      setModelStateOp(0, { value: 1 }),
    ]);

    const filePath = await createSessionFile(content);

    const results = await vscodeCopilotSessionDriver.parse(filePath, {
      kind: "vscode-copilot",
      startOffset: 0,
      processedRequestIds: [],
    });

    expect(results).toHaveLength(1);
    // Model should come from session-level selectedModel or request modelId
    expect(results[0].canonical.model).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildCursor()
// ---------------------------------------------------------------------------

describe("vscodeCopilotSessionDriver.buildCursor", () => {
  it("builds cursor with fingerprint and offset = file size", async () => {
    // First trigger a parse to populate the side-channel state
    const tmpDir = await mkdtemp(join(tmpdir(), "pika-copilot-cursor-"));
    try {
      const chatDir = join(tmpDir, "workspaceStorage", "ws1", "chatSessions");
      await mkdir(chatDir, { recursive: true });
      const content = buildSessionContent([
        snapshotOp({ sessionId: "ses-cursor" }),
        appendRequestOp(makeRequest({ requestId: "req-c1" })),
        appendResponseChunkOp(0, { value: "Answer" }),
        setModelStateOp(0, { value: 1 }),
      ]);
      const filePath = join(chatDir, "session.jsonl");
      await writeFile(filePath, content);

      // Parse to populate internal state
      await vscodeCopilotSessionDriver.parse(filePath, {
        kind: "vscode-copilot",
        startOffset: 0,
        processedRequestIds: [],
      });

      const fingerprint = fp({ size: 8192 });
      const cursor = vscodeCopilotSessionDriver.buildCursor(fingerprint, []);

      expect(cursor.inode).toBe(12345);
      expect(cursor.mtimeMs).toBe(1700000000000);
      expect(cursor.size).toBe(8192);
      expect(cursor.offset).toBe(8192);
      expect(cursor.processedRequestIds).toContain("req-c1");
      expect(cursor.updatedAt).toBeDefined();
      expect(new Date(cursor.updatedAt).getTime()).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("merges previous and new request IDs in cursor", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "pika-copilot-merge-"));
    try {
      const chatDir = join(tmpDir, "workspaceStorage", "ws1", "chatSessions");
      await mkdir(chatDir, { recursive: true });
      const content = buildSessionContent([
        snapshotOp({ sessionId: "ses-merge" }),
        appendRequestOp(makeRequest({ requestId: "req-old" })),
        appendResponseChunkOp(0, { value: "Old answer" }),
        setModelStateOp(0, { value: 1 }),
        appendRequestOp(
          makeRequest({
            requestId: "req-new",
            text: "New Q",
            timestamp: 1767225660000,
          }),
        ),
        appendResponseChunkOp(1, { value: "New answer" }),
        setModelStateOp(1, { value: 1 }),
      ]);
      const filePath = join(chatDir, "session.jsonl");
      await writeFile(filePath, content);

      // Parse with req-old already processed
      await vscodeCopilotSessionDriver.parse(filePath, {
        kind: "vscode-copilot",
        startOffset: 0,
        processedRequestIds: ["req-old"],
      });

      const fingerprint = fp({ size: 4096 });
      const cursor = vscodeCopilotSessionDriver.buildCursor(fingerprint, []);

      // Should have both old and new
      expect(cursor.processedRequestIds).toContain("req-old");
      expect(cursor.processedRequestIds).toContain("req-new");
      expect(cursor.processedRequestIds).toHaveLength(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sets offset to fingerprint size (end of file)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "pika-copilot-offset-"));
    try {
      const chatDir = join(tmpDir, "workspaceStorage", "ws1", "chatSessions");
      await mkdir(chatDir, { recursive: true });
      const content = buildSessionContent([
        snapshotOp(),
        appendRequestOp(makeRequest({ requestId: "req-x" })),
        appendResponseChunkOp(0, { value: "X" }),
        setModelStateOp(0, { value: 1 }),
      ]);
      await writeFile(join(chatDir, "session.jsonl"), content);
      await vscodeCopilotSessionDriver.parse(
        join(chatDir, "session.jsonl"),
        { kind: "vscode-copilot", startOffset: 0, processedRequestIds: [] },
      );

      const fingerprint = fp({ size: 2048 });
      const cursor = vscodeCopilotSessionDriver.buildCursor(fingerprint, []);
      expect(cursor.offset).toBe(2048);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// source property
// ---------------------------------------------------------------------------

describe("vscodeCopilotSessionDriver.source", () => {
  it("has source set to vscode-copilot", () => {
    expect(vscodeCopilotSessionDriver.source).toBe("vscode-copilot");
  });
});
