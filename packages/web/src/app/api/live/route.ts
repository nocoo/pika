import { PIKA_VERSION } from "@pika/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/live — public health check endpoint.
 *
 * NOT auth-protected. NOT cached.
 * Used by uptime monitors (Railway, external) to verify service health.
 *
 * Proxies to Worker /live which checks D1 connectivity.
 */
export async function GET(): Promise<NextResponse> {
  const workerUrl = process.env.WORKER_URL;

  if (!workerUrl) {
    return NextResponse.json(
      {
        status: "error",
        version: PIKA_VERSION,
        error: "WORKER_URL not configured",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  }

  try {
    const start = Date.now();
    const response = await fetch(new URL("/live", workerUrl), {
      headers: { "Cache-Control": "no-cache" },
    });
    const latencyMs = Date.now() - start;

    const result = await response.json();

    // Add proxy latency info
    const enriched = {
      ...result,
      proxy: { latencyMs },
    };

    return NextResponse.json(enriched, {
      status: response.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        version: PIKA_VERSION,
        error: `Worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  }
}
