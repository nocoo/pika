import { decode } from "@auth/core/jwt";
import { SESSION_COOKIE_NAMES } from "@pika/core";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

export const E2E_TEST_USER_ID = "e2e-test-user-id";

export type AuthVariables = {
  userId: string;
};

export type AuthMiddlewareDeps = {
  /** Returns the AUTH/NEXTAUTH session secret used to decrypt the cookie JWE. */
  getSecret?: () => string | undefined;
  /** Returns the Worker base URL for bearer pk_* validation. */
  getWorkerUrl?: () => string | undefined;
  /** Read NODE_ENV / E2E_SKIP_AUTH at request time. */
  getEnv?: () => NodeJS.ProcessEnv;
  /** Override fetch (test injection). */
  fetch?: typeof fetch;
};

function defaultSecret() {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? undefined;
}
function defaultWorkerUrl() {
  return process.env.WORKER_URL;
}

function isE2EBypassEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.E2E_SKIP_AUTH === "true" && env.NODE_ENV === "development";
}

async function decodeFromCookies(
  c: Context,
  secret: string,
): Promise<string | null> {
  // Try every known cookie name; salt MUST equal the cookie name that
  // produced the value (Auth.js v5 derives the encryption key from salt).
  for (const name of SESSION_COOKIE_NAMES) {
    const token = getCookie(c, name);
    if (!token) continue;
    try {
      const payload = await decode({ token, salt: name, secret });
      const userId = payload?.userId;
      if (typeof userId === "string" && userId.length > 0) {
        return userId;
      }
    } catch {
      // Try next cookie variant; do NOT fall through to bearer here, since
      // a present-but-invalid cookie is a real signal of a stale/forged session.
    }
  }
  return null;
}

async function resolveBearerUser(
  authHeader: string,
  workerUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(new URL("/auth/me", workerUrl), {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { userId?: unknown };
    return typeof body.userId === "string" ? body.userId : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the requesting user. Returns userId or null.
 * Order:
 *   1. E2E bypass (E2E_SKIP_AUTH=true && NODE_ENV=development) → X-E2E-User header
 *   2. Auth.js session cookie (JWE) → token.userId
 *   3. Bearer pk_* → Worker /auth/me
 */
export async function resolveUser(
  c: Context,
  deps: AuthMiddlewareDeps = {},
): Promise<string | null> {
  const env = (deps.getEnv ?? (() => process.env))();
  const fetchImpl = deps.fetch ?? fetch;

  if (isE2EBypassEnabled(env)) {
    const e2eUser = c.req.header("X-E2E-User");
    return e2eUser && e2eUser.length > 0 ? e2eUser : E2E_TEST_USER_ID;
  }

  const secret = (deps.getSecret ?? defaultSecret)();
  if (secret) {
    const cookieUser = await decodeFromCookies(c, secret);
    if (cookieUser) return cookieUser;
  }

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer pk_")) {
    const workerUrl = (deps.getWorkerUrl ?? defaultWorkerUrl)();
    if (workerUrl) {
      return resolveBearerUser(authHeader, workerUrl, fetchImpl);
    }
  }

  return null;
}

/**
 * Hono middleware: 401s unauthenticated requests; otherwise sets `c.var.userId`.
 */
export function requireUser(
  deps: AuthMiddlewareDeps = {},
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const userId = await resolveUser(c, deps);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("userId", userId);
    await next();
  };
}
