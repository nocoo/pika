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
  model?: string;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  starred?: boolean;
  minMessages?: number;
  maxMessages?: number;
  sort?: SessionSort;
  cursor?: string; // opaque base64-encoded keyset cursor
  page?: number; // 1-based page number (offset pagination)
  limit?: number;
  /** true = only deleted (Trash), false/undefined = only active */
  deleted?: boolean;
}

export type SessionSort =
  | "last_message_at"
  | "started_at"
  | "total_input_tokens"
  | "total_messages"
  | "duration_seconds";

const VALID_SORTS: ReadonlySet<string> = new Set<SessionSort>([
  "last_message_at",
  "started_at",
  "total_input_tokens",
  "total_messages",
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
  deleted_at: string | null;
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

// ── Shared WHERE builder ──────────────────────────────────────

function buildWhereClause(params: SessionListParams): {
  conditions: string[];
  queryParams: unknown[];
} {
  const conditions: string[] = ["s.user_id = ?"];
  const queryParams: unknown[] = [params.userId];

  if (params.source) {
    conditions.push("s.source = ?");
    queryParams.push(params.source);
  }

  if (params.project) {
    conditions.push("s.project_ref = ?");
    queryParams.push(params.project);
  }

  if (params.model) {
    conditions.push("s.model = ?");
    queryParams.push(params.model);
  }

  if (params.from) {
    conditions.push("s.last_message_at >= ?");
    queryParams.push(params.from);
  }

  if (params.to) {
    conditions.push("s.last_message_at <= ?");
    queryParams.push(params.to);
  }

  if (params.starred) {
    conditions.push("s.is_starred = 1");
  }

  if (params.minMessages != null) {
    conditions.push("s.total_messages >= ?");
    queryParams.push(params.minMessages);
  }

  if (params.maxMessages != null) {
    conditions.push("s.total_messages <= ?");
    queryParams.push(params.maxMessages);
  }

  // Soft-delete filter: deleted=true → trash only; default → active only
  if (params.deleted === true) {
    conditions.push("s.deleted_at IS NOT NULL");
  } else {
    conditions.push("s.deleted_at IS NULL");
  }

  return { conditions, queryParams };
}

// ── Query builder ──────────────────────────────────────────────

/**
 * Build a paginated, filtered SQL query for the sessions list.
 *
 * Supports two pagination modes:
 * - Keyset (cursor): for infinite scroll — uses cursor token
 * - Offset (page): for DataTable — uses LIMIT/OFFSET
 */
export function buildSessionListQuery(params: SessionListParams): BuiltQuery {
  const sort = validateSort(params.sort);
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const dir = "DESC";
  const op = "<";

  const { conditions, queryParams } = buildWhereClause(params);

  // Cursor (keyset pagination) — only when no page is specified
  if (!params.page) {
    const cursor = decodeCursor(params.cursor);
    if (cursor) {
      conditions.push(`(s.${sort} ${op} ? OR (s.${sort} = ? AND s.id ${op} ?))`);
      queryParams.push(cursor.v, cursor.v, cursor.id);
    }
  }

  const where = conditions.join(" AND ");

  const selectCols = [
    `SELECT s.id, s.session_key, s.source, s.started_at, s.last_message_at,`,
    `  s.duration_seconds, s.user_messages, s.assistant_messages, s.total_messages,`,
    `  s.total_input_tokens, s.total_output_tokens, s.total_cached_tokens,`,
    `  s.project_ref, s.project_name, s.model, s.title, s.is_starred, s.deleted_at`,
  ];

  if (params.page && params.page >= 1) {
    // Offset pagination
    const offset = (params.page - 1) * limit;
    const sql = [
      ...selectCols,
      `FROM sessions s`,
      `WHERE ${where}`,
      `ORDER BY s.${sort} ${dir}, s.id ${dir}`,
      `LIMIT ? OFFSET ?`,
    ].join("\n");

    queryParams.push(limit, offset);
    return { sql, params: queryParams };
  }

  // Keyset pagination (default)
  const sql = [
    ...selectCols,
    `FROM sessions s`,
    `WHERE ${where}`,
    `ORDER BY s.${sort} ${dir}, s.id ${dir}`,
    `LIMIT ?`,
  ].join("\n");

  queryParams.push(limit + 1); // fetch one extra to detect hasMore

  return { sql, params: queryParams };
}

// ── Count query ───────────────────────────────────────────────

/**
 * Build a COUNT query with the same WHERE clause as the list query.
 * Used with offset pagination to calculate total pages.
 */
export function buildSessionCountQuery(params: SessionListParams): BuiltQuery {
  const { conditions, queryParams } = buildWhereClause(params);
  const where = conditions.join(" AND ");

  const sql = `SELECT COUNT(*) as count FROM sessions s WHERE ${where}`;
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
  /** Present only in offset pagination mode */
  totalCount?: number;
  /** Present only in offset pagination mode */
  page?: number;
  /** Present only in offset pagination mode */
  pageSize?: number;
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

/**
 * Shape response for offset pagination mode.
 */
export function shapeOffsetResponse(
  rows: SessionRow[],
  totalCount: number,
  page: number,
  pageSize: number,
): SessionListResponse {
  return {
    sessions: rows,
    cursor: null,
    hasMore: page * pageSize < totalCount,
    totalCount,
    page,
    pageSize,
  };
}

// ── Parse request params ───────────────────────────────────────

export interface ParsedSessionListParams {
  source?: Source;
  project?: string;
  model?: string;
  from?: string;
  to?: string;
  starred?: boolean;
  minMessages?: number;
  maxMessages?: number;
  sort: SessionSort;
  cursor?: string;
  page?: number;
  limit: number;
  deleted?: boolean;
}

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
]);

// ── Star/unstar ────────────────────────────────────────────────

export function buildToggleStarQuery(
  sessionId: string,
  userId: string,
  starred: boolean,
): BuiltQuery {
  return {
    sql: "UPDATE sessions SET is_starred = ? WHERE id = ? AND user_id = ?",
    params: [starred ? 1 : 0, sessionId, userId],
  };
}

// ── Parse request params ───────────────────────────────────────

export function parseSessionListParams(
  searchParams: URLSearchParams,
): ParsedSessionListParams {
  const source = searchParams.get("source") ?? undefined;
  const project = searchParams.get("project") ?? undefined;
  const model = searchParams.get("model") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const starredRaw = searchParams.get("starred");
  const deletedRaw = searchParams.get("deleted");
  const sort = validateSort(searchParams.get("sort") ?? undefined);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

  // Offset pagination
  const pageRaw = searchParams.get("page");
  const parsedPage = pageRaw ? parseInt(pageRaw, 10) : NaN;
  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? undefined : parsedPage;

  // Message range filters
  const minMessagesRaw = searchParams.get("minMessages");
  const parsedMinMessages = minMessagesRaw ? parseInt(minMessagesRaw, 10) : NaN;
  const minMessages = Number.isNaN(parsedMinMessages) ? undefined : parsedMinMessages;

  const maxMessagesRaw = searchParams.get("maxMessages");
  const parsedMaxMessages = maxMessagesRaw ? parseInt(maxMessagesRaw, 10) : NaN;
  const maxMessages = Number.isNaN(parsedMaxMessages) ? undefined : parsedMaxMessages;

  return {
    source: source && VALID_SOURCES.has(source) ? (source as Source) : undefined,
    project,
    model: model || undefined,
    from,
    to,
    starred: starredRaw === "true" ? true : undefined,
    deleted: deletedRaw === "true" ? true : undefined,
    minMessages,
    maxMessages,
    sort,
    cursor,
    page,
    limit,
  };
}

// ── Filter options query ──────────────────────────────────────

export function buildFilterOptionsQuery(userId: string): {
  modelsSql: string;
  modelsParams: unknown[];
  projectsSql: string;
  projectsParams: unknown[];
} {
  return {
    modelsSql: `SELECT DISTINCT s.model FROM sessions s WHERE s.user_id = ? AND s.model IS NOT NULL AND s.deleted_at IS NULL ORDER BY s.model`,
    modelsParams: [userId],
    projectsSql: `SELECT DISTINCT s.project_ref, s.project_name FROM sessions s WHERE s.user_id = ? AND s.project_ref IS NOT NULL AND s.deleted_at IS NULL ORDER BY s.project_name`,
    projectsParams: [userId],
  };
}

// ── Soft-delete / restore ─────────────────────────────────────

export function buildSoftDeleteQuery(
  sessionId: string,
  userId: string,
): BuiltQuery {
  return {
    sql: "UPDATE sessions SET deleted_at = datetime('now') WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    params: [sessionId, userId],
  };
}

export function buildRestoreQuery(
  sessionId: string,
  userId: string,
): BuiltQuery {
  return {
    sql: "UPDATE sessions SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
    params: [sessionId, userId],
  };
}

// ── Batch operations ──────────────────────────────────────────

export type BatchAction = "delete" | "restore" | "star" | "unstar";

export interface BatchByIds {
  action: BatchAction;
  ids: string[];
  userId: string;
}

export interface BatchByFilter {
  action: BatchAction;
  filter: SessionListParams;
}

function batchSetClause(action: BatchAction): string {
  switch (action) {
    case "delete":
      return "deleted_at = datetime('now')";
    case "restore":
      return "deleted_at = NULL";
    case "star":
      return "is_starred = 1";
    case "unstar":
      return "is_starred = 0";
  }
}

/**
 * Build batch update query by explicit IDs.
 * Caller should chunk ids into batches of ≤50 for D1 parameter limits.
 */
export function buildBatchByIdsQuery(batch: BatchByIds): BuiltQuery {
  const placeholders = batch.ids.map(() => "?").join(", ");
  const set = batchSetClause(batch.action);
  return {
    sql: `UPDATE sessions SET ${set} WHERE id IN (${placeholders}) AND user_id = ?`,
    params: [...batch.ids, batch.userId],
  };
}

/**
 * Build batch update query using filter conditions.
 * Reuses buildWhereClause for consistency.
 *
 * SQLite UPDATE does not support table aliases, so we use a subquery:
 * UPDATE sessions SET ... WHERE id IN (SELECT s.id FROM sessions s WHERE ...)
 */
export function buildBatchByFilterQuery(batch: BatchByFilter): BuiltQuery {
  const { conditions, queryParams } = buildWhereClause(batch.filter);
  const set = batchSetClause(batch.action);
  const where = conditions.join(" AND ");
  return {
    sql: `UPDATE sessions SET ${set} WHERE id IN (SELECT s.id FROM sessions s WHERE ${where})`,
    params: queryParams,
  };
}
