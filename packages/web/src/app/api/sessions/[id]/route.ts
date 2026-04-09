/**
 * GET /api/sessions/[id] — get session detail.
 * PATCH /api/sessions/[id] — update session (title, description).
 *
 * Proxies to Worker GET/PATCH /sessions/:id.
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
      `/sessions/${encodeURIComponent(id)}`,
      userId,
      body,
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}
