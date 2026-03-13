/**
 * Pika Ingest Worker — Cloudflare Worker with D1 + R2 bindings.
 *
 * Receives pre-validated session snapshots from the Next.js API
 * and performs idempotent versioned upserts to D1, with content
 * storage in R2 and chunked FTS indexing.
 *
 * Routes:
 * - GET  /live — public health check (no auth)
 * - POST /ingest/sessions — session metadata upsert
 * - PUT  /ingest/content/:sessionKey/canonical — canonical content upload
 * - PUT  /ingest/content/:sessionKey/raw — raw content upload
 *
 * Auth: shared secret (WORKER_SECRET) via Authorization: Bearer header.
 * Limit: max 50 sessions per request (METADATA_BATCH_SIZE).
 */

import {
  METADATA_BATCH_SIZE,
  validateSessionSnapshot,
  chunkMessages,
} from "@pika/core";
import type {
  SessionSnapshot,
  CanonicalSession,
  CanonicalMessage,
} from "@pika/core";

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

/**
 * Happy-path upsert: INSERT or UPDATE when versions are acceptable.
 *
 * The WHERE clause has two layers of protection:
 * 1. Version floor: incoming parser_revision and schema_version must be
 *    >= the existing row's values (prevents downgrade)
 * 2. Content gate: update only if content actually changed OR version is
 *    strictly newer (prevents redundant writes)
 *
 * The application layer pre-checks versions and returns 409 for older
 * revisions before this SQL is ever executed.
 */
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
WHERE excluded.parser_revision >= sessions.parser_revision
  AND excluded.schema_version >= sessions.schema_version
  AND (
    excluded.content_hash != sessions.content_hash
    OR excluded.raw_hash != sessions.raw_hash
    OR excluded.parser_revision > sessions.parser_revision
    OR excluded.schema_version > sessions.schema_version
  )`;

/**
 * Pre-check SQL: fetch existing version info for sessions that already exist.
 * Used by the application layer to detect and reject stale version uploads
 * with 409 before the upsert is attempted.
 */
const SESSION_VERSION_CHECK_SQL = `SELECT session_key, parser_revision, schema_version
  FROM sessions WHERE user_id = ? AND session_key = ?`;

// ── Content ingest SQL ─────────────────────────────────────────

/** Look up session for content ingest — need id, content_hash, raw_hash, parser_revision, schema_version */
const SESSION_LOOKUP_SQL = `SELECT id, content_hash, raw_hash, parser_revision, schema_version
  FROM sessions WHERE user_id = ? AND session_key = ?`;

/** Update session after canonical content ingest */
const UPDATE_CANONICAL_SQL = `UPDATE sessions
  SET content_key = ?, content_size = ?, updated_at = datetime('now')
  WHERE id = ?`;

/** Update session after raw content ingest */
const UPDATE_RAW_SQL = `UPDATE sessions
  SET raw_key = ?, raw_size = ?, updated_at = datetime('now')
  WHERE id = ?`;

/** Delete existing messages for a session (chunks cascade via ON DELETE CASCADE) */
const DELETE_MESSAGES_SQL = `DELETE FROM messages WHERE session_id = ?`;

/** Insert a message row */
const INSERT_MESSAGE_SQL = `INSERT INTO messages
  (id, session_id, user_id, role, tool_name, tool_input_summary, input_tokens, output_tokens, cached_tokens, model, ordinal, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Insert a message chunk row */
const INSERT_CHUNK_SQL = `INSERT INTO message_chunks
  (id, session_id, message_id, user_id, ordinal, chunk_index, content, tool_context)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

// ── Version check ──────────────────────────────────────────────

export interface VersionConflict {
  sessionKey: string;
  existingParserRevision: number;
  existingSchemaVersion: number;
  incomingParserRevision: number;
  incomingSchemaVersion: number;
}

/**
 * Pre-check versions for all sessions in the batch. Returns a list of
 * conflicts where the incoming version is strictly older than the existing row.
 */
export async function checkVersionConflicts(
  userId: string,
  sessions: SessionSnapshot[],
  db: D1Database,
): Promise<VersionConflict[]> {
  const conflicts: VersionConflict[] = [];

  // Build batch of version check queries
  const stmts = sessions.map((s) =>
    db.prepare(SESSION_VERSION_CHECK_SQL).bind(userId, s.sessionKey),
  );

  const results = await db.batch<{
    session_key: string;
    parser_revision: number;
    schema_version: number;
  }>(stmts);

  for (let i = 0; i < sessions.length; i++) {
    const rows = results[i]?.results;
    if (!rows || rows.length === 0) continue; // New session, no conflict

    const existing = rows[0];
    const incoming = sessions[i];

    if (
      incoming.parserRevision < existing.parser_revision ||
      incoming.schemaVersion < existing.schema_version
    ) {
      conflicts.push({
        sessionKey: incoming.sessionKey,
        existingParserRevision: existing.parser_revision,
        existingSchemaVersion: existing.schema_version,
        incomingParserRevision: incoming.parserRevision,
        incomingSchemaVersion: incoming.schemaVersion,
      });
    }
  }

  return conflicts;
}

// ── Handler: session metadata ──────────────────────────────────

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
    // Pre-check: reject sessions with older parser_revision or schema_version
    const conflicts = await checkVersionConflicts(userId, sessions, env.DB);
    if (conflicts.length > 0) {
      return Response.json(
        {
          error: "Version conflict: incoming version is older than existing data",
          conflicts,
        },
        { status: 409 },
      );
    }

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

// ── Helper: decompress gzip body ───────────────────────────────

/**
 * Decompress a gzip-compressed request body.
 * Uses the DecompressionStream API available in Workers runtime.
 */
export async function decompressBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const decompressed = body.pipeThrough(ds);
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Concatenate and decode
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}

// ── Session lookup type ────────────────────────────────────────

interface SessionRow {
  id: string;
  content_hash: string | null;
  raw_hash: string | null;
  parser_revision: number;
  schema_version: number;
}

// ── Handler: canonical content upload ──────────────────────────

/**
 * Handle PUT /ingest/content/:sessionKey/canonical
 *
 * Flow:
 * 1. Look up session by (userId, sessionKey)
 * 2. Compare content_hash — if unchanged, return 204 (no-op)
 * 3. Check parser_revision — if incoming < existing, return 409
 * 4. Decompress gzip body → parse as CanonicalSession
 * 5. Chunk messages → batch insert messages + chunks into D1
 * 6. PUT compressed body to R2
 * 7. Update session with content_key + content_size
 */
export async function handleCanonicalUpload(
  sessionKey: string,
  userId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const contentHash = request.headers.get("X-Content-Hash");
  const parserRevision = parseInt(request.headers.get("X-Parser-Revision") ?? "", 10);
  const schemaVersion = parseInt(request.headers.get("X-Schema-Version") ?? "", 10);

  if (!contentHash) {
    return Response.json({ error: "Missing X-Content-Hash header" }, { status: 400 });
  }
  if (isNaN(parserRevision) || parserRevision < 1) {
    return Response.json({ error: "Invalid X-Parser-Revision header" }, { status: 400 });
  }
  if (isNaN(schemaVersion) || schemaVersion < 1) {
    return Response.json({ error: "Invalid X-Schema-Version header" }, { status: 400 });
  }

  try {
    // 1. Look up existing session
    const result = await env.DB.prepare(SESSION_LOOKUP_SQL)
      .bind(userId, sessionKey)
      .first<SessionRow>();

    if (!result) {
      return Response.json(
        { error: `Session not found: ${sessionKey}` },
        { status: 404 },
      );
    }

    // 2. Idempotency: if content_hash unchanged → 204 no-op
    if (result.content_hash === contentHash) {
      return new Response(null, { status: 204 });
    }

    // 3. Version check: reject older parser_revision
    if (parserRevision < result.parser_revision) {
      return Response.json(
        {
          error: "Version conflict: incoming parser_revision is older",
          existing: result.parser_revision,
          incoming: parserRevision,
        },
        { status: 409 },
      );
    }

    // 4. Read and tee the body — one stream for decompression, one for R2
    if (!request.body) {
      return Response.json({ error: "Missing request body" }, { status: 400 });
    }

    // Read the entire compressed body into memory (needed for both R2 and decompression)
    const compressedBytes = await request.arrayBuffer();
    const compressedSize = compressedBytes.byteLength;

    // Decompress to get canonical JSON
    const decompressStream = new Blob([compressedBytes]).stream();
    const canonicalJson = await decompressBody(decompressStream);
    const canonical: CanonicalSession = JSON.parse(canonicalJson);

    // 5. Chunk messages and build D1 batch
    const sessionId = result.id;
    const chunks = chunkMessages(canonical.messages);

    const stmts: D1PreparedStatement[] = [];

    // Delete existing messages (chunks cascade via ON DELETE CASCADE)
    stmts.push(env.DB.prepare(DELETE_MESSAGES_SQL).bind(sessionId));

    // Insert messages and collect message IDs
    const messageIds: string[] = [];
    for (let i = 0; i < canonical.messages.length; i++) {
      const msg = canonical.messages[i];
      const messageId = crypto.randomUUID();
      messageIds.push(messageId);

      stmts.push(
        env.DB.prepare(INSERT_MESSAGE_SQL).bind(
          messageId,
          sessionId,
          userId,
          msg.role,
          msg.toolName ?? null,
          msg.toolInput ?? null,
          msg.inputTokens ?? 0,
          msg.outputTokens ?? 0,
          msg.cachedTokens ?? 0,
          msg.model ?? null,
          i, // ordinal
          msg.timestamp,
        ),
      );
    }

    // Insert chunks
    for (const chunk of chunks) {
      const messageId = messageIds[chunk.ordinal];
      stmts.push(
        env.DB.prepare(INSERT_CHUNK_SQL).bind(
          crypto.randomUUID(),
          sessionId,
          messageId,
          userId,
          chunk.ordinal,
          chunk.chunkIndex,
          chunk.content,
          chunk.toolContext,
        ),
      );
    }

    // Update session content_key + content_size
    const r2Key = `${userId}/${sessionKey}/canonical.json.gz`;
    stmts.push(
      env.DB.prepare(UPDATE_CANONICAL_SQL).bind(r2Key, compressedSize, sessionId),
    );

    // Execute D1 batch
    await env.DB.batch(stmts);

    // 6. PUT to R2
    await env.BUCKET.put(r2Key, compressedBytes, {
      httpMetadata: { contentEncoding: "gzip", contentType: "application/json" },
    });

    return Response.json({
      stored: true,
      messages: canonical.messages.length,
      chunks: chunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Canonical ingest failed: ${message}` },
      { status: 500 },
    );
  }
}

// ── Handler: raw content upload ────────────────────────────────

/**
 * Handle PUT /ingest/content/:sessionKey/raw
 *
 * Flow:
 * 1. Look up session by (userId, sessionKey)
 * 2. Compare raw_hash — if unchanged, return 204 (no-op)
 * 3. PUT compressed body to R2 (content-addressed path)
 * 4. Update session with raw_key + raw_size
 */
export async function handleRawUpload(
  sessionKey: string,
  userId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const rawHash = request.headers.get("X-Raw-Hash");

  if (!rawHash) {
    return Response.json({ error: "Missing X-Raw-Hash header" }, { status: 400 });
  }

  try {
    // 1. Look up existing session
    const result = await env.DB.prepare(SESSION_LOOKUP_SQL)
      .bind(userId, sessionKey)
      .first<SessionRow>();

    if (!result) {
      return Response.json(
        { error: `Session not found: ${sessionKey}` },
        { status: 404 },
      );
    }

    // 2. Idempotency: if raw_hash unchanged → 204 no-op
    if (result.raw_hash === rawHash) {
      return new Response(null, { status: 204 });
    }

    // 3. Read compressed body
    if (!request.body) {
      return Response.json({ error: "Missing request body" }, { status: 400 });
    }

    const compressedBytes = await request.arrayBuffer();
    const compressedSize = compressedBytes.byteLength;

    // 4. PUT to R2 — content-addressed, immutable path
    const r2Key = `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;
    await env.BUCKET.put(r2Key, compressedBytes, {
      httpMetadata: { contentEncoding: "gzip", contentType: "application/json" },
    });

    // 5. Update session with raw_key + raw_size
    await env.DB.prepare(UPDATE_RAW_SQL)
      .bind(r2Key, compressedSize, result.id)
      .run();

    return Response.json({ stored: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Raw ingest failed: ${message}` },
      { status: 500 },
    );
  }
}

// ── Handler: health check ──────────────────────────────────────

export interface WorkerLiveResult {
  status: "ok" | "error";
  version: string;
  uptime: number;
  timestamp: string;
  d1?: { latencyMs: number };
  error?: string;
}

/** Boot time for uptime calculation */
const bootTime = Date.now();

/**
 * Lightweight health check — verifies D1 connectivity.
 * Public (no auth required). Used by uptime monitors.
 *
 * Error responses MUST NOT contain the word "ok" to prevent
 * keyword-based monitor false positives.
 */
export async function handleLive(env: Env): Promise<Response> {
  const start = Date.now();
  const version = "0.1.0"; // synced with root package.json
  const uptime = Math.round((Date.now() - bootTime) / 1000);
  const timestamp = new Date().toISOString();

  try {
    await env.DB.prepare("SELECT 1").first();
    const latencyMs = Date.now() - start;

    return Response.json(
      { status: "ok", version, uptime, timestamp, d1: { latencyMs } } satisfies WorkerLiveResult,
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Sanitize "ok" from error messages to prevent keyword-based monitor false positives
    const message = raw.replace(/\bok\b/gi, "***");

    return Response.json(
      { status: "error", version, uptime, timestamp, error: message } satisfies WorkerLiveResult,
      {
        status: 503,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  }
}

// ── Router ─────────────────────────────────────────────────────

/**
 * Parse content ingest path: /ingest/content/:sessionKey/:type
 * Returns null if the path doesn't match.
 */
export function parseContentPath(
  pathname: string,
): { sessionKey: string; type: "canonical" | "raw" } | null {
  const match = pathname.match(/^\/ingest\/content\/([^/]+)\/(canonical|raw)$/);
  if (!match) return null;
  return {
    sessionKey: decodeURIComponent(match[1]),
    type: match[2] as "canonical" | "raw",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 0. Public health check (before auth — must be accessible by monitors)
    if (request.method === "GET" && url.pathname === "/live") {
      return handleLive(env);
    }

    // 1. Shared secret auth (all remaining routes)
    if (!validateWorkerAuth(request, env.WORKER_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. POST /ingest/sessions — metadata upsert
    if (request.method === "POST" && url.pathname === "/ingest/sessions") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      return handleSessionIngest(body as IngestSessionPayload, env);
    }

    // 3. PUT /ingest/content/:sessionKey/:type — content upload
    if (request.method === "PUT") {
      const parsed = parseContentPath(url.pathname);
      if (parsed) {
        const userId = request.headers.get("X-User-Id");
        if (!userId) {
          return Response.json({ error: "Missing X-User-Id header" }, { status: 400 });
        }

        if (parsed.type === "canonical") {
          return handleCanonicalUpload(parsed.sessionKey, userId, request, env);
        }
        return handleRawUpload(parsed.sessionKey, userId, request, env);
      }
    }

    // 4. Method not allowed for known paths
    if (url.pathname === "/ingest/sessions" && request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const contentParsed = parseContentPath(url.pathname);
    if (contentParsed && request.method !== "PUT") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
