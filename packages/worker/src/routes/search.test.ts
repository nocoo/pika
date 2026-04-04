/**
 * Worker search route handler tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { Env } from "../index";
import { handleSearch, sanitizeSnippet } from "./search";

// ── Mock helpers ───────────────────────────────────────────────

function mockD1(opts?: { results?: unknown[] }): D1Database {
  const { results = [] } = opts ?? {};

  const preparedStmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  };

  return {
    prepare: vi.fn().mockReturnValue(preparedStmt),
    batch: vi.fn().mockResolvedValue([]),
  } as unknown as D1Database;
}

function mockEnv(dbOpts?: Parameters<typeof mockD1>[0]): Env {
  return {
    DB: mockD1(dbOpts),
    BUCKET: {} as R2Bucket,
    WORKER_SECRET: "test-secret",
  };
}

// ── sanitizeSnippet tests ──────────────────────────────────────

describe("sanitizeSnippet", () => {
  it("escapes HTML characters", () => {
    const input = '<script>alert("xss")</script>';
    const output = sanitizeSnippet(input);

    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
  });

  it("replaces control-char delimiters with mark tags", () => {
    // \x01 = start, \x02 = end
    const input = "hello \x01world\x02 test";
    const output = sanitizeSnippet(input);

    expect(output).toBe("hello <mark>world</mark> test");
  });

  it("escapes HTML before replacing delimiters", () => {
    const input = "<b>\x01match\x02</b>";
    const output = sanitizeSnippet(input);

    expect(output).toBe("&lt;b&gt;<mark>match</mark>&lt;/b&gt;");
  });

  it("handles multiple matches", () => {
    const input = "\x01one\x02 and \x01two\x02";
    const output = sanitizeSnippet(input);

    expect(output).toBe("<mark>one</mark> and <mark>two</mark>");
  });
});

// ── handleSearch tests ─────────────────────────────────────────

describe("handleSearch", () => {
  it("returns 400 when query is missing", async () => {
    const env = mockEnv();

    const params = new URLSearchParams();
    const res = await handleSearch("user-1", params, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required parameter: q");
  });

  it("returns 400 when query is empty", async () => {
    const env = mockEnv();

    const params = new URLSearchParams({ q: "   " });
    const res = await handleSearch("user-1", params, env);

    expect(res.status).toBe(400);
  });

  it("returns search results", async () => {
    const results = [
      {
        session_id: "s1",
        message_id: "m1",
        ordinal: 0,
        chunk_index: 0,
        content_snippet: "test \x01match\x02",
        tool_snippet: null,
        session_key: "claude:abc",
        source: "claude-code",
        project_name: "pika",
        title: "Test",
        started_at: "2026-01-01T10:00:00Z",
      },
    ];
    const env = mockEnv({ results });

    const params = new URLSearchParams({ q: "match" });
    const res = await handleSearch("user-1", params, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].content_snippet).toBe("test <mark>match</mark>");
    expect(body.total).toBe(1);
  });

  it("sanitizes tool_snippet when present", async () => {
    const results = [
      {
        session_id: "s1",
        message_id: "m1",
        ordinal: 0,
        chunk_index: 0,
        content_snippet: "content",
        tool_snippet: "\x01tool\x02",
        session_key: "claude:abc",
        source: "claude-code",
        project_name: null,
        title: null,
        started_at: "2026-01-01T10:00:00Z",
      },
    ];
    const env = mockEnv({ results });

    const params = new URLSearchParams({ q: "tool" });
    const res = await handleSearch("user-1", params, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].tool_snippet).toBe("<mark>tool</mark>");
  });

  it("applies source filter", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ q: "test", source: "claude-code" });
    await handleSearch("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("s.source = ?");
  });

  it("ignores invalid source filter", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ q: "test", source: "invalid" });
    await handleSearch("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).not.toContain("s.source = ?");
  });

  it("applies date range filters", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({
      q: "test",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    await handleSearch("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("s.last_message_at >=");
    expect(sql).toContain("s.last_message_at <=");
  });

  it("respects limit parameter", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ q: "test", limit: "25" });
    await handleSearch("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    expect(bindArgs).toContain(25);
  });

  it("enforces maximum limit", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ q: "test", limit: "999" });
    await handleSearch("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    expect(bindArgs).toContain(100);
  });

  it("uses default limit when not specified", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ q: "test" });
    await handleSearch("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    expect(bindArgs).toContain(50);
  });
});
