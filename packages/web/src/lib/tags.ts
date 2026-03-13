/**
 * Tag query builders — pure functions for tag CRUD and session association.
 *
 * Used by route handlers in /api/tags and /api/sessions/[sessionId]/tags.
 */

// ── Types ──────────────────────────────────────────────────────

export interface TagRow {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface SessionTagRow {
  session_id: string;
  tag_id: string;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export interface CreateTagInput {
  name: string;
  color?: string | null;
}

export interface UpdateTagInput {
  name?: string;
  color?: string | null;
}

// ── Validation ─────────────────────────────────────────────────

const TAG_NAME_MAX = 50;
const TAG_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export interface ValidationError {
  field: string;
  message: string;
}

export function validateCreateTag(input: unknown): {
  valid: boolean;
  errors: ValidationError[];
  data?: CreateTagInput;
} {
  const errors: ValidationError[] = [];
  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Invalid request body" }] };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    errors.push({ field: "name", message: "name is required and must be a non-empty string" });
  } else if (obj.name.trim().length > TAG_NAME_MAX) {
    errors.push({ field: "name", message: `name must be at most ${TAG_NAME_MAX} characters` });
  }

  if (obj.color !== undefined && obj.color !== null) {
    if (typeof obj.color !== "string" || !TAG_COLOR_REGEX.test(obj.color)) {
      errors.push({ field: "color", message: "color must be a hex color (e.g. #ff6b6b)" });
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

export function validateUpdateTag(input: unknown): {
  valid: boolean;
  errors: ValidationError[];
  data?: UpdateTagInput;
} {
  const errors: ValidationError[] = [];
  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Invalid request body" }] };
  }

  const obj = input as Record<string, unknown>;
  const data: UpdateTagInput = {};
  let hasField = false;

  if (obj.name !== undefined) {
    hasField = true;
    if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
      errors.push({ field: "name", message: "name must be a non-empty string" });
    } else if (obj.name.trim().length > TAG_NAME_MAX) {
      errors.push({ field: "name", message: `name must be at most ${TAG_NAME_MAX} characters` });
    } else {
      data.name = obj.name.trim();
    }
  }

  if (obj.color !== undefined) {
    hasField = true;
    if (obj.color === null) {
      data.color = null;
    } else if (typeof obj.color !== "string" || !TAG_COLOR_REGEX.test(obj.color)) {
      errors.push({ field: "color", message: "color must be a hex color (e.g. #ff6b6b) or null" });
    } else {
      data.color = obj.color;
    }
  }

  if (!hasField) {
    errors.push({ field: "body", message: "At least one field (name or color) must be provided" });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data };
}

// ── Query builders ─────────────────────────────────────────────

/** List all tags for a user, ordered by name. */
export function buildListTagsQuery(userId: string): BuiltQuery {
  return {
    sql: "SELECT id, user_id, name, color, created_at FROM tags WHERE user_id = ? ORDER BY name",
    params: [userId],
  };
}

/** Get a single tag by id + user_id. */
export function buildGetTagQuery(tagId: string, userId: string): BuiltQuery {
  return {
    sql: "SELECT id, user_id, name, color, created_at FROM tags WHERE id = ? AND user_id = ?",
    params: [tagId, userId],
  };
}

/** Insert a new tag. Returns the query; caller generates the id. */
export function buildCreateTagQuery(
  id: string,
  userId: string,
  input: CreateTagInput,
): BuiltQuery {
  return {
    sql: "INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?)",
    params: [id, userId, input.name, input.color ?? null],
  };
}

/** Update an existing tag. Only includes provided fields. */
export function buildUpdateTagQuery(
  tagId: string,
  userId: string,
  input: UpdateTagInput,
): BuiltQuery {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    setClauses.push("name = ?");
    params.push(input.name);
  }
  if (input.color !== undefined) {
    setClauses.push("color = ?");
    params.push(input.color);
  }

  params.push(tagId, userId);

  return {
    sql: `UPDATE tags SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`,
    params,
  };
}

/** Delete a tag by id + user_id. */
export function buildDeleteTagQuery(tagId: string, userId: string): BuiltQuery {
  return {
    sql: "DELETE FROM tags WHERE id = ? AND user_id = ?",
    params: [tagId, userId],
  };
}

// ── Session ↔ Tag association ──────────────────────────────────

/** Add a tag to a session. Uses INSERT OR IGNORE for idempotency. */
export function buildAddSessionTagQuery(
  sessionId: string,
  tagId: string,
): BuiltQuery {
  return {
    sql: "INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)",
    params: [sessionId, tagId],
  };
}

/** Remove a tag from a session. */
export function buildRemoveSessionTagQuery(
  sessionId: string,
  tagId: string,
): BuiltQuery {
  return {
    sql: "DELETE FROM session_tags WHERE session_id = ? AND tag_id = ?",
    params: [sessionId, tagId],
  };
}

/** List all tags for a session (joined with tag details). */
export function buildSessionTagsQuery(
  sessionId: string,
  userId: string,
): BuiltQuery {
  return {
    sql: `SELECT t.id, t.user_id, t.name, t.color, t.created_at
          FROM tags t
          INNER JOIN session_tags st ON st.tag_id = t.id
          WHERE st.session_id = ? AND t.user_id = ?
          ORDER BY t.name`,
    params: [sessionId, userId],
  };
}

/**
 * Verify a session belongs to a user.
 * Used before adding/removing tags to prevent cross-user access.
 */
export function buildVerifySessionOwnerQuery(
  sessionId: string,
  userId: string,
): BuiltQuery {
  return {
    sql: "SELECT id FROM sessions WHERE id = ? AND user_id = ?",
    params: [sessionId, userId],
  };
}
