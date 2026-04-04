/**
 * GET /api/sessions/[id]/content — get session content.
 *
 * Proxies to Worker GET /sessions/:id/content.
 * The Worker handles R2 access and gzip decompression.
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
      `/sessions/${encodeURIComponent(id)}/content`,
      userId,
    );

    if (result === null) {
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}
