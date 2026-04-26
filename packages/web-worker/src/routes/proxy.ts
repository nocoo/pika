import type { Context } from "hono";
import type { AppEnv } from "../lib/env";

/**
 * docs/17 P3.3 — `/api/*` proxy via service binding.
 *
 * Strips the leading `/api` (parity with web_legacy api-forward.ts:38),
 * injects `X-Pika-User-Id` + `X-Pika-User-Email` (single trust root,
 * §安全边界), forwards to packages/api via the `API` service binding.
 *
 * Body is streamed (`duplex: "half"`) so PUT /ingest/content/* doesn't
 * buffer the gzip blob.
 */

export function buildUpstreamRequest(
  req: Request,
  userId: string,
  email?: string,
): Request {
  const url = new URL(req.url);
  const apiPath = url.pathname.slice(4) || "/";
  const upstream = new URL(apiPath, "http://api.internal");
  upstream.search = url.search;

  const headers = new Headers(req.headers);
  headers.set("X-Pika-User-Id", userId);
  if (email) headers.set("X-Pika-User-Email", email);
  headers.delete("cookie");
  headers.delete("authorization");

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }
  return new Request(upstream.toString(), init);
}

export async function proxyHandler(c: Context<AppEnv>) {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const upstream = buildUpstreamRequest(
    c.req.raw,
    userId,
    c.get("accessEmail"),
  );
  return c.env.API.fetch(upstream);
}
