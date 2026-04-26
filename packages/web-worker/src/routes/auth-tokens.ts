import {
  createApiToken,
  listApiTokensByUser,
  revokeApiToken,
} from "@pika/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { d1ApiTokenExecutor } from "../lib/d1-api-tokens";
import type { AppEnv } from "../lib/env";

/**
 * `/api/auth/tokens` CRUD. Per docs/17 §身份模型 #6:
 *   - GET    → list tokens (without `hashed`); newest first
 *   - POST   → mint a new token, return raw `pk_*` exactly once
 *   - DELETE /:id → revoke (ownership-checked)
 *
 * All endpoints require `userId` + `accessEmail` from auth middleware.
 */

function requireAuth(c: Context<AppEnv>) {
  const userId = c.get("userId");
  const email = c.get("accessEmail");
  if (!userId || !email) return null;
  return { userId, email };
}

function exec(c: Context<AppEnv>) {
  return c.get("apiTokenExec") ?? d1ApiTokenExecutor(c.env.DB);
}

export const authTokensApp = new Hono<AppEnv>();

authTokensApp.get("/", async (c) => {
  const auth = requireAuth(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const rows = await listApiTokensByUser(exec(c), auth.userId);
  // strip the hash from the response so it never leaks to the browser
  const tokens = rows.map(({ hashed: _hashed, ...rest }) => rest);
  return c.json({ tokens });
});

authTokensApp.post("/", async (c) => {
  const auth = requireAuth(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  let body: { name?: unknown; expiresAt?: unknown } = {};
  try {
    if (c.req.header("content-type")?.includes("application/json")) {
      body = (await c.req.json()) as typeof body;
    }
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const name = typeof body.name === "string" ? body.name : null;
  const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : null;

  const created = await createApiToken(exec(c), {
    userId: auth.userId,
    email: auth.email,
    name,
    expiresAt,
  });
  return c.json(
    {
      id: created.id,
      token: created.token,
      tokenPrefix: created.tokenPrefix,
      name,
      expiresAt,
    },
    201,
  );
});

authTokensApp.delete("/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Invalid token id" }, 400);
  }
  const ok = await revokeApiToken(exec(c), id, auth.userId);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
