/**
 * Pika Ingest Worker — Cloudflare Worker with D1 + R2 bindings.
 *
 * Receives pre-validated session snapshots from the Next.js API
 * and performs idempotent versioned upserts to D1.
 *
 * Routes:
 * - POST /ingest/sessions — session metadata upsert
 *
 * Auth: shared secret (WORKER_SECRET) via Authorization: Bearer header.
 * Limit: max 50 sessions per request (METADATA_BATCH_SIZE).
 */

import { METADATA_BATCH_SIZE, validateSessionSnapshot } from "@pika/core";
import type { SessionSnapshot } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  WORKER_SECRET: string;
}

export interface IngestSessionPayload {
  userId: string;
  sessions: SessionSnapshot[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Auth ───────────────────────────────────────────────────────

export function validateWorkerAuth(
  request: Request,
  expectedSecret: string,
): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  return auth === `Bearer ${expectedSecret}`;
}

// ── Request validation ─────────────────────────────────────────

export function validateIngestRequest(
  payload: IngestSessionPayload,
): ValidationResult {
  const errors: string[] = [];

  if (!payload.userId) {
    errors.push("Missing userId");
  }

  if (!payload.sessions || payload.sessions.length === 0) {
    errors.push("sessions array must not be empty");
  }

  if (payload.sessions && payload.sessions.length > METADATA_BATCH_SIZE) {
    errors.push(
      `sessions batch size exceeds maximum of ${METADATA_BATCH_SIZE} (got ${payload.sessions.length})`,
    );
  }

  // Validate each session snapshot
  if (payload.sessions) {
    for (let i = 0; i < payload.sessions.length; i++) {
      const sessionErrors = validateSessionSnapshot(payload.sessions[i]);
      for (const err of sessionErrors) {
        errors.push(`sessions[${i}]: ${err}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── SQL ────────────────────────────────────────────────────────

const SESSION_UPSERT_SQL = `INSERT INTO sessions
  (id, user_id, session_key, source, started_at, last_message_at,
   duration_seconds, snapshot_at, user_messages, assistant_messages,
   total_messages, total_input_tokens, total_output_tokens,
   total_cached_tokens, project_ref, project_name, model, title,
   content_hash, raw_hash, parser_revision, schema_version,
   ingested_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
ON CONFLICT (user_id, session_key) DO UPDATE SET
  source = excluded.source,
  started_at = excluded.started_at,
  last_message_at = excluded.last_message_at,
  duration_seconds = excluded.duration_seconds,
  snapshot_at = excluded.snapshot_at,
  user_messages = excluded.user_messages,
  assistant_messages = excluded.assistant_messages,
  total_messages = excluded.total_messages,
  total_input_tokens = excluded.total_input_tokens,
  total_output_tokens = excluded.total_output_tokens,
  total_cached_tokens = excluded.total_cached_tokens,
  project_ref = excluded.project_ref,
  project_name = excluded.project_name,
  model = excluded.model,
  title = excluded.title,
  content_hash = excluded.content_hash,
  raw_hash = excluded.raw_hash,
  parser_revision = excluded.parser_revision,
  schema_version = excluded.schema_version,
  ingested_at = datetime('now'),
  updated_at = datetime('now')
WHERE excluded.snapshot_at >= sessions.snapshot_at`;

// ── Handler ────────────────────────────────────────────────────

export async function handleSessionIngest(
  payload: IngestSessionPayload,
  env: Env,
): Promise<Response> {
  const validation = validateIngestRequest(payload);
  if (!validation.valid) {
    return Response.json({ error: validation.errors }, { status: 400 });
  }

  const { userId, sessions } = payload;

  try {
    const stmts = sessions.map((s) =>
      env.DB.prepare(SESSION_UPSERT_SQL).bind(
        crypto.randomUUID(),
        userId,
        s.sessionKey,
        s.source,
        s.startedAt,
        s.lastMessageAt,
        s.durationSeconds,
        s.snapshotAt,
        s.userMessages,
        s.assistantMessages,
        s.totalMessages,
        s.totalInputTokens,
        s.totalOutputTokens,
        s.totalCachedTokens,
        s.projectRef,
        s.projectName,
        s.model,
        s.title,
        s.contentHash,
        s.rawHash,
        s.parserRevision,
        s.schemaVersion,
      ),
    );

    await env.DB.batch(stmts);

    return Response.json({ ingested: sessions.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `D1 batch failed: ${message}` },
      { status: 500 },
    );
  }
}

// ── Router ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Method check
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // 2. Shared secret auth
    if (!validateWorkerAuth(request, env.WORKER_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Parse JSON body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // 4. Route by URL path
    const url = new URL(request.url);

    if (url.pathname === "/ingest/sessions") {
      return handleSessionIngest(body as IngestSessionPayload, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
