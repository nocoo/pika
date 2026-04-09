/**
 * Worker sessions route handlers tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { Env } from "../index";
import {
  handleBatchOperation,
  handleConfirmRaw,
  handleFilters,
  handleGetSession,
  handleGetSessionContent,
  handleListSessions,
  handleSetStar,
  handleTrashSession,
  handleUpdateSession,
} from "./sessions";

// ── Mock helpers ───────────────────────────────────────────────

function mockD1(opts?: {
  results?: unknown[];
  firstResult?: unknown;
  runMeta?: { changes: number };
  batchResults?: unknown[][];
}): D1Database {
  const {
    results = [],
    firstResult = null,
    runMeta = { changes: 1 },
    batchResults,
  } = opts ?? {};

  const preparedStmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
    first: vi.fn().mockResolvedValue(firstResult),
    run: vi.fn().mockResolvedValue({ meta: runMeta }),
  };

  return {
    prepare: vi.fn().mockReturnValue(preparedStmt),
    batch: vi
      .fn()
      .mockResolvedValue(
        batchResults?.map((r) => ({ results: Array.isArray(r) ? r : [r] })) ??
          [],
      ),
  } as unknown as D1Database;
}

function mockR2(opts?: {
  getResult?: {
    body: ReadableStream;
    httpMetadata?: { contentEncoding?: string };
  } | null;
}): R2Bucket {
  return {
    get: vi.fn().mockResolvedValue(opts?.getResult ?? null),
  } as unknown as R2Bucket;
}

function mockEnv(
  dbOpts?: Parameters<typeof mockD1>[0],
  r2Opts?: Parameters<typeof mockR2>[0],
): Env {
  return {
    DB: mockD1(dbOpts),
    BUCKET: mockR2(r2Opts),
    WORKER_SECRET: "test-secret",
  };
}

// ── handleListSessions tests ───────────────────────────────────

describe("handleListSessions", () => {
  it("returns sessions list", async () => {
    const sessions = [
      { id: "s1", title: "Session 1" },
      { id: "s2", title: "Session 2" },
    ];
    const env = mockEnv({ results: sessions });

    const params = new URLSearchParams({ limit: "10" });
    const res = await handleListSessions("user-1", params, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(body.sessions.length).toBeLessThanOrEqual(2);
  });

  it("uses keyset pagination by default", async () => {
    const sessions = [{ id: "s1", started_at: "2026-01-01T10:00:00Z" }];
    const env = mockEnv({ results: sessions });

    const params = new URLSearchParams({ limit: "10" });
    const res = await handleListSessions("user-1", params, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMore).toBeDefined();
  });

  it("uses offset pagination when page is specified", async () => {
    const sessions = [{ id: "s1" }];
    const db = mockD1({ results: sessions });

    // Mock for count query and main query
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    const stmt = prepare();
    stmt.all.mockResolvedValue({ results: sessions });
    stmt.first.mockResolvedValue({ count: 1 });

    const env = { DB: db, BUCKET: mockR2(), WORKER_SECRET: "test" };

    const params = new URLSearchParams({ page: "1", limit: "10" });
    const res = await handleListSessions("user-1", params, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalCount).toBeDefined();
    expect(body.page).toBe(1);
  });

  it("enforces maximum limit", async () => {
    const env = mockEnv({ results: [] });
    const params = new URLSearchParams({ limit: "999" });

    await handleListSessions("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    // Query should include LIMIT clause
    expect(sql).toContain("LIMIT");
  });

  it("applies source filter", async () => {
    const env = mockEnv({ results: [] });
    const params = new URLSearchParams({ source: "claude-code" });

    await handleListSessions("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("s.source = ?");
  });

  it("applies duration filters", async () => {
    const env = mockEnv({ results: [] });
    const params = new URLSearchParams({
      minDuration: "300",
      maxDuration: "7200",
    });

    await handleListSessions("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("s.duration_seconds >= ?");
    expect(sql).toContain("s.duration_seconds <= ?");
  });

  it("applies input token filters", async () => {
    const env = mockEnv({ results: [] });
    const params = new URLSearchParams({
      minInputTokens: "1000",
      maxInputTokens: "50000",
    });

    await handleListSessions("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("s.total_input_tokens >= ?");
    expect(sql).toContain("s.total_input_tokens <= ?");
  });

  it("applies output token filters", async () => {
    const env = mockEnv({ results: [] });
    const params = new URLSearchParams({
      minOutputTokens: "500",
      maxOutputTokens: "10000",
    });

    await handleListSessions("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("s.total_output_tokens >= ?");
    expect(sql).toContain("s.total_output_tokens <= ?");
  });

  it("applies total token filters", async () => {
    const env = mockEnv({ results: [] });
    const params = new URLSearchParams({
      minTotalTokens: "5000",
      maxTotalTokens: "100000",
    });

    await handleListSessions("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain(
      "(s.total_input_tokens + s.total_output_tokens) >= ?",
    );
    expect(sql).toContain(
      "(s.total_input_tokens + s.total_output_tokens) <= ?",
    );
  });
});

// ── handleGetSession tests ─────────────────────────────────────

describe("handleGetSession", () => {
  it("returns session when found", async () => {
    const session = {
      id: "sess-123",
      title: "Test Session",
      source: "claude-code",
    };
    const env = mockEnv({ firstResult: session });

    const res = await handleGetSession("user-1", "sess-123", env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toEqual(session);
  });

  it("returns 404 when session not found", async () => {
    const env = mockEnv({ firstResult: null });

    const res = await handleGetSession("user-1", "nonexistent", env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });
});

// ── handleGetSessionContent tests ──────────────────────────────

describe("handleGetSessionContent", () => {
  it("returns 404 when session not found", async () => {
    const env = mockEnv({ firstResult: null });

    const res = await handleGetSessionContent("user-1", "nonexistent", env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Session not found");
  });

  it("returns 204 when content_key is null", async () => {
    const env = mockEnv({
      firstResult: { content_key: null },
    });

    const res = await handleGetSessionContent("user-1", "s1", env);

    expect(res.status).toBe(204);
  });

  it("returns 404 when R2 object not found", async () => {
    const env = mockEnv(
      { firstResult: { content_key: "user-1/s1/canonical.json.gz" } },
      { getResult: null },
    );

    const res = await handleGetSessionContent("user-1", "s1", env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Content not found");
  });

  it("returns content when found", async () => {
    const jsonContent = JSON.stringify({ messages: [] });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(jsonContent));
        controller.close();
      },
    });

    const env = mockEnv(
      { firstResult: { content_key: "user-1/s1/canonical.json.gz" } },
      { getResult: { body: stream, httpMetadata: {} } },
    );

    const res = await handleGetSessionContent("user-1", "s1", env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

// ── handleUpdateSession tests ──────────────────────────────────

describe("handleUpdateSession", () => {
  it("updates title", async () => {
    const db = mockD1({ runMeta: { changes: 1 } });
    const stmt = (db.prepare as ReturnType<typeof vi.fn>)();
    stmt.first.mockResolvedValue({
      id: "sess-123",
      title: "New Title",
      description: null,
      updated_at: "2026-04-08T10:00:00Z",
    });

    const env = { DB: db, BUCKET: mockR2(), WORKER_SECRET: "test" };

    const res = await handleUpdateSession(
      "user-1",
      "sess-123",
      { title: "New Title" },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("New Title");
  });

  it("updates description", async () => {
    const db = mockD1({ runMeta: { changes: 1 } });
    const stmt = (db.prepare as ReturnType<typeof vi.fn>)();
    stmt.first.mockResolvedValue({
      id: "sess-123",
      title: null,
      description: "A description",
      updated_at: "2026-04-08T10:00:00Z",
    });

    const env = { DB: db, BUCKET: mockR2(), WORKER_SECRET: "test" };

    const res = await handleUpdateSession(
      "user-1",
      "sess-123",
      { description: "A description" },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toBe("A description");
  });

  it("clears title with null", async () => {
    const db = mockD1({ runMeta: { changes: 1 } });
    const stmt = (db.prepare as ReturnType<typeof vi.fn>)();
    stmt.first.mockResolvedValue({
      id: "sess-123",
      title: null,
      description: null,
      updated_at: "2026-04-08T10:00:00Z",
    });

    const env = { DB: db, BUCKET: mockR2(), WORKER_SECRET: "test" };

    const res = await handleUpdateSession(
      "user-1",
      "sess-123",
      { title: null },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBeNull();
  });

  it("returns 400 when no valid fields", async () => {
    const env = mockEnv();

    const res = await handleUpdateSession("user-1", "sess-123", {}, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No valid fields");
  });

  it("returns 404 when session not found", async () => {
    const env = mockEnv({ runMeta: { changes: 0 } });

    const res = await handleUpdateSession(
      "user-1",
      "nonexistent",
      { title: "New Title" },
      env,
    );

    expect(res.status).toBe(404);
  });
});

// ── handleFilters tests ────────────────────────────────────────

describe("handleFilters", () => {
  it("returns filter values", async () => {
    // handleFilters calls two queries: models and projects
    const db = mockD1();
    const stmt = (db.prepare as ReturnType<typeof vi.fn>)();
    stmt.all
      .mockResolvedValueOnce({ results: [{ model: "claude-sonnet" }] })
      .mockResolvedValueOnce({
        results: [{ project_ref: "pika", project_name: "Pika" }],
      });

    const env = { DB: db, BUCKET: mockR2(), WORKER_SECRET: "test" };

    const res = await handleFilters("user-1", env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toBeDefined();
    expect(body.projects).toBeDefined();
  });
});

// ── handleSetStar tests ────────────────────────────────────────

describe("handleSetStar", () => {
  it("sets starred to true", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleSetStar("user-1", "sess-1", { starred: true }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.starred).toBe(true);
  });

  it("sets starred to false", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleSetStar(
      "user-1",
      "sess-1",
      { starred: false },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.starred).toBe(false);
  });

  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleSetStar(
      "user-1",
      "sess-1",
      { starred: "yes" },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("starred");
  });

  it("returns 404 when session not found", async () => {
    const env = mockEnv({ runMeta: { changes: 0 } });

    const res = await handleSetStar(
      "user-1",
      "nonexistent",
      { starred: true },
      env,
    );

    expect(res.status).toBe(404);
  });
});

// ── handleTrashSession tests ───────────────────────────────────

describe("handleTrashSession", () => {
  it("soft deletes a session", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleTrashSession(
      "user-1",
      "sess-1",
      { deleted: true },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.affected).toBe(1);
  });

  it("restores a session", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleTrashSession(
      "user-1",
      "sess-1",
      { deleted: false },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(false);
  });

  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleTrashSession("user-1", "sess-1", {}, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("deleted");
  });

  it("returns 200 with affected=0 when session not found", async () => {
    const env = mockEnv({ runMeta: { changes: 0 } });

    const res = await handleTrashSession(
      "user-1",
      "nonexistent",
      { deleted: true },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(0);
  });
});

// ── handleBatchOperation tests ─────────────────────────────────

describe("handleBatchOperation", () => {
  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleBatchOperation("user-1", null, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing action", async () => {
    const env = mockEnv();

    const res = await handleBatchOperation("user-1", { ids: ["s1"] }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid action");
  });

  it("returns 400 for invalid action", async () => {
    const env = mockEnv();

    const res = await handleBatchOperation(
      "user-1",
      { action: "invalid", ids: ["s1"] },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid action");
  });

  it("returns 400 when no ids or filter provided", async () => {
    const env = mockEnv();

    const res = await handleBatchOperation("user-1", { action: "delete" }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Provide either ids or filter");
  });

  it("performs delete operation", async () => {
    const env = mockEnv({ runMeta: { changes: 2 } });

    const res = await handleBatchOperation(
      "user-1",
      { action: "delete", ids: ["s1", "s2"] },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);
  });

  it("performs restore operation", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleBatchOperation(
      "user-1",
      { action: "restore", ids: ["s1"] },
      env,
    );

    expect(res.status).toBe(200);
  });

  it("performs star operation", async () => {
    const env = mockEnv({ runMeta: { changes: 3 } });

    const res = await handleBatchOperation(
      "user-1",
      { action: "star", ids: ["s1", "s2", "s3"] },
      env,
    );

    expect(res.status).toBe(200);
  });

  it("performs unstar operation", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleBatchOperation(
      "user-1",
      { action: "unstar", ids: ["s1"] },
      env,
    );

    expect(res.status).toBe(200);
  });

  it("performs filter-based operation", async () => {
    const env = mockEnv({ runMeta: { changes: 5 } });

    const res = await handleBatchOperation(
      "user-1",
      { action: "star", filter: { source: "claude-code" } },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(5);
  });

  it("returns 400 when both ids and filter provided", async () => {
    const env = mockEnv();

    const res = await handleBatchOperation(
      "user-1",
      { action: "star", ids: ["s1"], filter: { source: "claude-code" } },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not both");
  });
});

// ── handleConfirmRaw tests ─────────────────────────────────────

describe("handleConfirmRaw", () => {
  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleConfirmRaw("user-1", null, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing sessionKey", async () => {
    const env = mockEnv();

    const res = await handleConfirmRaw(
      "user-1",
      { rawHash: "abc123", rawSize: 1000 },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("sessionKey");
  });

  it("returns 400 for missing rawHash", async () => {
    const env = mockEnv();

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "sess-1", rawSize: 1000 },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("rawHash");
  });

  it("returns 400 for invalid rawHash format", async () => {
    const env = mockEnv();

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "sess-1", rawHash: "not-hex!", rawSize: 1000 },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("hex string");
  });

  it("returns 400 for missing rawSize", async () => {
    const env = mockEnv();

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "sess-1", rawHash: "abc12345" },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("rawSize");
  });

  it("returns 400 for non-positive rawSize", async () => {
    const env = mockEnv();

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "sess-1", rawHash: "abc12345", rawSize: 0 },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("rawSize");
  });

  it("returns 409 when R2 object not found", async () => {
    const db = mockD1();
    const bucket = {
      head: vi.fn().mockResolvedValue(null),
    } as unknown as R2Bucket;
    const env = { DB: db, BUCKET: bucket, WORKER_SECRET: "test" };

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "sess-1", rawHash: "abc12345", rawSize: 1000 },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("R2 object not found");
  });

  it("returns 404 when session not found", async () => {
    const db = mockD1({ runMeta: { changes: 0 } });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 1000 }),
    } as unknown as R2Bucket;
    const env = { DB: db, BUCKET: bucket, WORKER_SECRET: "test" };

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "nonexistent", rawHash: "abc12345", rawSize: 1000 },
      env,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Session not found");
  });

  it("confirms raw upload successfully", async () => {
    const db = mockD1({ runMeta: { changes: 1 } });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 1000 }),
    } as unknown as R2Bucket;
    const env = { DB: db, BUCKET: bucket, WORKER_SECRET: "test" };

    const res = await handleConfirmRaw(
      "user-1",
      { sessionKey: "sess-1", rawHash: "abc12345", rawSize: 1000 },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmed).toBe(true);

    // Verify R2 head was called with correct key
    expect(bucket.head).toHaveBeenCalledWith(
      "user-1/sess-1/raw/abc12345.json.gz",
    );

    // Verify D1 update was called
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    expect(prepare).toHaveBeenCalled();
  });
});
