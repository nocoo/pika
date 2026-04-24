/**
 * Stage-a transition helpers (docs/16): forward Next.js route handlers to api.
 *
 * Browsers continue hitting same-origin `/api/*`; web handlers fetch the
 * upstream api server and stream the response back. Auth headers (cookie,
 * Authorization, X-E2E-User) are passed through. Once Caddy routes
 * `/api/*` directly to api, these handlers can be deleted.
 */

import { NextResponse } from "next/server";

const PASS_THROUGH_HEADERS = ["cookie", "authorization", "x-e2e-user"] as const;

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
      const init: RequestInit = {
        method,
        headers: forwardHeaders(request),
      };
      if (hasBody) {
        const ct = request.headers.get("content-type");
        if (ct) (init.headers as Record<string, string>)["content-type"] = ct;
        init.body = await request.arrayBuffer();
        // duplex required for streaming bodies on Node 18+; arrayBuffer is fine
        // without it but we keep the path explicit.
      }
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
