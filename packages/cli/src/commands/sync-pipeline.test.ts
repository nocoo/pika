import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSyncPipeline, getFingerprint } from "./sync-pipeline";
import type { SyncPipelineInput, SyncPipelineOptions } from "./sync-pipeline";
import type {
  CursorState,
  ParseResult,
  CanonicalSession,
  RawSessionArchive,
  FileCursorBase,
  OpenCodeSqliteCursor,
} from "@pika/core";
import type {
  FileDriver,
  DbDriver,
  DiscoverOpts,
  SyncContext,
  ResumeState,
  FileFingerprint,
  DbDriverResult,
} from "../drivers/types";
import { AuthError } from "../upload/engine";

// ── Fixtures ───────────────────────────────────────────────────

function makeCanonical(key = "claude-code:s1"): CanonicalSession {
  return {
    sessionKey: key,
    source: "claude-code",
    parserRevision: 1,
    schemaVersion: 1,
    startedAt: "2026-01-01T00:00:00Z",
    lastMessageAt: "2026-01-01T00:10:00Z",
    durationSeconds: 600,
    projectRef: "abc123",
    projectName: "test-project",
    model: "claude-sonnet-4-20250514",
    title: "Test session",
    messages: [
      { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant", content: "Hi!", timestamp: "2026-01-01T00:00:05Z" },
    ],
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalCachedTokens: 0,
    snapshotAt: "2026-01-01T00:10:00Z",
  };
}

function makeRaw(key = "claude-code:s1"): RawSessionArchive {
  return {
    sessionKey: key,
    source: "claude-code",
    parserRevision: 1,
    collectedAt: "2026-01-01T00:10:00Z",
    sourceFiles: [{ path: "/test.jsonl", format: "jsonl", content: "{}\n" }],
  };
}

function makeParseResult(key = "claude-code:s1"): ParseResult {
  return { canonical: makeCanonical(key), raw: makeRaw(key) };
}

function makeCursorState(): CursorState {
  return { version: 1, files: {}, updatedAt: null };
}

function makeFingerprint(overrides?: Partial<FileFingerprint>): FileFingerprint {
  return { inode: 12345, mtimeMs: 1700000000000, size: 1024, ...overrides };
}

function makeCursor(overrides?: Partial<FileCursorBase>): FileCursorBase {
  return {
    inode: 12345,
    mtimeMs: 1700000000000,
    size: 1024,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockFileDriver(overrides?: Partial<FileDriver<FileCursorBase>>): FileDriver<FileCursorBase> {
  return {
    source: "claude-code",
    discover: vi.fn().mockResolvedValue([]),
    shouldSkip: vi.fn().mockReturnValue(false),
    resumeState: vi.fn().mockReturnValue({ kind: "byte-offset", startOffset: 0 } as ResumeState),
    parse: vi.fn().mockResolvedValue([]),
    buildCursor: vi.fn().mockReturnValue(makeCursor()),
    ...overrides,
  };
}

function makeOpts(overrides?: Partial<SyncPipelineOptions>): SyncPipelineOptions {
  return {
    upload: false,
    apiUrl: "https://pika.test",
    apiKey: "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    userId: "user-123",
    sleep: vi.fn().mockResolvedValue(undefined),
    contentConcurrency: 1, // Sequential for ordered mock compatibility
    ...overrides,
  };
}

function makeInput(overrides?: Partial<SyncPipelineInput>): SyncPipelineInput {
  return {
    fileDrivers: [],
    discoverOpts: {},
    cursorState: makeCursorState(),
    syncCtx: {},
    ...overrides,
  };
}

// ── getFingerprint ─────────────────────────────────────────────

describe("getFingerprint", () => {
  it("returns inode, mtimeMs, and size from a real file", async () => {
    // Use this test file itself as the subject
    const fp = await getFingerprint(__filename);
    expect(fp.inode).toBeGreaterThan(0);
    expect(fp.mtimeMs).toBeGreaterThan(0);
    expect(fp.size).toBeGreaterThan(0);
  });

  it("throws for non-existent file", async () => {
    await expect(getFingerprint("/nonexistent/file.txt")).rejects.toThrow();
  });
});

// ── runSyncPipeline: no drivers ────────────────────────────────

describe("runSyncPipeline", () => {
  it("returns zero results when no drivers", async () => {
    const result = await runSyncPipeline(makeInput(), makeOpts());
    expect(result.totalParsed).toBe(0);
    expect(result.totalFiles).toBe(0);
    expect(result.totalSkipped).toBe(0);
    expect(result.parseErrors).toEqual([]);
    expect(result.uploadResult).toBeUndefined();
    expect(result.contentResult).toBeUndefined();
  });

  it("sets updatedAt on cursor state", async () => {
    const result = await runSyncPipeline(makeInput(), makeOpts());
    expect(result.cursorState.updatedAt).toBeTruthy();
    expect(new Date(result.cursorState.updatedAt!).getTime()).toBeGreaterThan(0);
  });
});

// ── File driver discovery + parse ──────────────────────────────

describe("runSyncPipeline: file drivers", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it("discovers files and parses them", async () => {
    const parseResult = makeParseResult();
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]), // Use real file for stat
      parse: vi.fn().mockResolvedValue([parseResult]),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    expect(result.totalParsed).toBe(1);
    expect(result.totalFiles).toBe(1);
    expect(result.totalSkipped).toBe(0);
    expect(driver.discover).toHaveBeenCalledTimes(1);
    expect(driver.parse).toHaveBeenCalledTimes(1);
  });

  it("skips unchanged files", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      shouldSkip: vi.fn().mockReturnValue(true),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    expect(result.totalFiles).toBe(1);
    expect(result.totalSkipped).toBe(1);
    expect(result.totalParsed).toBe(0);
    expect(driver.parse).not.toHaveBeenCalled();
  });

  it("updates cursor state after successful parse", async () => {
    const newCursor = makeCursor({ inode: 99999, mtimeMs: 2000000000000, size: 2048 });
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([makeParseResult()]),
      buildCursor: vi.fn().mockReturnValue(newCursor),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    expect(result.cursorState.files[__filename]).toEqual(newCursor);
  });

  it("does not update cursor when no results from parse", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([]),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    expect(result.cursorState.files[__filename]).toBeUndefined();
  });

  it("collects parse errors without blocking", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockRejectedValue(new Error("parse failed")),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    expect(result.totalParsed).toBe(0);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].source).toBe("claude-code");
    expect(result.parseErrors[0].error).toBe("parse failed");
    expect(result.parseErrors[0].filePath).toBe(__filename);
  });

  it("continues parsing other files after error", async () => {
    // We need two real files for stat. Use __filename and the sync-pipeline source.
    const otherFile = __filename.replace(".test.ts", ".ts");
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename, otherFile]),
      parse: vi.fn()
        .mockRejectedValueOnce(new Error("first failed"))
        .mockResolvedValueOnce([makeParseResult("claude-code:s2")]),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    expect(result.totalParsed).toBe(1);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.totalFiles).toBe(2);
  });

  it("handles multiple file drivers", async () => {
    const driver1 = mockFileDriver({
      source: "claude-code",
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([makeParseResult("claude-code:s1")]),
    });
    const driver2 = mockFileDriver({
      source: "codex",
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([makeParseResult("codex:s1")]),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver1, driver2] }),
      makeOpts(),
    );

    expect(result.totalParsed).toBe(2);
    expect(result.totalFiles).toBe(2);
  });

  it("gracefully handles deleted file between discover and stat", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue(["/nonexistent/deleted.jsonl"]),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts(),
    );

    // The file counts as scanned but parse was not attempted
    expect(result.totalFiles).toBe(1);
    expect(result.totalParsed).toBe(0);
    expect(result.parseErrors).toEqual([]);
  });
});

// ── DB driver ──────────────────────────────────────────────────

describe("runSyncPipeline: DB driver", () => {
  it("runs DB driver and collects results", async () => {
    const dbCursor: OpenCodeSqliteCursor = {
      inode: 1,
      lastTimeCreated: "2026-01-01T00:00:00Z",
      lastMessageIds: [],
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const dbDriver: DbDriver<OpenCodeSqliteCursor> = {
      source: "opencode",
      run: vi.fn().mockResolvedValue({
        results: [makeParseResult("opencode:s1")],
        cursor: dbCursor,
        rowCount: 5,
      } satisfies DbDriverResult<OpenCodeSqliteCursor>),
    };

    const result = await runSyncPipeline(
      makeInput({ dbDriver }),
      makeOpts(),
    );

    expect(result.totalParsed).toBe(1);
    expect(result.cursorState.openCodeSqlite).toEqual(dbCursor);
  });

  it("collects DB driver errors without blocking", async () => {
    const dbDriver: DbDriver<OpenCodeSqliteCursor> = {
      source: "opencode",
      run: vi.fn().mockRejectedValue(new Error("DB connection failed")),
    };

    const result = await runSyncPipeline(
      makeInput({ dbDriver, discoverOpts: { openCodeDbPath: "/test/opencode.db" } }),
      makeOpts(),
    );

    expect(result.totalParsed).toBe(0);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].source).toBe("opencode");
    expect(result.parseErrors[0].error).toBe("DB connection failed");
  });

  it("rolls back DB cursor when DB-sourced session content upload fails", async () => {
    const prevDbCursor: OpenCodeSqliteCursor = {
      inode: 1,
      lastTimeCreated: "2026-01-01T00:00:00Z",
      lastMessageIds: ["old-msg-1"],
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const newDbCursor: OpenCodeSqliteCursor = {
      inode: 1,
      lastTimeCreated: "2026-01-02T00:00:00Z",
      lastMessageIds: ["new-msg-1", "new-msg-2"],
      updatedAt: "2026-01-02T00:00:00Z",
    };
    const dbDriver: DbDriver<OpenCodeSqliteCursor> = {
      source: "opencode",
      run: vi.fn().mockResolvedValue({
        results: [makeParseResult("opencode:s1")],
        cursor: newDbCursor,
        rowCount: 5,
      } satisfies DbDriverResult<OpenCodeSqliteCursor>),
    };

    const cursorState = makeCursorState();
    cursorState.openCodeSqlite = prevDbCursor;

    const mockFetch = vi.fn();
    // metadata batch POST — success
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ingested: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // content: canonical PUT — 500 error (exhaust retries)
    mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

    const result = await runSyncPipeline(
      makeInput({ dbDriver, cursorState }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    // Content upload should have errors
    expect(result.contentResult!.errors).toHaveLength(1);
    expect(result.contentResult!.errors[0].sessionKey).toBe("opencode:s1");

    // DB cursor should be rolled back to previous value
    expect(result.cursorState.openCodeSqlite).toEqual(prevDbCursor);
  });

  it("preserves new DB cursor when DB-sourced session content upload succeeds", async () => {
    const prevDbCursor: OpenCodeSqliteCursor = {
      inode: 1,
      lastTimeCreated: "2026-01-01T00:00:00Z",
      lastMessageIds: ["old-msg-1"],
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const newDbCursor: OpenCodeSqliteCursor = {
      inode: 1,
      lastTimeCreated: "2026-01-02T00:00:00Z",
      lastMessageIds: ["new-msg-1", "new-msg-2"],
      updatedAt: "2026-01-02T00:00:00Z",
    };
    const dbDriver: DbDriver<OpenCodeSqliteCursor> = {
      source: "opencode",
      run: vi.fn().mockResolvedValue({
        results: [makeParseResult("opencode:s1")],
        cursor: newDbCursor,
        rowCount: 5,
      } satisfies DbDriverResult<OpenCodeSqliteCursor>),
    };

    const cursorState = makeCursorState();
    cursorState.openCodeSqlite = prevDbCursor;

    const mockFetch = vi.fn();
    // metadata batch POST — success
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ingested: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // content: canonical PUT — success
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));
    // content: presign request
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://r2.example.com/presigned", key: "k" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // content: R2 PUT
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // content: confirm raw
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ confirmed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await runSyncPipeline(
      makeInput({ dbDriver, cursorState }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    // Content upload should succeed
    expect(result.contentResult!.errors).toHaveLength(0);

    // DB cursor should be the new one
    expect(result.cursorState.openCodeSqlite).toEqual(newDbCursor);
  });
});

// ── SyncContext dirMtimes (removed) ───────────────────────────
// dir-mtime optimization was removed in Bug #4 fix.
// The pipeline no longer persists dirMtimes to cursor state.

describe("runSyncPipeline: dirMtimes no longer persisted", () => {
  it("does not persist dirMtimes from syncCtx to cursor state", async () => {
    const syncCtx: SyncContext = {};

    const result = await runSyncPipeline(
      makeInput({ syncCtx }),
      makeOpts(),
    );

    // dirMtimes should NOT be set (optimization removed)
    expect(result.cursorState.dirMtimes).toBeUndefined();
  });
});

// ── Upload integration ─────────────────────────────────────────

describe("runSyncPipeline: upload", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("uploads metadata + content when upload=true", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([makeParseResult()]),
    });

    // metadata batch POST
    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: 1 }));
    // content: canonical PUT
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));
    // content: presign request
    mockFetch.mockResolvedValueOnce(jsonResponse({ url: "https://r2.example.com/presigned", key: "k" }));
    // content: R2 PUT
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // content: confirm raw
    mockFetch.mockResolvedValueOnce(jsonResponse({ confirmed: true }));

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    expect(result.uploadResult).toBeDefined();
    expect(result.uploadResult!.totalIngested).toBe(1);
    expect(result.contentResult).toBeDefined();
    expect(result.contentResult!.uploaded).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("skips upload when upload=false", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([makeParseResult()]),
    });

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts({ upload: false }),
    );

    expect(result.uploadResult).toBeUndefined();
    expect(result.contentResult).toBeUndefined();
  });

  it("skips upload when no results", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ingested: 0 }));

    const result = await runSyncPipeline(
      makeInput(),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    expect(result.uploadResult).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propagates AuthError from upload", async () => {
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([makeParseResult()]),
    });

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));

    await expect(
      runSyncPipeline(
        makeInput({ fileDrivers: [driver] }),
        makeOpts({ upload: true, fetch: mockFetch }),
      ),
    ).rejects.toThrow(AuthError);
  });

  it("rolls back cursor for sessions with content upload errors", async () => {
    const parseResult1 = makeParseResult("claude-code:s1");
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([parseResult1]),
    });

    // metadata batch POST — success
    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: 1 }));
    // content: canonical PUT — 500 error (will exhaust retries)
    mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    // Content upload should have errors
    expect(result.contentResult!.errors).toHaveLength(1);
    expect(result.contentResult!.errors[0].sessionKey).toBe("claude-code:s1");

    // Cursor should be rolled back — file was not in cursor before, so it should be removed
    expect(result.cursorState.files[__filename]).toBeUndefined();
  });

  it("restores previous cursor on content upload failure", async () => {
    const prevCursor = makeCursor({ inode: 11111, mtimeMs: 1600000000000, size: 512 });
    const cursorState = makeCursorState();
    cursorState.files[__filename] = prevCursor;

    const parseResult1 = makeParseResult("claude-code:s1");
    const newCursor = makeCursor({ inode: 99999, mtimeMs: 2000000000000, size: 2048 });
    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename]),
      parse: vi.fn().mockResolvedValue([parseResult1]),
      buildCursor: vi.fn().mockReturnValue(newCursor),
    });

    // metadata batch POST — success
    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: 1 }));
    // content: canonical PUT — 500 error (exhaust retries)
    mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver], cursorState }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    // Cursor should be restored to previous value, not the new one
    expect(result.cursorState.files[__filename]).toEqual(prevCursor);
  });

  it("does not roll back cursor for sessions without content errors", async () => {
    const otherFile = __filename.replace(".test.ts", ".ts");
    const parseResult1 = makeParseResult("claude-code:s1");
    const parseResult2 = makeParseResult("claude-code:s2");

    const newCursor1 = makeCursor({ inode: 11111 });
    const newCursor2 = makeCursor({ inode: 22222 });

    const driver = mockFileDriver({
      discover: vi.fn().mockResolvedValue([__filename, otherFile]),
      parse: vi.fn()
        .mockResolvedValueOnce([parseResult1])
        .mockResolvedValueOnce([parseResult2]),
      buildCursor: vi.fn()
        .mockReturnValueOnce(newCursor1)
        .mockReturnValueOnce(newCursor2),
    });

    // metadata batch POST — success (both in one batch)
    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: 2 }));
    // s1: canonical PUT — success
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));
    // s1: presign request
    mockFetch.mockResolvedValueOnce(jsonResponse({ url: "https://r2.example.com/presigned", key: "k1" }));
    // s1: R2 PUT
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // s1: confirm raw
    mockFetch.mockResolvedValueOnce(jsonResponse({ confirmed: true }));
    // s2: canonical PUT — 500 error (exhaust retries)
    mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    // s1 succeeded — cursor preserved
    expect(result.cursorState.files[__filename]).toEqual(newCursor1);
    // s2 failed — cursor rolled back (was undefined before)
    expect(result.cursorState.files[otherFile]).toBeUndefined();
  });
});
