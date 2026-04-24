/**
 * Ingest routes: presign, confirm-raw, sessions metadata, content streaming.
 *
 * All require an authenticated user (set as `c.var.userId` by requireUser).
 * `confirm-raw`, `sessions`, and `content/*` proxy to Worker via shared
 * proxyToWorker; `presign` generates a direct-to-R2 PUT URL using the
 * runtime-agnostic R2Client from @pika/core/infra/r2.
 */

import { MAX_CONTENT_UPLOAD_BYTES, MAX_METADATA_BODY_BYTES } from "@pika/core";
import { R2Client } from "@pika/core/infra/r2";
import { Hono } from "hono";
import {
  buildRawR2Key,
  getProxyConfig as defaultGetProxyConfig,
  proxyToWorker as defaultProxyToWorker,
  type ProxyConfig,
  type ProxyResult,
  parseContentPath,
  validatePresignRequest,
} from "../lib/ingest";
import type { AuthVariables } from "../middleware/auth";

export interface IngestDeps {
  /** Returns a presigner; default constructs an R2Client from env. */
  presignPut?: (key: string, contentType: string) => Promise<string>;
  /** Returns proxy config; default reads env. */
  getProxyConfig?: () => ProxyConfig;
  /** Proxy implementation; default is real fetch via proxyToWorker. */
  proxy?: typeof defaultProxyToWorker;
}

let _r2: R2Client | null = null;
function defaultR2(): R2Client {
  if (!_r2) {
    _r2 = new R2Client({
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY ?? "",
      endpoint: process.env.CF_R2_ENDPOINT ?? "",
      bucket: process.env.CF_R2_BUCKET ?? "",
    });
  }
  return _r2;
}

/** Test helper. */
export function resetIngestR2Client(): void {
  _r2 = null;
}

function pipeResult(result: ProxyResult): Response {
  if (result.status === 204) return new Response(null, { status: 204 });
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createIngestRoute(
  deps: IngestDeps = {},
): Hono<{ Variables: AuthVariables }> {
  const presignPut =
    deps.presignPut ?? ((k, ct) => defaultR2().putPresignedUrl(k, ct));
  const getCfg = deps.getProxyConfig ?? defaultGetProxyConfig;
  const proxy = deps.proxy ?? defaultProxyToWorker;
  const route = new Hono<{ Variables: AuthVariables }>();

  route.post("/presign", async (c) => {
    const userId = c.get("userId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const v = validatePresignRequest(body);
    if (!v.valid) return c.json({ error: v.error }, 400);

    const key = buildRawR2Key(userId, v.sessionKey, v.rawHash);
    try {
      const url = await presignPut(key, "application/gzip");
      return c.json({ url, key });
    } catch (err) {
      return c.json(
        {
          error: `Failed to generate presigned URL: ${err instanceof Error ? err.message : String(err)}`,
        },
        500,
      );
    }
  });

  route.post("/confirm-raw", async (c) => {
    const userId = c.get("userId");
    const raw = await c.req.text();
    let cfg: ProxyConfig;
    try {
      cfg = getCfg();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "config error" },
        500,
      );
    }
    const result = await proxy(cfg, {
      method: "POST",
      path: "/ingest/confirm-raw",
      userId,
      body: raw,
      contentType: "application/json",
    });
    return pipeResult(result);
  });

  route.post("/sessions", async (c) => {
    const contentLength = Number.parseInt(
      c.req.header("Content-Length") ?? "",
      10,
    );
    if (!Number.isFinite(contentLength)) {
      return c.json({ error: "Content-Length header is required" }, 411);
    }
    if (contentLength > MAX_METADATA_BODY_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }
    const userId = c.get("userId");
    let cfg: ProxyConfig;
    try {
      cfg = getCfg();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "config error" },
        500,
      );
    }
    const result = await proxy(cfg, {
      method: "POST",
      path: "/ingest/sessions",
      userId,
      body: c.req.raw.body,
      contentType: c.req.header("Content-Type") ?? "application/json",
    });
    return pipeResult(result);
  });

  route.put("/content/*", async (c) => {
    const contentLength = Number.parseInt(
      c.req.header("Content-Length") ?? "",
      10,
    );
    if (!Number.isFinite(contentLength)) {
      return c.json({ error: "Content-Length header is required" }, 411);
    }
    if (contentLength > MAX_CONTENT_UPLOAD_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }

    const fullPath = new URL(c.req.url).pathname;
    const after = fullPath.replace(/^.*\/content\//, "");
    const segments = after.split("/").filter(Boolean);
    const parsed = parseContentPath(segments);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    const userId = c.get("userId");
    let cfg: ProxyConfig;
    try {
      cfg = getCfg();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "config error" },
        500,
      );
    }

    const extra: Record<string, string> = {};
    for (const name of [
      "X-Content-Hash",
      "X-Parser-Revision",
      "X-Schema-Version",
      "X-Raw-Hash",
      "Content-Encoding",
    ]) {
      const v = c.req.header(name);
      if (v) extra[name] = v;
    }

    const result = await proxy(cfg, {
      method: "PUT",
      path: parsed.workerPath,
      userId,
      body: c.req.raw.body,
      contentType: c.req.header("Content-Type") ?? "application/octet-stream",
      extraHeaders: extra,
    });
    return pipeResult(result);
  });

  return route;
}

export const ingestRoute: Hono<{ Variables: AuthVariables }> =
  createIngestRoute();
