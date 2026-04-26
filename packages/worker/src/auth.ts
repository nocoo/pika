/**
 * Worker authentication module.
 *
 * Single auth mechanism: WORKER_SECRET — internal web-worker → API calls
 * (CF Access SSO + bearer auth happens upstream in web-worker).
 */

// ── Types ──────────────────────────────────────────────────────

export interface AuthResult {
  valid: true;
  userId: string;
  source: "internal";
}

export interface AuthFailure {
  valid: false;
}

export type AuthOutcome = AuthResult | AuthFailure;

// ── Auth validation ────────────────────────────────────────────

/**
 * Validate request authentication.
 *
 * @param request - Incoming request
 * @param workerSecret - WORKER_SECRET env var
 */
export async function validateAuth(
  request: Request,
  workerSecret: string,
): Promise<AuthOutcome> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = auth.slice(7);

  if (token !== workerSecret) {
    return { valid: false };
  }

  const userId = request.headers.get("X-User-Id");
  if (!userId) return { valid: false };
  return { valid: true, userId, source: "internal" };
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
