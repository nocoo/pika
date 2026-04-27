/**
 * In-process ingest + content-read handlers (formerly packages/worker/src/index.ts).
 *
 * Same SQL + R2 logic as the original ingest worker, but exposed as plain
 * async functions that the web-worker mounts directly — no WORKER_SECRET,
 * no service binding, no HTTP hop. The single-worker pivot (docs/17 §pivot)
 * collapsed the three-worker topology into one.
 */

import type { CanonicalSession, SessionSnapshot } from "@pika/core";
import {
  chunkMessages,
  MAX_DECOMPRESSED_CONTENT_BYTES,
  METADATA_BATCH_SIZE,
  PIKA_VERSION,
  validateSessionSnapshot,
} from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
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

const SESSION_VERSION_CHECK_SQL = `SELECT session_key, parser_revision, schema_version
  FROM sessions WHERE user_id = ? AND session_key = ?`;

const SESSION_LOOKUP_SQL = `SELECT id, content_hash, raw_hash, content_key, raw_key, parser_revision, schema_version
  FROM sessions WHERE user_id = ? AND session_key = ?`;

const UPDATE_CANONICAL_SQL = `UPDATE sessions
  SET content_key = ?, content_size = ?, updated_at = datetime('now')
  WHERE id = ?`;

const UPDATE_RAW_SQL = `UPDATE sessions
  SET raw_key = ?, raw_size = ?, updated_at = datetime('now')
  WHERE id = ?`;

const DELETE_MESSAGES_SQL = `DELETE FROM messages WHERE session_id = ?`;

const INSERT_MESSAGE_SQL = `INSERT INTO messages
  (id, session_id, user_id, role, tool_name, tool_input_summary, input_tokens, output_tokens, cached_tokens, model, ordinal, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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

export async function checkVersionConflicts(
  userId: string,
  sessions: SessionSnapshot[],
  db: D1Database,
): Promise<VersionConflict[]> {
  const conflicts: VersionConflict[] = [];

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
    if (!rows || rows.length === 0) continue;

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

// ── Decompression helpers ──────────────────────────────────────

export class DecompressionLimitError extends Error {
  constructor(limit: number) {
    super(`Decompressed content exceeds ${limit} byte limit`);
    this.name = "DecompressionLimitError";
  }
}

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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.length;
    if (totalLength > maxBytes) {
      await reader.cancel();
      throw new DecompressionLimitError(maxBytes);
    }
    chunks.push(value);
  }

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
    const result = await env.DB.prepare(SESSION_LOOKUP_SQL)
      .bind(userId, sessionKey)
      .first<SessionRow>();

    if (!result) {
      return Response.json(
        { error: `Session not found: ${sessionKey}` },
        { status: 404 },
      );
    }

    if (result.content_hash === contentHash && result.content_key) {
      return new Response(null, { status: 204 });
    }

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

    if (!request.body) {
      return Response.json({ error: "Missing request body" }, { status: 400 });
    }

    const compressedBytes = await request.arrayBuffer();
    const compressedSize = compressedBytes.byteLength;

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

    const sessionId = result.id;
    const chunks = chunkMessages(canonical.messages);

    const stmts: D1PreparedStatement[] = [];

    stmts.push(env.DB.prepare(DELETE_MESSAGES_SQL).bind(sessionId));

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
          i,
          msg.timestamp,
        ),
      );
    }

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

    const r2Key = `${userId}/${sessionKey}/canonical.json.gz`;
    const updateStmt = env.DB.prepare(UPDATE_CANONICAL_SQL).bind(
      r2Key,
      compressedSize,
      sessionId,
    );

    await env.BUCKET.put(r2Key, compressedBytes, {
      httpMetadata: {
        contentEncoding: "gzip",
        contentType: "application/json",
      },
    });

    const D1_BATCH_LIMIT = 500;
    for (let i = 0; i < stmts.length; i += D1_BATCH_LIMIT) {
      await env.DB.batch(stmts.slice(i, i + D1_BATCH_LIMIT));
    }

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
    const result = await env.DB.prepare(SESSION_LOOKUP_SQL)
      .bind(userId, sessionKey)
      .first<SessionRow>();

    if (!result) {
      return Response.json(
        { error: `Session not found: ${sessionKey}` },
        { status: 404 },
      );
    }

    if (result.raw_hash === rawHash && result.raw_key) {
      return new Response(null, { status: 204 });
    }

    if (!request.body) {
      return Response.json({ error: "Missing request body" }, { status: 400 });
    }

    const compressedBytes = await request.arrayBuffer();
    const compressedSize = compressedBytes.byteLength;

    const r2Key = `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;
    await env.BUCKET.put(r2Key, compressedBytes, {
      httpMetadata: {
        contentEncoding: "gzip",
        contentType: "application/json",
      },
    });

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

const bootTime = Date.now();

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

// ── Path parsing ───────────────────────────────────────────────

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

// ── Content read ───────────────────────────────────────────────

export async function handleContentRead(
  key: string,
  userId: string,
  env: Env,
): Promise<Response> {
  if (!key.startsWith(`${userId}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const obj = await env.BUCKET.get(key);
  if (!obj) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

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
