/**
 * Session detail query builder.
 *
 * Returns session metadata and constructs the R2 key for canonical content.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface SessionDetailRow {
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
  summary: string | null;
  content_key: string | null;
  content_size: number | null;
  raw_key: string | null;
  raw_size: number | null;
  raw_hash: string | null;
  content_hash: string | null;
  is_starred: number;
  snapshot_at: string;
  ingested_at: string;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

// ── Query builder ──────────────────────────────────────────────

const SESSION_DETAIL_SQL = `
SELECT s.id, s.session_key, s.source, s.started_at, s.last_message_at,
  s.duration_seconds, s.user_messages, s.assistant_messages, s.total_messages,
  s.total_input_tokens, s.total_output_tokens, s.total_cached_tokens,
  s.project_ref, s.project_name, s.model, s.title, s.summary,
  s.content_key, s.content_size, s.raw_key, s.raw_size,
  s.raw_hash, s.content_hash, s.is_starred,
  s.snapshot_at, s.ingested_at
FROM sessions s
WHERE s.id = ? AND s.user_id = ?
`.trim();

export function buildSessionDetailQuery(
  sessionId: string,
  userId: string,
): BuiltQuery {
  return {
    sql: SESSION_DETAIL_SQL,
    params: [sessionId, userId],
  };
}

// ── R2 key helpers ─────────────────────────────────────────────

/**
 * Build canonical R2 key from session metadata.
 * Pattern: `{userId}/{sessionKey}/canonical.json.gz`
 */
export function canonicalR2Key(
  userId: string,
  sessionKey: string,
): string {
  return `${userId}/${sessionKey}/canonical.json.gz`;
}

/**
 * Build raw R2 key from session metadata.
 * Pattern: `{userId}/{sessionKey}/raw/{rawHash}.json.gz`
 */
export function rawR2Key(
  userId: string,
  sessionKey: string,
  rawHash: string,
): string {
  return `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;
}

// ── Response types ─────────────────────────────────────────────

export interface SessionDetailResponse {
  session: SessionDetailRow;
  contentUrl: string | null;
  rawUrl: string | null;
}
