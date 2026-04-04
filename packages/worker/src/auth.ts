/**
 * Worker authentication module.
 *
 * Supports two auth mechanisms:
 * 1. WORKER_SECRET — internal Next.js → Worker calls (via X-User-Id header)
 * 2. API key (pk_...) — CLI direct access (hashed lookup in users.api_key)
 */

// ── Types ──────────────────────────────────────────────────────

export interface AuthResult {
  valid: true;
  userId: string;
  source: "internal" | "api_key";
}

export interface AuthFailure {
  valid: false;
}

export type AuthOutcome = AuthResult | AuthFailure;

// ── Hash function ──────────────────────────────────────────────

/**
 * Hash an API key with SHA-256.
 * Returns a lowercase hex digest.
 * Matches packages/web/src/lib/cli-auth.ts hashApiKey.
 */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Auth validation ────────────────────────────────────────────

/**
 * Validate request authentication.
 *
 * @param request - Incoming request
 * @param workerSecret - WORKER_SECRET env var
 * @param db - D1 database binding for API key lookup
 */
export async function validateAuth(
  request: Request,
  workerSecret: string,
  db: D1Database,
): Promise<AuthOutcome> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = auth.slice(7);

  // 1. WORKER_SECRET (internal Next.js → Worker)
  if (token === workerSecret) {
    const userId = request.headers.get("X-User-Id");
    if (!userId) return { valid: false };
    return { valid: true, userId, source: "internal" };
  }

  // 2. API key (pk_...) — CLI direct access
  if (token.startsWith("pk_")) {
    const hashedKey = await hashApiKey(token);
    const user = await db
      .prepare("SELECT id FROM users WHERE api_key = ?")
      .bind(hashedKey)
      .first<{ id: string }>();
    if (!user) return { valid: false };
    return { valid: true, userId: user.id, source: "api_key" };
  }

  return { valid: false };
}

// ── Rate limiting ──────────────────────────────────────────────

/** Simple in-memory rate limiter (resets on worker restart) */
const rateLimits = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if a request is within rate limits.
 *
 * @param key - Rate limit key (e.g., API key or user ID)
 * @param limit - Max requests per window
 * @param windowMs - Window duration in milliseconds
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}
