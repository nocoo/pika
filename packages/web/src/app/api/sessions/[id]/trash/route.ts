/**
 * PATCH /api/sessions/[id]/trash — soft delete or restore.
 *
 * Proxies to Worker PATCH /sessions/:id/trash.
 * Body: { deleted: boolean }
 */
import { NextResponse } from "next/server";
import { getWorkerClient } from "@/lib/worker-client";
import { handleWorkerError, resolveUserForWorker } from "@/lib/worker-proxy";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserForWorker(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const client = getWorkerClient();
    const result = await client.patch(
      `/sessions/${encodeURIComponent(id)}/trash`,
      userId,
      body,
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}
