/**
 * Sessions query builder and types.
 *
 * Pure functions that construct D1 SQL queries for the sessions API.
 * Extracted from the route handler for testability.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface SessionListParams {
  userId: string;
  source?: Source;
  project?: string;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  starred?: boolean;
  sort?: SessionSort;
  cursor?: string; // opaque base64-encoded keyset cursor
  limit?: number;
}

export type SessionSort =
  | "last_message_at"
  | "started_at"
  | "total_input_tokens"
  | "duration_seconds";

const VALID_SORTS: ReadonlySet<string> = new Set<SessionSort>([
  "last_message_at",
  "started_at",
  "total_input_tokens",
  "duration_seconds",
]);

const DEFAULT_SORT: SessionSort = "last_message_at";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface SessionRow {
  id: string;
  session_key: string;
  source: Source;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  project_ref: string | null;
  project_name: string | null;
  model: string | null;
  title: string | null;
  is_starred: number;
}

export interface CursorPayload {
  /** Value of the sort column at the cursor row */
  v: string | number;
  /** Session id at the cursor row (tiebreaker) */
  id: string;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

// ── Query builder ──────────────────────────────────────────────

/**
 * Build a paginated, filtered SQL query for the sessions list.
 *
 * Uses keyset pagination: the cursor encodes the sort column value
 * and session id from the last row of the previous page.
 */
export function buildSessionListQuery(params: SessionListParams): BuiltQuery {
  const sort = validateSort(params.sort);
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const desc = sort !== "total_input_tokens"; // tokens sort ASC makes no sense, but keep DESC for consistency
  const dir = "DESC";
  const op = "<";

  const conditions: string[] = ["s.user_id = ?"];
  const queryParams: unknown[] = [params.userId];

  // Source filter
  if (params.source) {
    conditions.push("s.source = ?");
    queryParams.push(params.source);
  }

  // Project filter
  if (params.project) {
    conditions.push("s.project_ref = ?");
    queryParams.push(params.project);
  }

  // Time range
  if (params.from) {
    conditions.push("s.last_message_at >= ?");
    queryParams.push(params.from);
  }
  if (params.to) {
    conditions.push("s.last_message_at <= ?");
    queryParams.push(params.to);
  }

  // Starred filter
  if (params.starred) {
    conditions.push("s.is_starred = 1");
  }

  // Cursor (keyset pagination)
  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    // Keyset: (sort_col < cursor_val) OR (sort_col = cursor_val AND id < cursor_id)
    conditions.push(`(s.${sort} ${op} ? OR (s.${sort} = ? AND s.id ${op} ?))`);
    queryParams.push(cursor.v, cursor.v, cursor.id);
  }

  const where = conditions.join(" AND ");

  const sql = [
    `SELECT s.id, s.session_key, s.source, s.started_at, s.last_message_at,`,
    `  s.duration_seconds, s.user_messages, s.assistant_messages, s.total_messages,`,
    `  s.total_input_tokens, s.total_output_tokens, s.total_cached_tokens,`,
    `  s.project_ref, s.project_name, s.model, s.title, s.is_starred`,
    `FROM sessions s`,
    `WHERE ${where}`,
    `ORDER BY s.${sort} ${dir}, s.id ${dir}`,
    `LIMIT ?`,
  ].join("\n");

  queryParams.push(limit + 1); // fetch one extra to detect hasMore

  return { sql, params: queryParams };
}

// ── Cursor encoding/decoding ───────────────────────────────────

export function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload));
}

export function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor));
    if (parsed && typeof parsed.id === "string" && ("v" in parsed)) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Sort validation ────────────────────────────────────────────

export function validateSort(sort?: string): SessionSort {
  if (!sort) return DEFAULT_SORT;
  if (VALID_SORTS.has(sort)) return sort as SessionSort;
  return DEFAULT_SORT;
}

// ── Response shaping ───────────────────────────────────────────

export interface SessionListResponse {
  sessions: SessionRow[];
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Shape raw query results into a paginated response.
 * The query fetches limit+1 rows; if we get more than limit,
 * there are more pages.
 */
export function shapeSessionListResponse(
  rows: SessionRow[],
  sort: SessionSort,
  limit: number,
): SessionListResponse {
  const effectiveLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const hasMore = rows.length > effectiveLimit;
  const sessions = hasMore ? rows.slice(0, effectiveLimit) : rows;
  const lastRow = sessions[sessions.length - 1];

  return {
    sessions,
    cursor: lastRow
      ? encodeCursor({
          v: lastRow[sort] as string | number,
          id: lastRow.id,
        })
      : null,
    hasMore,
  };
}

// ── Parse request params ───────────────────────────────────────

export interface ParsedSessionListParams {
  source?: Source;
  project?: string;
  from?: string;
  to?: string;
  starred?: boolean;
  sort: SessionSort;
  cursor?: string;
  limit: number;
}

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
]);

export function parseSessionListParams(
  searchParams: URLSearchParams,
): ParsedSessionListParams {
  const source = searchParams.get("source") ?? undefined;
  const project = searchParams.get("project") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const starredRaw = searchParams.get("starred");
  const sort = validateSort(searchParams.get("sort") ?? undefined);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

  return {
    source: source && VALID_SOURCES.has(source) ? (source as Source) : undefined,
    project,
    from,
    to,
    starred: starredRaw === "true" ? true : undefined,
    sort,
    cursor,
    limit,
  };
}
