/**
 * API tokens repo. Runtime-agnostic: callers supply a thin executor that
 * adapts to bun:sqlite (tests) or Cloudflare D1 (web-worker production).
 *
 * The DB only ever stores the SHA-256 hash; the raw `pk_*` token is shown
 * to the user exactly once at create time. See docs/17 §身份模型 #6.
 */

const TOKEN_PREFIX = "pk_";
const TOKEN_BYTES = 32;
const TOKEN_PREFIX_DISPLAY_LEN = 8;

export interface ApiTokenRow {
  id: number;
  user_id: string;
  email: string;
  token_prefix: string | null;
  hashed: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/**
 * Minimal executor interface. `query` returns rows; `run` executes
 * a write and returns the inserted row id (for AUTOINCREMENT) when
 * available. Both are async to fit D1's HTTP/RPC surface.
 */
export interface ApiTokenExecutor {
  query<T = ApiTokenRow>(sql: string, params: unknown[]): Promise<T[]>;
  run(
    sql: string,
    params: unknown[],
  ): Promise<{ lastInsertId?: number; changes: number }>;
}

export interface CreateApiTokenInput {
  userId: string;
  email: string;
  name?: string | null;
  expiresAt?: string | null;
}

export interface CreatedApiToken {
  token: string;
  id: number;
  tokenPrefix: string;
}

export function hashToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  return crypto.subtle.digest("SHA-256", data).then((buf) => {
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  });
}

export function generateRawToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const body = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${TOKEN_PREFIX}${body}`;
}

export async function createApiToken(
  exec: ApiTokenExecutor,
  input: CreateApiTokenInput,
): Promise<CreatedApiToken> {
  const raw = generateRawToken();
  const hashed = await hashToken(raw);
  const tokenPrefix = raw.slice(0, TOKEN_PREFIX_DISPLAY_LEN);
  const createdAt = new Date().toISOString();
  const result = await exec.run(
    `INSERT INTO api_tokens
       (user_id, email, token_prefix, hashed, name, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      input.userId,
      input.email,
      tokenPrefix,
      hashed,
      input.name ?? null,
      createdAt,
      input.expiresAt ?? null,
    ],
  );
  if (result.lastInsertId === undefined) {
    throw new Error("createApiToken: executor did not return lastInsertId");
  }
  return { token: raw, id: result.lastInsertId, tokenPrefix };
}

/**
 * Look up a token by its raw value. Returns the row when valid and not
 * expired, otherwise null. Does NOT update `last_used_at` — call
 * `updateLastUsed` separately so verification stays a pure read.
 */
export async function findByHashed(
  exec: ApiTokenExecutor,
  rawToken: string,
): Promise<ApiTokenRow | null> {
  if (!rawToken) return null;
  const hashed = await hashToken(rawToken);
  const nowIso = new Date().toISOString();
  const rows = await exec.query<ApiTokenRow>(
    `SELECT * FROM api_tokens
       WHERE hashed = ?
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`,
    [hashed, nowIso],
  );
  return rows[0] ?? null;
}

export async function listByUser(
  exec: ApiTokenExecutor,
  userId: string,
): Promise<ApiTokenRow[]> {
  return exec.query<ApiTokenRow>(
    `SELECT * FROM api_tokens
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    [userId],
  );
}

export async function revoke(
  exec: ApiTokenExecutor,
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await exec.run(
    `DELETE FROM api_tokens WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.changes > 0;
}

export async function updateLastUsed(
  exec: ApiTokenExecutor,
  id: number,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await exec.run(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, [
    nowIso,
    id,
  ]);
}
