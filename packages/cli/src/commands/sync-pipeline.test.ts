import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSyncPipeline, getFingerprint } from "./sync-pipeline.js";
import type { SyncPipelineInput, SyncPipelineOptions } from "./sync-pipeline.js";
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
} from "../drivers/types.js";
import { AuthError } from "../upload/engine.js";

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
});

// ── SyncContext dirMtimes ──────────────────────────────────────

describe("runSyncPipeline: syncCtx dirMtimes", () => {
  it("persists dirMtimes from syncCtx to cursor state", async () => {
    const syncCtx: SyncContext = {
      dirMtimes: { "/test/dir": 1700000000000 },
    };

    const result = await runSyncPipeline(
      makeInput({ syncCtx }),
      makeOpts(),
    );

    expect(result.cursorState.dirMtimes).toEqual({ "/test/dir": 1700000000000 });
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
    // content PUTs (canonical + raw)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const result = await runSyncPipeline(
      makeInput({ fileDrivers: [driver] }),
      makeOpts({ upload: true, fetch: mockFetch }),
    );

    expect(result.uploadResult).toBeDefined();
    expect(result.uploadResult!.totalIngested).toBe(1);
    expect(result.contentResult).toBeDefined();
    expect(result.contentResult!.uploaded).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
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
});
