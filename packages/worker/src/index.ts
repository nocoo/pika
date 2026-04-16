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
 * - GET  /content/:key — read content from R2 (decompressed)
 *
 * Read Routes (new):
 * - GET  /sessions — list sessions with filters
 * - GET  /sessions/:id — get session detail
 * - GET  /sessions/:id/content — get session content
 * - GET  /sessions/:id/tags — list tags for session
 * - GET  /sessions/filters — available filter values
 * - GET  /projects — list projects
 * - GET  /projects/activity — activity heatmap
 * - GET  /search — FTS search
 * - GET  /stats — dashboard stats
 * - GET  /tags — list tags
 *
 * Write Routes (new):
 * - PATCH /sessions/:id — update session (title, description)
 * - PATCH /sessions/:id/star — set star status
 * - PATCH /sessions/:id/trash — soft delete/restore
 * - PUT   /sessions/:id/tags — add tag to session
 * - DELETE /sessions/:id/tags — remove tag from session
 * - POST  /sessions/batch — batch operations
 * - POST  /tags — create tag
 * - PATCH /tags/:id — update tag
 * - DELETE /tags/:id — delete tag
 * - POST  /auth/cli-key — generate CLI API key (internal only)
 *
 * Auth: WORKER_SECRET (internal) or pk_... API key (CLI direct).
 * Limit: max 50 sessions per request (METADATA_BATCH_SIZE).
 */

import type { CanonicalSession, SessionSnapshot } from "@pika/core";
import {
  chunkMessages,
  MAX_DECOMPRESSED_CONTENT_BYTES,
  METADATA_BATCH_SIZE,
  PIKA_VERSION,
  validateSessionSnapshot,
} from "@pika/core";
import { hashApiKey, validateAuth } from "./auth.js";
import {
  handleListProjects,
  handleProjectActivity,
} from "./routes/projects.js";
import { handleSearch } from "./routes/search.js";
import {
  handleBatchOperation,
  handleConfirmRaw,
  handleFilters,
  handleGetSession,
  handleGetSessionContent,
  handleListSessions,
  handleSetStar,
  handleTrashSession,
  handleUpdateSession,
} from "./routes/sessions.js";
import { handleStats } from "./routes/stats.js";
import {
  handleAddSessionTag,
  handleCreateTag,
  handleDeleteTag,
  handleGetSessionTags,
  handleListTags,
  handleRemoveSessionTag,
  handleUpdateTag,
} from "./routes/tags.js";

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
 * CASE expressions on content_key/content_size/raw_key/raw_size:
 * When content_hash or raw_hash changes, the corresponding R2 pointer
 * (content_key/raw_key) and size are NULLed. This prevents the content
 * upload idempotency check from returning a false 204 no-op when metadata
 * is upserted before content is uploaded (two-phase pipeline).
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
  content_key = CASE
    WHEN excluded.content_hash != sessions.content_hash OR sessions.content_hash IS NULL
    THEN NULL ELSE sessions.content_key END,
  content_size = CASE
    WHEN excluded.content_hash != sessions.content_hash OR sessions.content_hash IS NULL
    THEN NULL ELSE sessions.content_size END,
  raw_hash = excluded.raw_hash,
  raw_key = CASE
    WHEN excluded.raw_hash != sessions.raw_hash OR sessions.raw_hash IS NULL
    THEN NULL ELSE sessions.raw_key END,
  raw_size = CASE
    WHEN excluded.raw_hash != sessions.raw_hash OR sessions.raw_hash IS NULL
    THEN NULL ELSE sessions.raw_size END,
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

/** Look up session for content ingest — need id, content_hash, raw_hash, content_key, raw_key, parser_revision, schema_version */
const SESSION_LOOKUP_SQL = `SELECT id, content_hash, raw_hash, content_key, raw_key, parser_revision, schema_version
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
          error:
            "Version conflict: incoming version is older than existing data",
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
 * Error thrown when decompressed content exceeds the size limit.
 * Defends against gzip bombs that decompress to enormous payloads.
 */
export class DecompressionLimitError extends Error {
  constructor(limit: number) {
    super(`Decompressed content exceeds ${limit} byte limit`);
    this.name = "DecompressionLimitError";
  }
}

/**
 * Decompress a gzip-compressed request body with size limit enforcement.
 * Uses the DecompressionStream API available in Workers runtime.
 *
 * @param maxBytes - Maximum allowed decompressed size. Defaults to MAX_DECOMPRESSED_CONTENT_BYTES.
 * @throws {DecompressionLimitError} if the decompressed data exceeds maxBytes.
 */
export async function decompressBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number = MAX_DECOMPRESSED_CONTENT_BYTES,
): Promise<string> {
  const ds = new DecompressionStream("gzip") as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >;
  const decompressed = body.pipeThrough(ds);
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.length;
    if (totalLength > maxBytes) {
      // Cancel the stream to release resources
      await reader.cancel();
      throw new DecompressionLimitError(maxBytes);
    }
    chunks.push(value);
  }

  // Concatenate and decode
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
  content_key: string | null;
  raw_key: string | null;
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
  const parserRevision = parseInt(
    request.headers.get("X-Parser-Revision") ?? "",
    10,
  );
  const schemaVersion = parseInt(
    request.headers.get("X-Schema-Version") ?? "",
    10,
  );

  if (!contentHash) {
    return Response.json(
      { error: "Missing X-Content-Hash header" },
      { status: 400 },
    );
  }
  if (Number.isNaN(parserRevision) || parserRevision < 1) {
    return Response.json(
      { error: "Invalid X-Parser-Revision header" },
      { status: 400 },
    );
  }
  if (Number.isNaN(schemaVersion) || schemaVersion < 1) {
    return Response.json(
      { error: "Invalid X-Schema-Version header" },
      { status: 400 },
    );
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

    // 2. Idempotency: if content_hash unchanged AND content already stored → 204 no-op
    if (result.content_hash === contentHash && result.content_key) {
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

    // Decompress to get canonical JSON (with gzip bomb protection)
    const decompressStream = new Blob([compressedBytes]).stream();
    let canonicalJson: string;
    try {
      canonicalJson = await decompressBody(decompressStream);
    } catch (err) {
      if (err instanceof DecompressionLimitError) {
        return Response.json(
          { error: "Decompressed payload too large" },
          { status: 413 },
        );
      }
      throw err;
    }
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

    // Update session content_key + content_size — executed LAST after all
    // message/chunk inserts so that content_key is only set on full success.
    const r2Key = `${userId}/${sessionKey}/canonical.json.gz`;
    const updateStmt = env.DB.prepare(UPDATE_CANONICAL_SQL).bind(
      r2Key,
      compressedSize,
      sessionId,
    );

    // 6. PUT to R2 FIRST — if this fails, no D1 state is corrupted.
    // R2 PUT is idempotent, so retries re-upload harmlessly.
    await env.BUCKET.put(r2Key, compressedBytes, {
      httpMetadata: {
        contentEncoding: "gzip",
        contentType: "application/json",
      },
    });

    // 7. Execute D1 batch SECOND — sets content_key only after R2 succeeds.
    // If D1 fails after R2 succeeds, the orphaned R2 object is harmless
    // and the retry will re-upload R2 (idempotent) then succeed on D1.
    //
    // D1 has a per-batch statement limit. Split into chunks of 500 to avoid
    // exceeding it on large sessions (thousands of messages/chunks).
    //
    // IMPORTANT: Splitting batches breaks single-transaction atomicity.
    // Between the first batch completing and the final content_key UPDATE,
    // message_chunks are FTS-indexed but the session has content_key = NULL.
    // The search route guards against this with `s.content_key IS NOT NULL`.
    // On retry, DELETE_MESSAGES_SQL cascades to chunks, cleaning up dirty state.
    const D1_BATCH_LIMIT = 500;
    for (let i = 0; i < stmts.length; i += D1_BATCH_LIMIT) {
      await env.DB.batch(stmts.slice(i, i + D1_BATCH_LIMIT));
    }

    // Final batch: update content_key only after all inserts succeed
    await env.DB.batch([updateStmt]);

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
    return Response.json(
      { error: "Missing X-Raw-Hash header" },
      { status: 400 },
    );
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

    // 2. Idempotency: if raw_hash unchanged AND raw already stored → 204 no-op
    if (result.raw_hash === rawHash && result.raw_key) {
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
      httpMetadata: {
        contentEncoding: "gzip",
        contentType: "application/json",
      },
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
  component: string;
  timestamp: string;
  uptime: number;
  database?: { connected: boolean; error?: string };
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
  const version = PIKA_VERSION;
  const component = "worker";
  const uptime = Math.round((Date.now() - bootTime) / 1000);
  const timestamp = new Date().toISOString();

  try {
    await env.DB.prepare("SELECT 1 AS probe").first();

    return Response.json(
      {
        status: "ok",
        version,
        component,
        timestamp,
        uptime,
        database: { connected: true },
      } satisfies WorkerLiveResult,
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Sanitize "ok" from error messages to prevent keyword-based monitor false positives
    const message = raw.replace(/\bok\b/gi, "***");

    return Response.json(
      {
        status: "error",
        version,
        component,
        timestamp,
        uptime,
        database: { connected: false, error: message },
      } satisfies WorkerLiveResult,
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
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

// ── Content read ─────────────────────────────────────────────────

/**
 * GET /content/:key — Read an R2 object and return decompressed JSON.
 *
 * The key is the full R2 object path (e.g. `{userId}/{sessionKey}/canonical.json.gz`).
 * Access is scoped by X-User-Id: the key must start with the authenticated user's ID.
 */
async function handleContentRead(
  key: string,
  userId: string,
  env: Env,
): Promise<Response> {
  // Security: ensure the requested key belongs to the authenticated user
  if (!key.startsWith(`${userId}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const obj = await env.BUCKET.get(key);
  if (!obj) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // R2 stores canonical/raw files with contentEncoding: "gzip".
  // The body is raw gzip bytes — decompress via DecompressionStream.
  const isGzip =
    obj.httpMetadata?.contentEncoding === "gzip" || key.endsWith(".gz");

  let body: ReadableStream | ArrayBuffer;
  if (isGzip) {
    body = obj.body.pipeThrough(
      new DecompressionStream("gzip") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >,
    );
  } else {
    body = obj.body;
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300",
    },
  });
}

// ── CLI Key Generation ────────────────────────────────────────────

/**
 * POST /auth/cli-key — Generate a new CLI API key for authenticated user.
 *
 * ⚠️ INTERNAL ONLY: Must be called with auth.source === "internal" (WORKER_SECRET).
 * Rejects API key callers to prevent existing key holders from minting new keys.
 *
 * Called by Next.js /api/auth/cli after OAuth flow completes.
 * Generates fresh key, stores hash in users.api_key, returns plaintext key.
 */
async function handleCliKeyGeneration(
  userId: string,
  authSource: "internal" | "api_key",
  env: Env,
): Promise<Response> {
  // Only allow internal calls (Next.js via WORKER_SECRET)
  if (authSource !== "internal") {
    return Response.json(
      { error: "Forbidden: this endpoint is internal only" },
      { status: 403 },
    );
  }

  // Generate pk_ + 32 hex chars
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const apiKey = `pk_${hex}`;

  // Hash for storage
  const hashedKey = await hashApiKey(apiKey);

  // Store in users.api_key (existing column)
  const result = await env.DB.prepare(
    "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(hashedKey, userId)
    .run();

  // Verify update succeeded (user exists)
  if (result.meta.changes === 0) {
    return Response.json(
      {
        error: `User ${userId} not found. OAuth sign-in may not have persisted the user row.`,
      },
      { status: 404 },
    );
  }

  // Return plaintext key (shown once to user)
  return Response.json({ apiKey });
}

// ── Path extraction helpers ───────────────────────────────────────

/**
 * Extract session ID from /sessions/:id or /sessions/:id/...
 */
function extractSessionId(pathname: string): string {
  const match = pathname.match(/^\/sessions\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Extract tag ID from /tags/:id
 */
function extractTagId(pathname: string): string {
  const match = pathname.match(/^\/tags\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 0. Public health check (before auth — must be accessible by monitors)
    if (request.method === "GET" && url.pathname === "/live") {
      return handleLive(env);
    }

    // 1. Auth check — accepts WORKER_SECRET or pk_... API key
    const auth = await validateAuth(request, env.WORKER_SECRET, env.DB);
    if (!auth.valid) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, source: authSource } = auth;

    // ── GET Routes ────────────────────────────────────────────────

    if (request.method === "GET") {
      // /auth/me — return authenticated user info
      if (url.pathname === "/auth/me") {
        return Response.json({ userId, source: authSource });
      }

      // /sessions — list sessions with filters
      if (url.pathname === "/sessions") {
        return handleListSessions(userId, url.searchParams, env);
      }

      // /sessions/filters — available filter values
      if (url.pathname === "/sessions/filters") {
        return handleFilters(userId, env);
      }

      // /sessions/:id/content — get session content
      if (url.pathname.match(/^\/sessions\/[^/]+\/content$/)) {
        return handleGetSessionContent(
          userId,
          extractSessionId(url.pathname),
          env,
        );
      }

      // /sessions/:id/tags — list tags for session
      if (url.pathname.match(/^\/sessions\/[^/]+\/tags$/)) {
        return handleGetSessionTags(
          userId,
          extractSessionId(url.pathname),
          env,
        );
      }

      // /sessions/:id — get session detail
      if (url.pathname.match(/^\/sessions\/[^/]+$/)) {
        return handleGetSession(userId, extractSessionId(url.pathname), env);
      }

      // /projects/activity — activity heatmap
      if (url.pathname === "/projects/activity") {
        return handleProjectActivity(userId, url.searchParams, env);
      }

      // /projects — list projects
      if (url.pathname === "/projects") {
        return handleListProjects(userId, url.searchParams, env);
      }

      // /search — FTS search
      if (url.pathname === "/search") {
        return handleSearch(userId, url.searchParams, env);
      }

      // /stats — dashboard stats
      if (url.pathname === "/stats") {
        return handleStats(userId, env);
      }

      // /tags — list tags
      if (url.pathname === "/tags") {
        return handleListTags(userId, env);
      }

      // /content/:key — read content from R2
      if (url.pathname.startsWith("/content/")) {
        const key = decodeURIComponent(url.pathname.slice("/content/".length));
        return handleContentRead(key, userId, env);
      }
    }

    // ── POST Routes ───────────────────────────────────────────────

    if (request.method === "POST") {
      // /ingest/sessions — metadata upsert
      if (url.pathname === "/ingest/sessions") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        // SECURITY: Always override body.userId with authenticated user
        // to prevent impersonation via forged payload
        const payload = body as IngestSessionPayload;
        payload.userId = userId;
        return handleSessionIngest(payload, env);
      }

      // /sessions/batch — batch operations
      if (url.pathname === "/sessions/batch") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleBatchOperation(userId, body, env);
      }

      // /tags — create tag
      if (url.pathname === "/tags") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleCreateTag(userId, body, env);
      }

      // /auth/cli-key — generate CLI API key (internal only)
      if (url.pathname === "/auth/cli-key") {
        return handleCliKeyGeneration(userId, authSource, env);
      }

      // /ingest/confirm-raw — confirm direct-to-R2 raw upload
      if (url.pathname === "/ingest/confirm-raw") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleConfirmRaw(userId, body, env);
      }
    }

    // ── PUT Routes ────────────────────────────────────────────────

    if (request.method === "PUT") {
      // /ingest/content/:sessionKey/:type — content upload
      const contentParsed = parseContentPath(url.pathname);
      if (contentParsed) {
        if (contentParsed.type === "canonical") {
          return handleCanonicalUpload(
            contentParsed.sessionKey,
            userId,
            request,
            env,
          );
        }
        return handleRawUpload(contentParsed.sessionKey, userId, request, env);
      }

      // /sessions/:id/tags — add tag to session
      if (url.pathname.match(/^\/sessions\/[^/]+\/tags$/)) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleAddSessionTag(
          userId,
          extractSessionId(url.pathname),
          body,
          env,
        );
      }
    }

    // ── PATCH Routes ──────────────────────────────────────────────

    if (request.method === "PATCH") {
      // /sessions/:id/star — set star status
      if (url.pathname.match(/^\/sessions\/[^/]+\/star$/)) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleSetStar(userId, extractSessionId(url.pathname), body, env);
      }

      // /sessions/:id/trash — soft delete/restore
      if (url.pathname.match(/^\/sessions\/[^/]+\/trash$/)) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleTrashSession(
          userId,
          extractSessionId(url.pathname),
          body,
          env,
        );
      }

      // /sessions/:id — update session (title, description)
      if (url.pathname.match(/^\/sessions\/[^/]+$/)) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleUpdateSession(
          userId,
          extractSessionId(url.pathname),
          body,
          env,
        );
      }

      // /tags/:id — update tag
      if (url.pathname.match(/^\/tags\/[^/]+$/)) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleUpdateTag(userId, extractTagId(url.pathname), body, env);
      }
    }

    // ── DELETE Routes ─────────────────────────────────────────────

    if (request.method === "DELETE") {
      // /sessions/:id/tags — remove tag from session
      if (url.pathname.match(/^\/sessions\/[^/]+\/tags$/)) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        return handleRemoveSessionTag(
          userId,
          extractSessionId(url.pathname),
          body,
          env,
        );
      }

      // /tags/:id — delete tag
      if (url.pathname.match(/^\/tags\/[^/]+$/)) {
        return handleDeleteTag(userId, extractTagId(url.pathname), env);
      }
    }

    // ── 404 Not Found ─────────────────────────────────────────────

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
