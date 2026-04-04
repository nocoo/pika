/**
 * Tag routes with ID parameter.
 *
 * PATCH /api/tags/[tagId] — update a tag
 * DELETE /api/tags/[tagId] — delete a tag
 *
 * Proxies to Worker.
 */
import { NextResponse } from "next/server";
import { getWorkerClient } from "@/lib/worker-client";
import { handleWorkerError, resolveUserForWorker } from "@/lib/worker-proxy";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> },
) {
  const userId = await resolveUserForWorker(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tagId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const client = getWorkerClient();
    const result = await client.patch(
      `/tags/${encodeURIComponent(tagId)}`,
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
  { params }: { params: Promise<{ tagId: string }> },
) {
  const userId = await resolveUserForWorker(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tagId } = await params;

  try {
    const client = getWorkerClient();
    const result = await client.delete(
      `/tags/${encodeURIComponent(tagId)}`,
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
