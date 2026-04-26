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
 *   1. CF edge request (`cf` present): only `*.dev.hexly.ai` Host counts as
 *      local-ish (dev environment). A spoofed `Host: localhost` is rejected.
 *   2. No `cf` (`wrangler dev` / tests / direct): allow `localhost`,
 *      `127.0.0.1`, and `*.dev.hexly.ai` hosts.
 */
export function isLocalhost(c: Context<AppEnv>): boolean {
  const host = c.req.header("host") || "";
  const onCfEdge = Boolean((c.req.raw as { cf?: unknown }).cf);

  if (onCfEdge) {
    return host.endsWith(".dev.hexly.ai");
  }

  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.endsWith(".dev.hexly.ai")
  );
}
