import { PIKA_VERSION } from "@pika/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/live — surety-standard health check endpoint.
 *
 * NOT auth-protected. NOT cached.
 * Used by uptime monitors (Railway, external) to verify service health.
 *
 * Proxies to Worker /live which checks D1 connectivity,
 * then re-wraps into the surety standard shape for the web component.
 */
export async function GET(): Promise<NextResponse> {
  const workerUrl = process.env.WORKER_URL;
  const timestamp = new Date().toISOString();
  const uptime = Math.floor(process.uptime());
  const base = {
    version: PIKA_VERSION,
    component: "web",
    timestamp,
    uptime,
  };

  if (!workerUrl) {
    return NextResponse.json(
      {
        status: "error",
        ...base,
        database: { connected: false, error: "WORKER_URL not configured" },
      },
      { status: 503, headers },
    );
  }

  try {
    const response = await fetch(new URL("/live", workerUrl), {
      headers: { "Cache-Control": "no-cache" },
    });

    const result = (await response.json()) as {
      database?: { connected: boolean; error?: string };
    };

    const dbConnected = result.database?.connected ?? false;

    return NextResponse.json(
      {
        status: dbConnected ? "ok" : "error",
        ...base,
        database: result.database ?? { connected: false, error: "Unknown" },
      },
      { status: dbConnected ? 200 : 503, headers },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.replace(/\bok\b/gi, "***");

    return NextResponse.json(
      {
        status: "error",
        ...base,
        database: { connected: false, error: `Worker unreachable: ${message}` },
      },
      { status: 503, headers },
    );
  }
}
