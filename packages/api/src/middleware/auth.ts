import type { Context, MiddlewareHandler } from "hono";

export const E2E_TEST_USER_ID = "e2e-test-user-id";

export type AuthVariables = {
  userId: string;
};

/**
 * docs/17 §安全边界 / Bearer 链路重写：packages/api 在终态架构中不
 * 接受 cookie 或 Bearer token。它只信任 service-binding peer 注入的
 * `X-Pika-User-Id` 头部 —— 唯一的信任根是 web-worker（在公网入口完成
 * CF Access JWT + pk_* 校验后注入此头）。
 *
 * 所以这里的中间件是个"剥离"层：把信任延伸到 c.var.userId，再无其他。
 */

export type AuthEnv = {
  ENVIRONMENT?: string;
  E2E_SKIP_AUTH?: string;
};

export type AuthMiddlewareDeps = {
  /** Read ENVIRONMENT / E2E_SKIP_AUTH at request time. */
  getEnv?: () => AuthEnv;
};

function defaultEnv(): AuthEnv {
  return process.env as AuthEnv;
}

function isE2EBypassEnabled(env: AuthEnv): boolean {
  return env.E2E_SKIP_AUTH === "true" && env.ENVIRONMENT !== "production";
}

/**
 * Resolve the requesting user. Returns userId or null.
 * Order:
 *   1. E2E bypass (E2E_SKIP_AUTH=true && ENVIRONMENT !== "production") →
 *      `X-E2E-User` header (or `E2E_TEST_USER_ID` fallback)
 *   2. `X-Pika-User-Id` header (set by web-worker after public-edge auth)
 *   3. otherwise: null → 401
 */
export function resolveUser(
  c: Context,
  deps: AuthMiddlewareDeps = {},
): string | null {
  const env = (deps.getEnv ?? defaultEnv)();

  if (isE2EBypassEnabled(env)) {
    const e2eUser = c.req.header("X-E2E-User");
    return e2eUser && e2eUser.length > 0 ? e2eUser : E2E_TEST_USER_ID;
  }

  const pikaUserId = c.req.header("X-Pika-User-Id");
  if (pikaUserId && pikaUserId.length > 0) return pikaUserId;

  return null;
}

/**
 * Hono middleware: 401s unauthenticated requests; otherwise sets `c.var.userId`.
 */
export function requireUser(
  deps: AuthMiddlewareDeps = {},
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const userId = resolveUser(c, deps);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("userId", userId);
    await next();
  };
}
