/**
 * Worker search route handler.
 *
 * Full-text search across message_chunks using FTS5.
 * Query logic reused from packages/web/src/lib/search.ts.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
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

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
]);

/** Control-char delimiters used in FTS5 snippet() — cannot appear in user content */
const SNIPPET_OPEN = "\x01";
const SNIPPET_CLOSE = "\x02";

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

// ── Snippet sanitization ──────────────────────────────────────

/**
 * Sanitize an FTS5 snippet so only our `<mark>` tags survive.
 *
 * 1. HTML-escape the entire string (neutralizes any user-injected HTML)
 * 2. Replace our control-char delimiters with safe `<mark>` / `</mark>`
 */
export function sanitizeSnippet(raw: string): string {
  const escaped = raw.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
  return escaped
    .replaceAll(SNIPPET_OPEN, "<mark>")
    .replaceAll(SNIPPET_CLOSE, "</mark>");
}

// ── Handler ────────────────────────────────────────────────────

/**
 * GET /search — Full-text search across message chunks.
 */
export async function handleSearch(
  userId: string,
  searchParams: URLSearchParams,
  env: Env,
): Promise<Response> {
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return Response.json(
      { error: "Missing required parameter: q" },
      { status: 400 },
    );
  }

  const source = searchParams.get("source");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

  const conditions: string[] = [
    "chunks_fts MATCH ?",
    "mc.user_id = ?",
    "s.deleted_at IS NULL",
  ];
  const queryParams: unknown[] = [q, userId];

  if (source && VALID_SOURCES.has(source)) {
    conditions.push("s.source = ?");
    queryParams.push(source);
  }

  if (from) {
    conditions.push("s.last_message_at >= ?");
    queryParams.push(from);
  }

  if (to) {
    conditions.push("s.last_message_at <= ?");
    queryParams.push(to);
  }

  const where = conditions.join(" AND ");

  const sql = `SELECT mc.session_id, mc.message_id, mc.ordinal, mc.chunk_index,
    snippet(chunks_fts, 0, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '...', 64) AS content_snippet,
    snippet(chunks_fts, 1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '...', 64) AS tool_snippet,
    s.session_key, s.source, s.project_name, s.title, s.started_at
  FROM chunks_fts f
  JOIN message_chunks mc ON mc.rowid = f.rowid
  JOIN sessions s ON mc.session_id = s.id
  WHERE ${where}
  ORDER BY rank
  LIMIT ?`;

  queryParams.push(limit);

  const result = await env.DB.prepare(sql)
    .bind(...queryParams)
    .all<SearchResultRow>();

  // Sanitize snippets before returning
  const results = result.results.map((row) => ({
    ...row,
    content_snippet: sanitizeSnippet(row.content_snippet),
    tool_snippet: row.tool_snippet ? sanitizeSnippet(row.tool_snippet) : null,
  }));

  return Response.json({
    results,
    total: results.length,
  });
}
