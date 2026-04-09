/**
 * Worker tags route handlers.
 *
 * Tag CRUD and session ↔ tag association.
 * Query logic reused from packages/web/src/lib/tags.ts.
 */

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
}

export interface TagRow {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

// ── Validation ─────────────────────────────────────────────────

const TAG_NAME_MAX = 50;
const TAG_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

interface ValidationError {
  field: string;
  message: string;
}

function validateCreateTag(input: unknown): {
  valid: boolean;
  errors: ValidationError[];
  data?: { name: string; color: string | null };
} {
  const errors: ValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ field: "body", message: "Invalid request body" }],
    };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    errors.push({
      field: "name",
      message: "name is required and must be a non-empty string",
    });
  } else if (obj.name.trim().length > TAG_NAME_MAX) {
    errors.push({
      field: "name",
      message: `name must be at most ${TAG_NAME_MAX} characters`,
    });
  }

  if (obj.color !== undefined && obj.color !== null) {
    if (typeof obj.color !== "string" || !TAG_COLOR_REGEX.test(obj.color)) {
      errors.push({
        field: "color",
        message: "color must be a hex color (e.g. #ff6b6b)",
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      name: (obj.name as string).trim(),
      color: obj.color != null ? (obj.color as string) : null,
    },
  };
}

function validateUpdateTag(input: unknown): {
  valid: boolean;
  errors: ValidationError[];
  data?: { name?: string; color?: string | null };
} {
  const errors: ValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ field: "body", message: "Invalid request body" }],
    };
  }

  const obj = input as Record<string, unknown>;
  const data: { name?: string; color?: string | null } = {};
  let hasField = false;

  if (obj.name !== undefined) {
    hasField = true;
    if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
      errors.push({
        field: "name",
        message: "name must be a non-empty string",
      });
    } else if (obj.name.trim().length > TAG_NAME_MAX) {
      errors.push({
        field: "name",
        message: `name must be at most ${TAG_NAME_MAX} characters`,
      });
    } else {
      data.name = obj.name.trim();
    }
  }

  if (obj.color !== undefined) {
    hasField = true;
    if (obj.color === null) {
      data.color = null;
    } else if (
      typeof obj.color !== "string" ||
      !TAG_COLOR_REGEX.test(obj.color)
    ) {
      errors.push({
        field: "color",
        message: "color must be a hex color (e.g. #ff6b6b) or null",
      });
    } else {
      data.color = obj.color;
    }
  }

  if (!hasField) {
    errors.push({
      field: "body",
      message: "At least one field (name or color) must be provided",
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data };
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Look up a tag by name (case-insensitive).
 * Returns the tag row if found, null otherwise.
 */
async function findTagByName(
  userId: string,
  name: string,
  env: Env,
): Promise<TagRow | null> {
  const sql = `SELECT id, user_id, name, color, created_at FROM tags
    WHERE user_id = ? AND LOWER(name) = LOWER(?)`;
  return env.DB.prepare(sql).bind(userId, name).first<TagRow>();
}

// ── Handlers ───────────────────────────────────────────────────

/**
 * GET /tags — List all tags for a user.
 */
export async function handleListTags(
  userId: string,
  env: Env,
): Promise<Response> {
  const sql =
    "SELECT id, user_id, name, color, created_at FROM tags WHERE user_id = ? ORDER BY name";
  const result = await env.DB.prepare(sql).bind(userId).all<TagRow>();

  return Response.json({ tags: result.results });
}

/**
 * POST /tags — Create a new tag.
 * Uses case-insensitive duplicate check while preserving original case.
 */
export async function handleCreateTag(
  userId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  const validation = validateCreateTag(body);
  if (!validation.valid) {
    return Response.json({ errors: validation.errors }, { status: 400 });
  }

  const { name, color } = validation.data!;

  // Check for case-insensitive duplicate
  const existing = await findTagByName(userId, name, env);
  if (existing) {
    return Response.json(
      { error: `Tag "${existing.name}" already exists (case-insensitive match)` },
      { status: 409 },
    );
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?)",
  )
    .bind(id, userId, name, color)
    .run();

  return Response.json({ id, user_id: userId, name, color }, { status: 201 });
}

/**
 * PATCH /tags/:id — Update a tag.
 * Checks for case-insensitive name conflicts when renaming.
 */
export async function handleUpdateTag(
  userId: string,
  tagId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  const validation = validateUpdateTag(body);
  if (!validation.valid) {
    return Response.json({ errors: validation.errors }, { status: 400 });
  }

  const { name, color } = validation.data!;

  // If renaming, check for case-insensitive conflict
  if (name !== undefined) {
    const existing = await findTagByName(userId, name, env);
    if (existing && existing.id !== tagId) {
      return Response.json(
        { error: `Tag "${existing.name}" already exists (case-insensitive match)` },
        { status: 409 },
      );
    }
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) {
    setClauses.push("name = ?");
    params.push(name);
  }
  if (color !== undefined) {
    setClauses.push("color = ?");
    params.push(color);
  }

  params.push(tagId, userId);

  const sql = `UPDATE tags SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`;
  const result = await env.DB.prepare(sql)
    .bind(...params)
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ error: "Tag not found" }, { status: 404 });
  }

  return Response.json({ updated: true });
}

/**
 * DELETE /tags/:id — Delete a tag.
 */
export async function handleDeleteTag(
  userId: string,
  tagId: string,
  env: Env,
): Promise<Response> {
  const result = await env.DB.prepare(
    "DELETE FROM tags WHERE id = ? AND user_id = ?",
  )
    .bind(tagId, userId)
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ error: "Tag not found" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

// ── Session ↔ Tag association ──────────────────────────────────

/**
 * GET /sessions/:id/tags — List tags for a session.
 */
export async function handleGetSessionTags(
  userId: string,
  sessionId: string,
  env: Env,
): Promise<Response> {
  // Verify session ownership
  const sessionSql = "SELECT id FROM sessions WHERE id = ? AND user_id = ?";
  const session = await env.DB.prepare(sessionSql)
    .bind(sessionId, userId)
    .first();

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const sql = `SELECT t.id, t.user_id, t.name, t.color, t.created_at
    FROM tags t
    INNER JOIN session_tags st ON st.tag_id = t.id
    WHERE st.session_id = ? AND t.user_id = ?
    ORDER BY t.name`;

  const result = await env.DB.prepare(sql)
    .bind(sessionId, userId)
    .all<TagRow>();

  return Response.json({ tags: result.results });
}

/**
 * PUT /sessions/:id/tags — Add a tag to a session.
 */
export async function handleAddSessionTag(
  userId: string,
  sessionId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tagId = (body as Record<string, unknown>).tagId;
  if (typeof tagId !== "string" || !tagId) {
    return Response.json({ error: "tagId is required" }, { status: 400 });
  }

  // Verify session ownership
  const sessionSql = "SELECT id FROM sessions WHERE id = ? AND user_id = ?";
  const session = await env.DB.prepare(sessionSql)
    .bind(sessionId, userId)
    .first();

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  // Verify tag ownership
  const tagSql = "SELECT id FROM tags WHERE id = ? AND user_id = ?";
  const tag = await env.DB.prepare(tagSql).bind(tagId, userId).first();

  if (!tag) {
    return Response.json({ error: "Tag not found" }, { status: 404 });
  }

  // Add association (idempotent)
  await env.DB.prepare(
    "INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)",
  )
    .bind(sessionId, tagId)
    .run();

  return Response.json({ added: true });
}

/**
 * DELETE /sessions/:id/tags — Remove a tag from a session.
 */
export async function handleRemoveSessionTag(
  _userId: string,
  sessionId: string,
  body: unknown,
  env: Env,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tagId = (body as Record<string, unknown>).tagId;
  if (typeof tagId !== "string" || !tagId) {
    return Response.json({ error: "tagId is required" }, { status: 400 });
  }

  await env.DB.prepare(
    "DELETE FROM session_tags WHERE session_id = ? AND tag_id = ?",
  )
    .bind(sessionId, tagId)
    .run();

  return new Response(null, { status: 204 });
}
