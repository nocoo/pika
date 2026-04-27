/**
 * In-process Hono subapp for /api/ingest/* (single-worker pivot).
 *
 * Replaces the old packages/api → service-binding hop. Routes call the
 * data/ingest.ts handlers directly with `c.env` (DB+BUCKET).
 *
 *   POST /presign          → R2 presigned URL for direct raw upload
 *                             (icon upload reuses this; switched to c.env.CF_R2_*)
 *   POST /confirm-raw      → handleConfirmRaw (D1 raw_key/raw_size)
 *   POST /sessions         → handleSessionIngest (metadata batch)
 *   PUT  /content/:key/canonical → handleCanonicalUpload
 *   PUT  /content/:key/raw → handleRawUpload
 */

import { MAX_CONTENT_UPLOAD_BYTES, MAX_METADATA_BODY_BYTES } from "@pika/core";
import { R2Client } from "@pika/core/infra/r2";
import { Hono } from "hono";
import {
  handleCanonicalUpload,
  handleRawUpload,
  handleSessionIngest,
} from "../data/ingest";
import { handleConfirmRaw } from "../data/sessions";
import type { AppEnv } from "../lib/env";

// ── Validators ────────────────────────────────────────────────

export interface PresignBody {
  sessionKey: string;
  rawHash: string;
}

export function validatePresignRequest(
  body: unknown,
):
  | { valid: true; sessionKey: string; rawHash: string }
  | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.sessionKey !== "string" || !obj.sessionKey) {
    return { valid: false, error: "sessionKey (non-empty string) is required" };
  }
  if (typeof obj.rawHash !== "string" || !obj.rawHash) {
    return { valid: false, error: "rawHash (non-empty string) is required" };
  }
  if (!/^[0-9a-f]{8,128}$/i.test(obj.rawHash)) {
    return {
      valid: false,
      error: "rawHash must be a hex string (8-128 chars)",
    };
  }
  return { valid: true, sessionKey: obj.sessionKey, rawHash: obj.rawHash };
}

export function buildRawR2Key(
  userId: string,
  sessionKey: string,
  rawHash: string,
): string {
  return `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;
}

// ── Path parsing ──────────────────────────────────────────────

export function parseContentPath(
  pathSegments: string[],
): { type: "canonical" | "raw"; sessionKey: string } | { error: string } {
  if (pathSegments.length < 2) {
    return { error: "Invalid content path: expected /{sessionKey}/{type}" };
  }
  const type = pathSegments[pathSegments.length - 1];
  if (type !== "canonical" && type !== "raw") {
    return {
      error: `Invalid content type: ${type}. Expected "canonical" or "raw"`,
    };
  }
  const sessionKey = pathSegments.slice(0, -1).join("/");
  return { type, sessionKey };
}

// ── Presign helper ────────────────────────────────────────────

export interface PresignDeps {
  presignPut?: (key: string, contentType: string) => Promise<string>;
}

function defaultPresign(env: AppEnv["Bindings"]) {
  const accessKeyId = env.CF_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.CF_R2_SECRET_ACCESS_KEY ?? "";
  const endpoint = env.CF_R2_ENDPOINT ?? "";
  const bucket = env.CF_R2_BUCKET ?? "";
  const client = new R2Client({
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
  });
  return (key: string, contentType: string) =>
    client.putPresignedUrl(key, contentType);
}

// ── App ───────────────────────────────────────────────────────

export function createIngestApp(deps: PresignDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/presign", async (c) => {
    const userId = c.get("userId") as string;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const v = validatePresignRequest(body);
    if (!v.valid) return c.json({ error: v.error }, 400);

    const presign = deps.presignPut ?? defaultPresign(c.env);
    const key = buildRawR2Key(userId, v.sessionKey, v.rawHash);
    try {
      const url = await presign(key, "application/gzip");
      return c.json({ url, key });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to generate presigned URL: ${msg}` }, 500);
    }
  });

  app.post("/confirm-raw", async (c) => {
    const userId = c.get("userId") as string;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    return handleConfirmRaw(userId, body, c.env);
  });

  app.post("/sessions", async (c) => {
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
    const userId = c.get("userId") as string;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const obj = (body ?? {}) as { sessions?: unknown };
    return handleSessionIngest(
      { userId, sessions: (obj.sessions ?? []) as never },
      c.env,
    );
  });

  app.put("/content/*", async (c) => {
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
    const segments = after
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
    const parsed = parseContentPath(segments);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    const userId = c.get("userId") as string;
    if (parsed.type === "canonical") {
      return handleCanonicalUpload(parsed.sessionKey, userId, c.req.raw, c.env);
    }
    return handleRawUpload(parsed.sessionKey, userId, c.req.raw, c.env);
  });

  return app;
}

export const ingestApp: Hono<AppEnv> = createIngestApp();
