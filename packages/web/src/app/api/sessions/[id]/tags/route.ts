/**
 * Session tags routes.
 *
 * GET /api/sessions/[id]/tags — list tags for a session
 * PUT /api/sessions/[id]/tags — add a tag to a session
 * DELETE /api/sessions/[id]/tags — remove a tag from a session
 *
 * Proxies to Worker.
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
      `/sessions/${encodeURIComponent(id)}/tags`,
      userId,
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}

export async function PUT(
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
    const result = await client.put(
      `/sessions/${encodeURIComponent(id)}/tags`,
      userId,
      body,
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}

export async function DELETE(
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
    const result = await client.delete(
      `/sessions/${encodeURIComponent(id)}/tags`,
      userId,
      body,
    );

    if (result === null) {
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleWorkerError(err);
  }
}
