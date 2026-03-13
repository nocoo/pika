import { describe, it, expect } from "vitest";
import {
  buildSearchQuery,
  parseSearchParams,
  isSearchError,
} from "./search.js";

// ── buildSearchQuery ───────────────────────────────────────────

describe("buildSearchQuery", () => {
  it("builds base FTS5 query with userId and search term", () => {
    const { sql, params } = buildSearchQuery({
      userId: "u1",
      q: "error handling",
    });

    expect(sql).toContain("chunks_fts MATCH ?");
    expect(sql).toContain("mc.user_id = ?");
    expect(sql).toContain("snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 64)");
    expect(sql).toContain("snippet(chunks_fts, 1, '<mark>', '</mark>', '...', 64)");
    expect(sql).toContain("FROM chunks_fts f");
    expect(sql).toContain("JOIN message_chunks mc ON mc.rowid = f.rowid");
    expect(sql).toContain("JOIN sessions s ON mc.session_id = s.id");
    expect(sql).toContain("ORDER BY rank");
    expect(sql).toContain("LIMIT ?");
    expect(params[0]).toBe("error handling");
    expect(params[1]).toBe("u1");
    // default limit
    expect(params[params.length - 1]).toBe(50);
  });

  it("adds source filter", () => {
    const { sql, params } = buildSearchQuery({
      userId: "u1",
      q: "test",
      source: "claude-code",
    });

    expect(sql).toContain("s.source = ?");
    expect(params).toContain("claude-code");
  });

  it("adds time range filters", () => {
    const { sql, params } = buildSearchQuery({
      userId: "u1",
      q: "test",
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(sql).toContain("s.last_message_at >= ?");
    expect(sql).toContain("s.last_message_at <= ?");
    expect(params).toContain("2026-01-01");
    expect(params).toContain("2026-12-31");
  });

  it("combines all filters", () => {
    const { sql, params } = buildSearchQuery({
      userId: "u1",
      q: "deploy",
      source: "opencode",
      from: "2026-01-01",
      to: "2026-06-30",
      limit: 25,
    });

    expect(sql).toContain("chunks_fts MATCH ?");
    expect(sql).toContain("mc.user_id = ?");
    expect(sql).toContain("s.source = ?");
    expect(sql).toContain("s.last_message_at >= ?");
    expect(sql).toContain("s.last_message_at <= ?");
    expect(params[0]).toBe("deploy");
    expect(params[1]).toBe("u1");
    expect(params).toContain("opencode");
    expect(params[params.length - 1]).toBe(25);
  });

  it("clamps limit to max 100", () => {
    const { params } = buildSearchQuery({
      userId: "u1",
      q: "test",
      limit: 500,
    });

    expect(params[params.length - 1]).toBe(100);
  });

  it("clamps limit to min 1", () => {
    const { params } = buildSearchQuery({
      userId: "u1",
      q: "test",
      limit: 0,
    });

    expect(params[params.length - 1]).toBe(1);
  });

  it("does not add optional filters when not provided", () => {
    const { sql } = buildSearchQuery({ userId: "u1", q: "test" });

    expect(sql).not.toContain("s.source = ?");
    expect(sql).not.toContain("s.last_message_at >= ?");
    expect(sql).not.toContain("s.last_message_at <= ?");
  });

  it("selects expected columns", () => {
    const { sql } = buildSearchQuery({ userId: "u1", q: "x" });

    expect(sql).toContain("mc.session_id");
    expect(sql).toContain("mc.message_id");
    expect(sql).toContain("mc.ordinal");
    expect(sql).toContain("mc.chunk_index");
    expect(sql).toContain("AS content_snippet");
    expect(sql).toContain("AS tool_snippet");
    expect(sql).toContain("s.session_key");
    expect(sql).toContain("s.source");
    expect(sql).toContain("s.project_name");
    expect(sql).toContain("s.title");
    expect(sql).toContain("s.started_at");
  });
});

// ── parseSearchParams ──────────────────────────────────────────

describe("parseSearchParams", () => {
  it("returns error when q is missing", () => {
    const result = parseSearchParams(new URLSearchParams());
    expect(isSearchError(result)).toBe(true);
    if (isSearchError(result)) {
      expect(result.error).toContain("q");
    }
  });

  it("returns error when q is whitespace-only", () => {
    const result = parseSearchParams(new URLSearchParams({ q: "   " }));
    expect(isSearchError(result)).toBe(true);
  });

  it("parses valid minimal params", () => {
    const result = parseSearchParams(new URLSearchParams({ q: "hello" }));
    expect(isSearchError(result)).toBe(false);
    if (!isSearchError(result)) {
      expect(result.q).toBe("hello");
      expect(result.source).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
      expect(result.limit).toBe(50);
    }
  });

  it("parses all params", () => {
    const result = parseSearchParams(
      new URLSearchParams({
        q: "deploy error",
        source: "codex",
        from: "2026-01-01",
        to: "2026-12-31",
        limit: "25",
      }),
    );

    expect(isSearchError(result)).toBe(false);
    if (!isSearchError(result)) {
      expect(result.q).toBe("deploy error");
      expect(result.source).toBe("codex");
      expect(result.from).toBe("2026-01-01");
      expect(result.to).toBe("2026-12-31");
      expect(result.limit).toBe(25);
    }
  });

  it("ignores invalid source", () => {
    const result = parseSearchParams(
      new URLSearchParams({ q: "test", source: "invalid" }),
    );
    expect(isSearchError(result)).toBe(false);
    if (!isSearchError(result)) {
      expect(result.source).toBeUndefined();
    }
  });

  it("trims query string", () => {
    const result = parseSearchParams(new URLSearchParams({ q: "  hello  " }));
    expect(isSearchError(result)).toBe(false);
    if (!isSearchError(result)) {
      expect(result.q).toBe("hello");
    }
  });

  it("clamps limit", () => {
    const result = parseSearchParams(
      new URLSearchParams({ q: "test", limit: "0" }),
    );
    expect(isSearchError(result)).toBe(false);
    if (!isSearchError(result)) {
      expect(result.limit).toBe(1);
    }
  });

  it("uses default limit for non-numeric", () => {
    const result = parseSearchParams(
      new URLSearchParams({ q: "test", limit: "abc" }),
    );
    expect(isSearchError(result)).toBe(false);
    if (!isSearchError(result)) {
      expect(result.limit).toBe(50);
    }
  });
});

// ── isSearchError ──────────────────────────────────────────────

describe("isSearchError", () => {
  it("returns true for error objects", () => {
    expect(isSearchError({ error: "bad" })).toBe(true);
  });

  it("returns false for valid params", () => {
    expect(isSearchError({ q: "test", limit: 50 })).toBe(false);
  });
});
