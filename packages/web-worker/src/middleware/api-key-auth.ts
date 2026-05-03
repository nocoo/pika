import { findApiTokenByHashed, updateApiTokenLastUsed } from "@pika/core";
import type { Context, Next } from "hono";
import { d1ApiTokenExecutor } from "../lib/d1-api-tokens";
import type { AppEnv } from "../lib/env";
import { isLocalhost } from "./is-localhost";

const PUBLIC_PATHS = new Set<string>(["/api/live"]);

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1] ?? null;
}

/**
 * Bearer pk_* token verification against the D1 `api_tokens` table.
 *
 * - `/api/live` is public.
 * - `E2E_SKIP_AUTH=true` short-circuits in non-production.
 * - `accessAuth` may have already set `accessAuthenticated` (CF Access JWT
 *   path); if so we trust it and skip token lookup.
 * - On localhost we still let bearer-bearing requests through to verify
 *   their token (so `accessEmail` reflects the real token owner).
 * - On miss: 401 if no token; 403 if token doesn't match.
 */
export async function apiKeyAuth(c: Context<AppEnv>, next: Next) {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  if (c.env?.E2E_SKIP_AUTH === "true" && c.env?.ENVIRONMENT !== "production") {
    c.set("accessAuthenticated", true);
    const devEmail = c.env?.DEV_USER_EMAIL;
    if (devEmail) c.set("accessEmail", devEmail);
    return next();
  }

  const hasBearer = (c.req.header("Authorization") ?? "").startsWith("Bearer ");
  if (isLocalhost(c) && !hasBearer) return next();

  if (c.get("accessAuthenticated") && !hasBearer) return next();

  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const exec = c.get("apiTokenExec") ?? d1ApiTokenExecutor(c.env.DB);
  const row = await findApiTokenByHashed(exec, token);
  if (!row) return c.json({ error: "Invalid API key" }, 403);

  c.set("accessEmail", row.email);
  c.set("userId", row.user_id);
  c.set("accessAuthenticated", true);
  // fire-and-forget; never block the request on a write
  updateApiTokenLastUsed(exec, row.id).catch(() => {});
  return next();
}
