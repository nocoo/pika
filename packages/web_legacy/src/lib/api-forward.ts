/**
 * Stage-a transition helpers (docs/16): forward Next.js route handlers to api.
 *
 * Browsers continue hitting same-origin `/api/*`; web handlers fetch the
 * upstream api server and stream the response back. docs/17 P3.2 收紧了
 * api 鉴权——只信 `X-Pika-User-Id`（由这个 forwarder 用 NextAuth session
 * 解析后注入）。cookie / Authorization 不再透传，避免把客户端凭据带到
 * 一个不再认识它们的下游。E2E 旁路保留 `X-E2E-User`。
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "./session-user";

const PASS_THROUGH_HEADERS = [
  // Ingest content upload headers (PUT /api/ingest/content/*)
  "x-content-hash",
  "x-parser-revision",
  "x-schema-version",
  "x-raw-hash",
  "content-encoding",
] as const;

/** Default to local api dev port; prod sets API_INTERNAL_URL. */
function getApiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:7023";
}

function forwardHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PASS_THROUGH_HEADERS) {
    const value = req.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

/** Build the upstream api URL by stripping the leading `/api` from the request path. */
function buildUpstreamUrl(req: Request): URL {
  const url = new URL(req.url);
  const apiPath = url.pathname.startsWith("/api")
    ? url.pathname.slice(4) || "/"
    : url.pathname;
  const upstream = new URL(apiPath, getApiBaseUrl());
  upstream.search = url.search;
  return upstream;
}

async function passResponse(upstream: Response): Promise<NextResponse> {
  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new NextResponse(body, { status: upstream.status, headers });
}

function unreachable(err: unknown, status = 502): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { error: `api unreachable: ${message}` },
    { status },
  );
}

/**
 * Build a route handler that forwards the incoming request to api.
 *
 * @param method  HTTP method to forward.
 * @param hasBody Whether to forward the request body (POST/PUT/PATCH/DELETE).
 */
export function createForwardHandler(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  options: { hasBody?: boolean } = {},
) {
  const hasBody = options.hasBody ?? method !== "GET";
  return async (request: Request): Promise<NextResponse> => {
    const upstream = buildUpstreamUrl(request);
    try {
      const headers = forwardHeaders(request);

      // docs/17 P3.2: api now trusts only X-Pika-User-Id. Translate
      // NextAuth session → header here. E2E header passes through
      // verbatim because api recognizes it directly under E2E_SKIP_AUTH.
      const e2eHeader = request.headers.get("x-e2e-user");
      if (e2eHeader) {
        headers["x-e2e-user"] = e2eHeader;
      } else {
        const user = await getSessionUser();
        if (!user?.id) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        headers["x-pika-user-id"] = user.id;
        if (user.email) headers["x-pika-user-email"] = user.email;
      }

      if (hasBody) {
        const ct = request.headers.get("content-type");
        if (ct) headers["content-type"] = ct;
        const cl = request.headers.get("content-length");
        if (cl) headers["content-length"] = cl;
      }
      // Stream the request body straight through; ingest/content uploads can
      // be large, so we never buffer via arrayBuffer(). `duplex: "half"` is
      // required by Node/Bun fetch when sending a ReadableStream body.
      const init: RequestInit & { duplex?: "half" } = {
        method,
        headers,
        body: hasBody ? request.body : undefined,
        duplex: hasBody && request.body ? "half" : undefined,
      };
      const res = await fetch(upstream, init);
      return passResponse(res);
    } catch (err) {
      return unreachable(err);
    }
  };
}

export const forwardGet = createForwardHandler("GET");
export const forwardPost = createForwardHandler("POST");
export const forwardPut = createForwardHandler("PUT");
export const forwardPatch = createForwardHandler("PATCH");
export const forwardDelete = createForwardHandler("DELETE");
