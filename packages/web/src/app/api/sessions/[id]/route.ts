/**
 * GET /api/sessions/[id] — get session detail.
 *
 * Proxies to Worker GET /sessions/:id.
 *
 * Note: The Worker returns the session data but not presigned URLs.
 * Use /api/sessions/[id]/content for actual content fetching.
 */
import { NextResponse } from "next/server";
import { getWorkerClient } from "@/lib/worker-client";
import { handleWorkerError, resolveUserForWorker } from "@/lib/worker-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserForWorker(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const client = getWorkerClient();
    const result = await client.get(
      `/sessions/${encodeURIComponent(id)}`,
      userId,
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}
