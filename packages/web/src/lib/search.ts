/**
 * Search query builder.
 *
 * Full-text search across message_chunks using FTS5, with snippet extraction
 * and optional source/time filters.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface SearchParams {
  userId: string;
  q: string;
  source?: Source;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  limit?: number;
}

export interface SearchResultRow {
  session_id: string;
  message_id: string;
  ordinal: number;
  chunk_index: number;
  content_snippet: string;
  tool_snippet: string | null;
  session_key: string;
  source: Source;
  project_name: string | null;
  title: string | null;
  started_at: string;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
]);

// ── Query builder ──────────────────────────────────────────────

/**
 * Build a full-text search query using FTS5.
 *
 * Searches both `content` and `tool_context` columns in chunks_fts.
 * Returns snippets with `<mark>` highlights.
 */
export function buildSearchQuery(params: SearchParams): BuiltQuery {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const conditions: string[] = [
    "chunks_fts MATCH ?",
    "mc.user_id = ?",
  ];
  const queryParams: unknown[] = [params.q, params.userId];

  if (params.source) {
    conditions.push("s.source = ?");
    queryParams.push(params.source);
  }

  if (params.from) {
    conditions.push("s.last_message_at >= ?");
    queryParams.push(params.from);
  }

  if (params.to) {
    conditions.push("s.last_message_at <= ?");
    queryParams.push(params.to);
  }

  const where = conditions.join(" AND ");

  const sql = [
    `SELECT mc.session_id, mc.message_id, mc.ordinal, mc.chunk_index,`,
    `  snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 64) AS content_snippet,`,
    `  snippet(chunks_fts, 1, '<mark>', '</mark>', '...', 64) AS tool_snippet,`,
    `  s.session_key, s.source, s.project_name, s.title, s.started_at`,
    `FROM chunks_fts f`,
    `JOIN message_chunks mc ON mc.rowid = f.rowid`,
    `JOIN sessions s ON mc.session_id = s.id`,
    `WHERE ${where}`,
    `ORDER BY rank`,
    `LIMIT ?`,
  ].join("\n");

  queryParams.push(limit);

  return { sql, params: queryParams };
}

// ── Parse request params ───────────────────────────────────────

export interface ParsedSearchParams {
  q: string;
  source?: Source;
  from?: string;
  to?: string;
  limit: number;
}

export function parseSearchParams(
  searchParams: URLSearchParams,
): ParsedSearchParams | { error: string } {
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return { error: "Missing required parameter: q" };
  }

  const source = searchParams.get("source") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

  return {
    q,
    source: source && VALID_SOURCES.has(source) ? (source as Source) : undefined,
    from,
    to,
    limit,
  };
}

/**
 * Type guard: check if parsed result is an error.
 */
export function isSearchError(
  result: ParsedSearchParams | { error: string },
): result is { error: string } {
  return "error" in result;
}

// ── Response types ─────────────────────────────────────────────

export interface SearchResponse {
  results: SearchResultRow[];
  total: number;
}
