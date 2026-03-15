import { describe, it, expect } from "vitest";
import {
  buildSessionListQuery,
  buildSessionCountQuery,
  buildToggleStarQuery,
  buildFilterOptionsQuery,
  encodeCursor,
  decodeCursor,
  validateSort,
  shapeSessionListResponse,
  shapeOffsetResponse,
  parseSessionListParams,
  type SessionRow,
  type SessionSort,
} from "./sessions";

// ── validateSort ───────────────────────────────────────────────

describe("validateSort", () => {
  it("returns default for undefined", () => {
    expect(validateSort()).toBe("last_message_at");
  });

  it("returns default for invalid sort", () => {
    expect(validateSort("invalid")).toBe("last_message_at");
  });

  it.each([
    "last_message_at",
    "started_at",
    "total_input_tokens",
    "total_messages",
    "duration_seconds",
  ] as SessionSort[])("accepts valid sort: %s", (sort) => {
    expect(validateSort(sort)).toBe(sort);
  });
});

// ── Cursor encoding/decoding ───────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("roundtrips a cursor payload", () => {
    const payload = { v: "2026-01-01T00:00:00Z", id: "sess-1" };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it("roundtrips numeric value", () => {
    const payload = { v: 42000, id: "sess-2" };
    const decoded = decodeCursor(encodeCursor(payload));
    expect(decoded).toEqual(payload);
  });

  it("returns null for undefined cursor", () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for invalid base64", () => {
    expect(decodeCursor("not-base64!!!")).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    expect(decodeCursor(btoa("not json"))).toBeNull();
  });

  it("returns null for valid JSON but missing id", () => {
    expect(decodeCursor(btoa(JSON.stringify({ v: "x" })))).toBeNull();
  });

  it("returns null for valid JSON but missing v", () => {
    expect(decodeCursor(btoa(JSON.stringify({ id: "x" })))).toBeNull();
  });
});

// ── buildSessionListQuery ──────────────────────────────────────

describe("buildSessionListQuery", () => {
  it("builds base query with userId filter", () => {
    const { sql, params } = buildSessionListQuery({ userId: "u1" });

    expect(sql).toContain("FROM sessions s");
    expect(sql).toContain("s.user_id = ?");
    expect(sql).toContain("ORDER BY s.last_message_at DESC, s.id DESC");
    expect(sql).toContain("LIMIT ?");
    expect(params[0]).toBe("u1");
    // limit + 1 = 51
    expect(params[params.length - 1]).toBe(51);
  });

  it("adds source filter", () => {
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      source: "claude-code",
    });

    expect(sql).toContain("s.source = ?");
    expect(params).toContain("claude-code");
  });

  it("adds project filter", () => {
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      project: "abc123",
    });

    expect(sql).toContain("s.project_ref = ?");
    expect(params).toContain("abc123");
  });

  it("adds model filter", () => {
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      model: "claude-4",
    });

    expect(sql).toContain("s.model = ?");
    expect(params).toContain("claude-4");
  });

  it("adds time range filters", () => {
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(sql).toContain("s.last_message_at >= ?");
    expect(sql).toContain("s.last_message_at <= ?");
    expect(params).toContain("2026-01-01");
    expect(params).toContain("2026-12-31");
  });

  it("adds starred filter", () => {
    const { sql } = buildSessionListQuery({
      userId: "u1",
      starred: true,
    });

    expect(sql).toContain("s.is_starred = 1");
  });

  it("does not add starred filter when false/undefined", () => {
    const { sql } = buildSessionListQuery({ userId: "u1" });
    expect(sql).not.toContain("s.is_starred = 1");
  });

  it("adds message range filters", () => {
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      minMessages: 5,
      maxMessages: 100,
    });

    expect(sql).toContain("s.total_messages >= ?");
    expect(sql).toContain("s.total_messages <= ?");
    expect(params).toContain(5);
    expect(params).toContain(100);
  });

  it("applies keyset cursor pagination", () => {
    const cursor = encodeCursor({ v: "2026-03-01T00:00:00Z", id: "sess-5" });
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      cursor,
    });

    expect(sql).toContain("s.last_message_at < ?");
    expect(sql).toContain("s.last_message_at = ? AND s.id < ?");
    expect(params).toContain("2026-03-01T00:00:00Z");
    expect(params).toContain("sess-5");
  });

  it("uses specified sort column", () => {
    const { sql } = buildSessionListQuery({
      userId: "u1",
      sort: "total_input_tokens",
    });

    expect(sql).toContain("ORDER BY s.total_input_tokens DESC");
  });

  it("accepts total_messages sort", () => {
    const { sql } = buildSessionListQuery({
      userId: "u1",
      sort: "total_messages",
    });

    expect(sql).toContain("ORDER BY s.total_messages DESC");
  });

  it("clamps limit to max 100", () => {
    const { params } = buildSessionListQuery({
      userId: "u1",
      limit: 500,
    });

    // limit + 1 = 101
    expect(params[params.length - 1]).toBe(101);
  });

  it("clamps limit to min 1", () => {
    const { params } = buildSessionListQuery({
      userId: "u1",
      limit: 0,
    });

    // limit + 1 = 2
    expect(params[params.length - 1]).toBe(2);
  });

  it("combines all filters", () => {
    const cursor = encodeCursor({ v: "2026-01-15", id: "s3" });
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      source: "opencode",
      project: "proj1",
      from: "2026-01-01",
      to: "2026-02-01",
      starred: true,
      sort: "started_at",
      cursor,
      limit: 25,
    });

    expect(sql).toContain("s.user_id = ?");
    expect(sql).toContain("s.source = ?");
    expect(sql).toContain("s.project_ref = ?");
    expect(sql).toContain("s.last_message_at >= ?");
    expect(sql).toContain("s.last_message_at <= ?");
    expect(sql).toContain("s.is_starred = 1");
    expect(sql).toContain("s.started_at < ?");
    expect(sql).toContain("ORDER BY s.started_at DESC");
    expect(params).toContain("u1");
    expect(params).toContain("opencode");
    expect(params).toContain("proj1");
    expect(params).toContain("2026-01-01");
    expect(params).toContain("2026-02-01");
    // limit + 1 = 26
    expect(params[params.length - 1]).toBe(26);
  });

  // ── Offset pagination ──────────────────────────────────────

  it("uses LIMIT/OFFSET when page is specified", () => {
    const { sql, params } = buildSessionListQuery({
      userId: "u1",
      page: 2,
      limit: 25,
    });

    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(sql).not.toContain("LIMIT ?\n"); // no standalone LIMIT
    // Last two params: limit=25, offset=25 (page 2, 0-indexed)
    expect(params[params.length - 2]).toBe(25);
    expect(params[params.length - 1]).toBe(25);
  });

  it("offset is 0 for page 1", () => {
    const { params } = buildSessionListQuery({
      userId: "u1",
      page: 1,
      limit: 50,
    });

    // limit=50, offset=0
    expect(params[params.length - 2]).toBe(50);
    expect(params[params.length - 1]).toBe(0);
  });

  it("ignores cursor when page is specified", () => {
    const cursor = encodeCursor({ v: "2026-01-01", id: "s1" });
    const { sql } = buildSessionListQuery({
      userId: "u1",
      page: 1,
      cursor,
    });

    // Should not have keyset condition
    expect(sql).not.toContain("s.last_message_at < ?");
    expect(sql).toContain("LIMIT ? OFFSET ?");
  });
});

// ── buildSessionCountQuery ───────────────────────────────────

describe("buildSessionCountQuery", () => {
  it("builds count query with same WHERE filters", () => {
    const { sql, params } = buildSessionCountQuery({
      userId: "u1",
      source: "claude-code",
      starred: true,
    });

    expect(sql).toContain("SELECT COUNT(*) as count");
    expect(sql).toContain("s.user_id = ?");
    expect(sql).toContain("s.source = ?");
    expect(sql).toContain("s.is_starred = 1");
    expect(sql).not.toContain("ORDER BY");
    expect(sql).not.toContain("LIMIT");
    expect(params).toEqual(["u1", "claude-code"]);
  });

  it("includes model filter in count", () => {
    const { sql, params } = buildSessionCountQuery({
      userId: "u1",
      model: "claude-4",
    });

    expect(sql).toContain("s.model = ?");
    expect(params).toContain("claude-4");
  });

  it("includes message range in count", () => {
    const { sql, params } = buildSessionCountQuery({
      userId: "u1",
      minMessages: 10,
      maxMessages: 50,
    });

    expect(sql).toContain("s.total_messages >= ?");
    expect(sql).toContain("s.total_messages <= ?");
    expect(params).toContain(10);
    expect(params).toContain(50);
  });
});

// ── shapeSessionListResponse ───────────────────────────────────

function makeRow(id: string, overrides?: Partial<SessionRow>): SessionRow {
  return {
    id,
    session_key: `claude:${id}`,
    source: "claude-code",
    started_at: "2026-01-01T00:00:00Z",
    last_message_at: "2026-01-01T01:00:00Z",
    duration_seconds: 3600,
    user_messages: 5,
    assistant_messages: 5,
    total_messages: 10,
    total_input_tokens: 1000,
    total_output_tokens: 500,
    total_cached_tokens: 200,
    project_ref: null,
    project_name: null,
    model: "claude-4",
    title: "Test session",
    is_starred: 0,
    ...overrides,
  };
}

describe("shapeSessionListResponse", () => {
  it("returns all rows when count <= limit", () => {
    const rows = [makeRow("1"), makeRow("2")];
    const result = shapeSessionListResponse(rows, "last_message_at", 50);

    expect(result.sessions).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).not.toBeNull();
  });

  it("returns cursor pointing to last row", () => {
    const rows = [
      makeRow("1", { last_message_at: "2026-01-02" }),
      makeRow("2", { last_message_at: "2026-01-01" }),
    ];
    const result = shapeSessionListResponse(rows, "last_message_at", 50);

    const decoded = decodeCursor(result.cursor!);
    expect(decoded).toEqual({ v: "2026-01-01", id: "2" });
  });

  it("detects hasMore when rows > limit and trims extra row", () => {
    // 3 rows returned for limit=2 means there's a next page
    const rows = [makeRow("1"), makeRow("2"), makeRow("3")];
    const result = shapeSessionListResponse(rows, "last_message_at", 2);

    expect(result.sessions).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("returns null cursor for empty results", () => {
    const result = shapeSessionListResponse([], "last_message_at", 50);

    expect(result.sessions).toEqual([]);
    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it("uses correct sort column for cursor value", () => {
    const rows = [makeRow("1", { total_input_tokens: 5000 })];
    const result = shapeSessionListResponse(rows, "total_input_tokens", 50);

    const decoded = decodeCursor(result.cursor!);
    expect(decoded).toEqual({ v: 5000, id: "1" });
  });
});

// ── shapeOffsetResponse ──────────────────────────────────────

describe("shapeOffsetResponse", () => {
  it("includes pagination metadata", () => {
    const rows = [makeRow("1"), makeRow("2")];
    const result = shapeOffsetResponse(rows, 100, 1, 50);

    expect(result.sessions).toHaveLength(2);
    expect(result.totalCount).toBe(100);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBeNull();
  });

  it("hasMore is false on last page", () => {
    const rows = [makeRow("1")];
    const result = shapeOffsetResponse(rows, 51, 2, 50);

    // page 2, pageSize 50: 2 * 50 = 100 > 51 → no more
    expect(result.hasMore).toBe(false);
  });

  it("hasMore is false when total equals page * pageSize", () => {
    const result = shapeOffsetResponse([], 50, 1, 50);
    expect(result.hasMore).toBe(false);
  });

  it("hasMore is true when more rows exist beyond current page", () => {
    const result = shapeOffsetResponse([makeRow("1")], 100, 1, 50);
    expect(result.hasMore).toBe(true);
  });
});

// ── parseSessionListParams ─────────────────────────────────────

describe("parseSessionListParams", () => {
  it("returns defaults for empty search params", () => {
    const params = parseSessionListParams(new URLSearchParams());

    expect(params.source).toBeUndefined();
    expect(params.project).toBeUndefined();
    expect(params.model).toBeUndefined();
    expect(params.from).toBeUndefined();
    expect(params.to).toBeUndefined();
    expect(params.starred).toBeUndefined();
    expect(params.minMessages).toBeUndefined();
    expect(params.maxMessages).toBeUndefined();
    expect(params.sort).toBe("last_message_at");
    expect(params.cursor).toBeUndefined();
    expect(params.page).toBeUndefined();
    expect(params.limit).toBe(50);
  });

  it("parses all params", () => {
    const sp = new URLSearchParams({
      source: "claude-code",
      project: "abc",
      model: "claude-4",
      from: "2026-01-01",
      to: "2026-12-31",
      starred: "true",
      sort: "started_at",
      cursor: "abc123",
      page: "3",
      limit: "25",
      minMessages: "5",
      maxMessages: "100",
    });

    const params = parseSessionListParams(sp);

    expect(params.source).toBe("claude-code");
    expect(params.project).toBe("abc");
    expect(params.model).toBe("claude-4");
    expect(params.from).toBe("2026-01-01");
    expect(params.to).toBe("2026-12-31");
    expect(params.starred).toBe(true);
    expect(params.sort).toBe("started_at");
    expect(params.cursor).toBe("abc123");
    expect(params.page).toBe(3);
    expect(params.limit).toBe(25);
    expect(params.minMessages).toBe(5);
    expect(params.maxMessages).toBe(100);
  });

  it("ignores invalid source", () => {
    const sp = new URLSearchParams({ source: "invalid" });
    expect(parseSessionListParams(sp).source).toBeUndefined();
  });

  it("ignores invalid sort", () => {
    const sp = new URLSearchParams({ sort: "invalid" });
    expect(parseSessionListParams(sp).sort).toBe("last_message_at");
  });

  it("clamps limit to max 100", () => {
    const sp = new URLSearchParams({ limit: "500" });
    expect(parseSessionListParams(sp).limit).toBe(100);
  });

  it("clamps limit to min 1", () => {
    const sp = new URLSearchParams({ limit: "0" });
    expect(parseSessionListParams(sp).limit).toBe(1);
  });

  it("uses default limit for non-numeric input", () => {
    const sp = new URLSearchParams({ limit: "abc" });
    expect(parseSessionListParams(sp).limit).toBe(50);
  });

  it("starred is undefined when not 'true'", () => {
    const sp = new URLSearchParams({ starred: "false" });
    expect(parseSessionListParams(sp).starred).toBeUndefined();
  });

  it("page is undefined for invalid values", () => {
    expect(parseSessionListParams(new URLSearchParams({ page: "abc" })).page).toBeUndefined();
    expect(parseSessionListParams(new URLSearchParams({ page: "0" })).page).toBeUndefined();
    expect(parseSessionListParams(new URLSearchParams({ page: "-1" })).page).toBeUndefined();
  });

  it("parses valid page number", () => {
    expect(parseSessionListParams(new URLSearchParams({ page: "1" })).page).toBe(1);
    expect(parseSessionListParams(new URLSearchParams({ page: "5" })).page).toBe(5);
  });

  it("model is undefined for empty string", () => {
    const sp = new URLSearchParams({ model: "" });
    expect(parseSessionListParams(sp).model).toBeUndefined();
  });
});

// ── buildToggleStarQuery ───────────────────────────────────────

describe("buildToggleStarQuery", () => {
  it("sets is_starred to 1 when starred is true", () => {
    const { sql, params } = buildToggleStarQuery("sess-1", "u1", true);
    expect(sql).toContain("UPDATE sessions SET is_starred = ?");
    expect(sql).toContain("WHERE id = ? AND user_id = ?");
    expect(params).toEqual([1, "sess-1", "u1"]);
  });

  it("sets is_starred to 0 when starred is false", () => {
    const { sql, params } = buildToggleStarQuery("sess-1", "u1", false);
    expect(params).toEqual([0, "sess-1", "u1"]);
  });

  it("scopes update to session owner", () => {
    const { sql } = buildToggleStarQuery("sess-1", "u1", true);
    expect(sql).toContain("user_id = ?");
  });
});

// ── buildFilterOptionsQuery ──────────────────────────────────

describe("buildFilterOptionsQuery", () => {
  it("builds models query scoped to user", () => {
    const { modelsSql, modelsParams } = buildFilterOptionsQuery("u1");
    expect(modelsSql).toContain("SELECT DISTINCT s.model");
    expect(modelsSql).toContain("s.user_id = ?");
    expect(modelsSql).toContain("s.model IS NOT NULL");
    expect(modelsParams).toEqual(["u1"]);
  });

  it("builds projects query scoped to user", () => {
    const { projectsSql, projectsParams } = buildFilterOptionsQuery("u1");
    expect(projectsSql).toContain("SELECT DISTINCT s.project_ref, s.project_name");
    expect(projectsSql).toContain("s.user_id = ?");
    expect(projectsSql).toContain("s.project_ref IS NOT NULL");
    expect(projectsParams).toEqual(["u1"]);
  });
});
