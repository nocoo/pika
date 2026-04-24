/**
 * GET /api/live — forwards to api `GET /live`.
 *
 * Stage-a transition (docs/16): handler stays as a fetch-forward until Caddy
 * routes `/api/*` to api directly. Once that lands the route can be deleted.
 *
 * Auth headers (Cookie/Authorization/X-E2E-User) are passed through, but the
 * upstream `/live` doesn't require auth.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PASS_THROUGH_HEADERS = ["cookie", "authorization", "x-e2e-user"] as const;

function getApiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:7023";
}

function pickHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PASS_THROUGH_HEADERS) {
    const value = req.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

export async function GET(request: Request): Promise<NextResponse> {
  const target = new URL("/live", getApiBaseUrl());

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: pickHeaders(request),
    });

    const body = await upstream.text();
    const headers = new Headers({ "Cache-Control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    return new NextResponse(body, { status: upstream.status, headers });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.replace(/\bok\b/gi, "***");
    return NextResponse.json(
      {
        status: "error",
        component: "web-forward",
        database: { connected: false, error: `api unreachable: ${message}` },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
