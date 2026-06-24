import type { Context } from "hono";
import type { AppEnv } from "../lib/env";

/**
 * Determine whether a request is genuinely local / dev.
 *
 * Host headers are attacker-controlled, so we cannot trust them in isolation.
 * On Cloudflare Workers, `c.req.raw.cf` is populated by the CF edge — its
 * presence proves the request traversed CF, where the Host header reflects
 * the real domain bound to the Worker (never `localhost`/`127.0.0.1`).
 *
 * Rules:
 *   1. CF edge request (`cf` present): local-ish if Host ends with
 *      `.dev.hexly.ai` OR `DEV_USER_EMAIL` is set. The env-var fallback
 *      handles `wrangler dev` — wrangler resolves `[[routes]]` even in
 *      local mode and rewrites Host to the prod custom_domain
 *      (`pika.hexly.ai`), so the Host check alone would fail every
 *      browser dev request. `DEV_USER_EMAIL` is dev-only (set in
 *      `.dev.vars`, never in prod `wrangler.toml`), so its presence is
 *      a reliable dev-environment signal that cannot be spoofed by an
 *      external request.
 *   2. No `cf` (tests / direct fetch / older wrangler modes): allow
 *      `localhost`, `127.0.0.1`, and `*.dev.hexly.ai` hosts.
 */
export function isLocalhost(c: Context<AppEnv>): boolean {
  const host = c.req.header("host") || "";
  const onCfEdge = Boolean((c.req.raw as { cf?: unknown }).cf);
  const hasDevEmail = Boolean(c.env?.DEV_USER_EMAIL);

  if (onCfEdge) {
    return host.endsWith(".dev.hexly.ai") || hasDevEmail;
  }

  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.endsWith(".dev.hexly.ai") ||
    hasDevEmail
  );
}
