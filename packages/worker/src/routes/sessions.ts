/**
 * Worker sessions route handlers.
 *
 * Handles session list, detail, filters, star, trash, batch operations.
 * Query logic reused from packages/web/src/lib/sessions.ts.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
}

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

export interface SessionDetailRow extends SessionRow {
  summary: string | null;
  content_key: string | null;
  content_size: number | null;
  raw_key: string | null;
  raw_size: number | null;
  raw_hash: string | null;
  content_hash: string | null;
  snapshot_at: string;
  ingested_at: string;
}

export type SessionSort =
  | "last_message_at"
  | "started_at"
  | "total_input_tokens"
  | "total_messages"
  | "duration_seconds";

export type BatchAction = "delete" | "restore" | "star" | "unstar";

// ── Constants ──────────────────────────────────────────────────

const VALID_SORTS = new Set<SessionSort>([
  "last_message_at",
  "started_at",
  "total_input_tokens",
  "total_messages",
  "duration_seconds",
]);

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
]);

const VALID_BATCH_ACTIONS = new Set<BatchAction>([
  "delete",
  "restore",
  "star",
  "unstar",
]);

const DEFAULT_SORT: SessionSort = "last_message_at";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BATCH_IDS = 100;
const BATCH_CHUNK_SIZE = 50;

// ── Cursor encoding/decoding ───────────────────────────────────

interface CursorPayload {
  v: string | number;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload));
}

function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor));
    if (parsed && typeof parsed.id === "string" && "v" in parsed) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function validateSort(sort?: string | null): SessionSort {
  if (!sort) return DEFAULT_SORT;
  if (VALID_SORTS.has(sort as SessionSort)) return sort as SessionSort;
  return DEFAULT_SORT;
}

// ── WHERE clause builder ───────────────────────────────────────

interface WhereParams {
  userId: string;
  source?: string | null;
  project?: string | null;
  projectKey?: string | null;
  model?: string | null;
  from?: string | null;
  to?: string | null;
  starred?: boolean;
  minMessages?: number;
  maxMessages?: number;
  minDuration?: number;
  maxDuration?: number;
  minInputTokens?: number;
  maxInputTokens?: number;
  minOutputTokens?: number;
  maxOutputTokens?: number;
  minTotalTokens?: number;
  maxTotalTokens?: number;
  deleted?: boolean;
  includeDeleted?: boolean;
}

function buildWhereClause(params: WhereParams): {
  conditions: string[];
  queryParams: unknown[];
} {
  const conditions: string[] = ["s.user_id = ?"];
  const queryParams: unknown[] = [params.userId];

  if (params.source && VALID_SOURCES.has(params.source)) {
    conditions.push("s.source = ?");
    queryParams.push(params.source);
  }

  if (params.project) {
    conditions.push("s.project_ref = ?");
    queryParams.push(params.project);
  }

  if (params.projectKey) {
    const keys = params.projectKey.split(",").filter(Boolean);
    if (keys.length === 1) {
      conditions.push("COALESCE(s.project_name, s.project_ref) = ?");
      queryParams.push(keys[0]!);
    } else if (keys.length > 1) {
      const placeholders = keys.map(() => "?").join(", ");
      conditions.push(
        `COALESCE(s.project_name, s.project_ref) IN (${placeholders})`,
      );
      queryParams.push(...keys);
    }
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

  // Duration filters
  if (params.minDuration != null) {
    conditions.push("s.duration_seconds >= ?");
    queryParams.push(params.minDuration);
  }

  if (params.maxDuration != null) {
    conditions.push("s.duration_seconds <= ?");
    queryParams.push(params.maxDuration);
  }

  // Token filters
  if (params.minInputTokens != null) {
    conditions.push("s.total_input_tokens >= ?");
    queryParams.push(params.minInputTokens);
  }

  if (params.maxInputTokens != null) {
    conditions.push("s.total_input_tokens <= ?");
    queryParams.push(params.maxInputTokens);
  }

  if (params.minOutputTokens != null) {
    conditions.push("s.total_output_tokens >= ?");
    queryParams.push(params.minOutputTokens);
  }

  if (params.maxOutputTokens != null) {
    conditions.push("s.total_output_tokens <= ?");
    queryParams.push(params.maxOutputTokens);
  }

  if (params.minTotalTokens != null) {
    conditions.push("(s.total_input_tokens + s.total_output_tokens) >= ?");
    queryParams.push(params.minTotalTokens);
  }

  if (params.maxTotalTokens != null) {
    conditions.push("(s.total_input_tokens + s.total_output_tokens) <= ?");
    queryParams.push(params.maxTotalTokens);
  }

  // Deleted filter:
  // - includeDeleted=true → no filter (show all)
  // - deleted=true → only deleted
  // - default → only non-deleted
  if (!params.includeDeleted) {
    if (params.deleted === true) {
      conditions.push("s.deleted_at IS NOT NULL");
    } else {
      conditions.push("s.deleted_at IS NULL");
    }
  }

  return { conditions, queryParams };
}

// ── Parse request params ───────────────────────────────────────

function parseListParams(searchParams: URLSearchParams) {
  const source = searchParams.get("source");
  const project = searchParams.get("project");
  const projectKey = searchParams.get("projectKey");
  const model = searchParams.get("model");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const starredRaw = searchParams.get("starred");
  const deletedRaw = searchParams.get("deleted");
  const includeDeletedRaw = searchParams.get("includeDeleted");
  const sort = validateSort(searchParams.get("sort"));
  const cursor = searchParams.get("cursor") ?? undefined;

  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

  const pageRaw = searchParams.get("page");
  const parsedPage = pageRaw ? parseInt(pageRaw, 10) : NaN;
  const page =
    Number.isNaN(parsedPage) || parsedPage < 1 ? undefined : parsedPage;

  // Helper to parse integer params
  const parseIntParam = (name: string): number | undefined => {
    const raw = searchParams.get(name);
    if (!raw) return undefined;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return {
    source,
    project,
    projectKey,
    model,
    from,
    to,
    starred: starredRaw === "true",
    deleted: deletedRaw === "true",
    includeDeleted: includeDeletedRaw === "true",
    minMessages: parseIntParam("minMessages"),
    maxMessages: parseIntParam("maxMessages"),
    minDuration: parseIntParam("minDuration"),
    maxDuration: parseIntParam("maxDuration"),
    minInputTokens: parseIntParam("minInputTokens"),
    maxInputTokens: parseIntParam("maxInputTokens"),
    minOutputTokens: parseIntParam("minOutputTokens"),
    maxOutputTokens: parseIntParam("maxOutputTokens"),
    minTotalTokens: parseIntParam("minTotalTokens"),
    maxTotalTokens: parseIntParam("maxTotalTokens"),
    sort,
    cursor,
    page,
    limit,
  };
}

// ── Handlers ───────────────────────────────────────────────────

/**
 * GET /sessions — List sessions with filters and pagination.
 */
export async function handleListSessions(
  userId: string,
  searchParams: URLSearchParams,
  env: Env,
): Promise<Response> {
  const params = parseListParams(searchParams);
  const { sort, limit, cursor, page } = params;
  const dir = "DESC";
  const op = "<";

  const { conditions, queryParams } = buildWhereClause({
    userId,
    source: params.source,
    project: params.project,
    projectKey: params.projectKey,
    model: params.model,
    from: params.from,
    to: params.to,
    starred: params.starred,
    minMessages: params.minMessages,
    maxMessages: params.maxMessages,
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    minInputTokens: params.minInputTokens,
    maxInputTokens: params.maxInputTokens,
    minOutputTokens: params.minOutputTokens,
    maxOutputTokens: params.maxOutputTokens,
    minTotalTokens: params.minTotalTokens,
    maxTotalTokens: params.maxTotalTokens,
    deleted: params.deleted,
    includeDeleted: params.includeDeleted,
  });

  // Cursor (keyset pagination) — only when no page is specified
  if (!page) {
    const cursorData = decodeCursor(cursor);
    if (cursorData) {
      conditions.push(
        `(s.${sort} ${op} ? OR (s.${sort} = ? AND s.id ${op} ?))`,
      );
      queryParams.push(cursorData.v, cursorData.v, cursorData.id);
    }
  }

  const where = conditions.join(" AND ");

  const selectCols = `SELECT s.id, s.session_key, s.source, s.started_at, s.last_message_at,
    s.duration_seconds, s.user_messages, s.assistant_messages, s.total_messages,
    s.total_input_tokens, s.total_output_tokens, s.total_cached_tokens,
    s.project_ref, s.project_name, s.model, s.title, s.is_starred, s.deleted_at`;

  let sql: string;
  if (page && page >= 1) {
    // Offset pagination
    const offset = (page - 1) * limit;
    sql = `${selectCols}
      FROM sessions s
      WHERE ${where}
      ORDER BY s.${sort} ${dir}, s.id ${dir}
      LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    // Get total count for offset pagination
    const countSql = `SELECT COUNT(*) as count FROM sessions s WHERE ${where}`;
    const countParams = queryParams.slice(0, -2); // Remove LIMIT and OFFSET

    const [result, countResult] = await Promise.all([
      env.DB.prepare(sql)
        .bind(...queryParams)
        .all<SessionRow>(),
      env.DB.prepare(countSql)
        .bind(...countParams)
        .first<{ count: number }>(),
    ]);

    return Response.json({
      sessions: result.results,
      cursor: null,
      hasMore: page * limit < (countResult?.count ?? 0),
      totalCount: countResult?.count ?? 0,
      page,
      pageSize: limit,
    });
  }

  // Keyset pagination (default)
  sql = `${selectCols}
    FROM sessions s
    WHERE ${where}
    ORDER BY s.${sort} ${dir}, s.id ${dir}
    LIMIT ?`;
  queryParams.push(limit + 1); // fetch one extra to detect hasMore

  const result = await env.DB.prepare(sql)
    .bind(...queryParams)
    .all<SessionRow>();
  const rows = result.results;
  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = sessions[sessions.length - 1];

  return Response.json({
    sessions,
    cursor: lastRow
      ? encodeCursor({ v: lastRow[sort] as string | number, id: lastRow.id })
      : null,
    hasMore,
  });
}

/**
 * GET /sessions/:id — Get session detail.
 */
export async function handleGetSession(
  userId: string,
  sessionId: string,
  env: Env,
): Promise<Response> {
  const sql = `SELECT s.id, s.session_key, s.source, s.started_at, s.last_message_at,
    s.duration_seconds, s.user_messages, s.assistant_messages, s.total_messages,
    s.total_input_tokens, s.total_output_tokens, s.total_cached_tokens,
    s.project_ref, s.project_name, s.model, s.title, s.summary, s.description,
    s.content_key, s.content_size, s.raw_key, s.raw_size,
    s.raw_hash, s.content_hash, s.is_starred, s.deleted_at,
    s.snapshot_at, s.ingested_at
    FROM sessions s
    WHERE s.id = ? AND s.user_id = ?`;

  const row = await env.DB.prepare(sql)
    .bind(sessionId, userId)
    .first<SessionDetailRow>();

  if (!row) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({ session: row });
}

/**
 * GET /sessions/:id/content — Get session content from R2.
 */
export async function handleGetSessionContent(
  userId: string,
  sessionId: string,
  env: Env,
): Promise<Response> {
  // First, look up content_key from D1
  const sql = `SELECT content_key FROM sessions WHERE id = ? AND user_id = ?`;
  const row = await env.DB.prepare(sql)
    .bind(sessionId, userId)
    .first<{ content_key: string | null }>();

  if (!row) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (!row.content_key) {
    return new Response(null, { status: 204 });
  }

  // Verify the key belongs to this user (security check)
  if (!row.content_key.startsWith(`${userId}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get from R2
  const obj = await env.BUCKET.get(row.content_key);
  if (!obj) {
    return Response.json({ error: "Content not found" }, { status: 404 });
  }

  // Decompress if gzipped
  const isGzip =
    obj.httpMetadata?.contentEncoding === "gzip" ||
    row.content_key.endsWith(".gz");

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

/**
 * GET /sessions/filters — Get available filter options.
 */
export async function handleFilters(
  userId: string,
  env: Env,
): Promise<Response> {
  const modelsSql = `SELECT DISTINCT s.model FROM sessions s WHERE s.user_id = ? AND s.model IS NOT NULL AND s.deleted_at IS NULL ORDER BY s.model`;
  const projectsSql = `SELECT DISTINCT s.project_ref AS ref, s.project_name AS name FROM sessions s WHERE s.user_id = ? AND s.project_ref IS NOT NULL AND s.deleted_at IS NULL ORDER BY s.project_name`;

  const [modelsResult, projectsResult] = await Promise.all([
    env.DB.prepare(modelsSql).bind(userId).all<{ model: string }>(),
    env.DB.prepare(projectsSql)
      .bind(userId)
      .all<{ ref: string; name: string | null }>(),
  ]);

  return Response.json({
    models: modelsResult.results.map((r) => r.model),
    projects: projectsResult.results,
  });
}

/**
 * PATCH /sessions/:id/star — Set star status.
 */
export async function handleSetStar(
  userId: string,
  sessionId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const starred = (body as Record<string, unknown>).starred;
  if (typeof starred !== "boolean") {
    return Response.json(
      { error: "starred (boolean) is required" },
      { status: 400 },
    );
  }

  const result = await env.DB.prepare(
    "UPDATE sessions SET is_starred = ? WHERE id = ? AND user_id = ?",
  )
    .bind(starred ? 1 : 0, sessionId, userId)
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({ starred });
}

/**
 * PATCH /sessions/:id/trash — Soft delete or restore.
 */
export async function handleTrashSession(
  userId: string,
  sessionId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const deleted = (body as Record<string, unknown>).deleted;
  if (typeof deleted !== "boolean") {
    return Response.json(
      { error: "deleted (boolean) is required" },
      { status: 400 },
    );
  }

  const sql = deleted
    ? "UPDATE sessions SET deleted_at = datetime('now') WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
    : "UPDATE sessions SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL";

  const result = await env.DB.prepare(sql).bind(sessionId, userId).run();

  return Response.json({
    deleted,
    deleted_at: deleted ? new Date().toISOString() : null,
    affected: result.meta.changes,
  });
}

/**
 * PATCH /sessions/:id — Update session metadata (title, description).
 */
export async function handleUpdateSession(
  userId: string,
  sessionId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;

  // Build SET clause dynamically
  const updates: string[] = [];
  const params: unknown[] = [];

  if ("title" in data) {
    const title = data.title;
    if (title !== null && typeof title !== "string") {
      return Response.json(
        { error: "title must be a string or null" },
        { status: 400 },
      );
    }
    updates.push("title = ?");
    params.push(title);
  }

  if ("description" in data) {
    const description = data.description;
    if (description !== null && typeof description !== "string") {
      return Response.json(
        { error: "description must be a string or null" },
        { status: 400 },
      );
    }
    updates.push("description = ?");
    params.push(description);
  }

  if (updates.length === 0) {
    return Response.json(
      { error: "No valid fields to update (title, description)" },
      { status: 400 },
    );
  }

  updates.push("updated_at = datetime('now')");

  const sql = `UPDATE sessions SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`;
  params.push(sessionId, userId);

  const result = await env.DB.prepare(sql)
    .bind(...params)
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  // Fetch updated session to return current values
  const updatedRow = await env.DB.prepare(
    "SELECT id, title, description, updated_at FROM sessions WHERE id = ? AND user_id = ?",
  )
    .bind(sessionId, userId)
    .first<{
      id: string;
      title: string | null;
      description: string | null;
      updated_at: string;
    }>();

  return Response.json(updatedRow);
}

/**
 * POST /sessions/batch — Batch operations on sessions.
 */
export async function handleBatchOperation(
  userId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action, ids, filter } = body as {
    action?: string;
    ids?: string[];
    filter?: Record<string, unknown>;
  };

  // Validate action
  if (!action || !VALID_BATCH_ACTIONS.has(action as BatchAction)) {
    return Response.json(
      {
        error: `Invalid action. Must be one of: ${[...VALID_BATCH_ACTIONS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const hasIds = Array.isArray(ids) && ids.length > 0;
  const hasFilter = filter != null && typeof filter === "object";

  if (hasIds && hasFilter) {
    return Response.json(
      { error: "Provide either ids or filter, not both" },
      { status: 400 },
    );
  }

  if (!hasIds && !hasFilter) {
    return Response.json(
      { error: "Provide either ids or filter" },
      { status: 400 },
    );
  }

  const setClause = batchSetClause(action as BatchAction);
  let totalAffected = 0;

  if (hasIds) {
    if (ids!.length > MAX_BATCH_IDS) {
      return Response.json(
        { error: `Too many IDs. Maximum is ${MAX_BATCH_IDS}` },
        { status: 400 },
      );
    }

    if (!ids!.every((id) => typeof id === "string" && id.length > 0)) {
      return Response.json(
        { error: "All IDs must be non-empty strings" },
        { status: 400 },
      );
    }

    // Chunk into batches
    for (let i = 0; i < ids!.length; i += BATCH_CHUNK_SIZE) {
      const chunk = ids!.slice(i, i + BATCH_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const sql = `UPDATE sessions SET ${setClause} WHERE id IN (${placeholders}) AND user_id = ?`;
      const result = await env.DB.prepare(sql)
        .bind(...chunk, userId)
        .run();
      totalAffected += result.meta.changes;
    }
  } else {
    // Filter mode
    const { conditions, queryParams } = buildWhereClause({
      userId,
      source: filter!.source as string | undefined,
      model: filter!.model as string | undefined,
      starred: filter!.starred === true,
      minMessages: filter!.minMessages as number | undefined,
      maxMessages: filter!.maxMessages as number | undefined,
      deleted: filter!.deleted === true,
    });

    const where = conditions.join(" AND ");
    const sql = `UPDATE sessions SET ${setClause} WHERE id IN (SELECT s.id FROM sessions s WHERE ${where})`;
    const result = await env.DB.prepare(sql)
      .bind(...queryParams)
      .run();
    totalAffected = result.meta.changes;
  }

  return Response.json({ affected: totalAffected });
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

// ── Confirm raw upload ────────────────────────────────────────────

interface ConfirmRawBody {
  sessionKey: string;
  rawHash: string;
  rawSize: number;
}

/**
 * POST /ingest/confirm-raw — Confirm a direct-to-R2 raw upload.
 *
 * Called after CLI uploads raw content directly to R2 via presigned URL.
 * Verifies the R2 object exists, then updates D1 metadata.
 */
export async function handleConfirmRaw(
  userId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  // Validate body
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.sessionKey !== "string" || !obj.sessionKey) {
    return Response.json(
      { error: "sessionKey (non-empty string) is required" },
      { status: 400 },
    );
  }

  if (typeof obj.rawHash !== "string" || !obj.rawHash) {
    return Response.json(
      { error: "rawHash (non-empty string) is required" },
      { status: 400 },
    );
  }

  if (!/^[0-9a-f]{8,128}$/i.test(obj.rawHash)) {
    return Response.json(
      { error: "rawHash must be a hex string (8-128 chars)" },
      { status: 400 },
    );
  }

  if (
    typeof obj.rawSize !== "number" ||
    obj.rawSize <= 0 ||
    !Number.isInteger(obj.rawSize)
  ) {
    return Response.json(
      { error: "rawSize (positive integer) is required" },
      { status: 400 },
    );
  }

  const { sessionKey, rawHash, rawSize } = obj as unknown as ConfirmRawBody;

  // Build R2 key
  const r2Key = `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;

  // Verify R2 object exists using head
  const headResult = await env.BUCKET.head(r2Key);
  if (!headResult) {
    return Response.json(
      { error: "R2 object not found: raw upload not verified" },
      { status: 409 },
    );
  }

  // Update D1
  const result = await env.DB.prepare(
    `UPDATE sessions
     SET raw_key = ?, raw_size = ?, raw_hash = ?, updated_at = datetime('now')
     WHERE user_id = ? AND session_key = ?`,
  )
    .bind(r2Key, rawSize, rawHash, userId, sessionKey)
    .run();

  if (result.meta.changes === 0) {
    return Response.json(
      { error: `Session not found: ${sessionKey}` },
      { status: 404 },
    );
  }

  return Response.json({ confirmed: true });
}
