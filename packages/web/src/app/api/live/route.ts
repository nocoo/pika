import { NextResponse } from "next/server";
import { getD1Client } from "@/lib/d1";
import { checkHealth } from "@/lib/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/live — public health check endpoint.
 *
 * NOT auth-protected. NOT cached.
 * Used by uptime monitors (Railway, external) to verify service health.
 */
export async function GET(): Promise<NextResponse> {
  const db = getD1Client();
  const result = await checkHealth(db);

  const status = result.status === "ok" ? 200 : 503;

  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
