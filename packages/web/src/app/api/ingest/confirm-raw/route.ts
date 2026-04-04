import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { validateConfirmRawRequest } from "@/lib/ingest";
import { getWorkerClient, WorkerError } from "@/lib/worker-client";

/**
 * POST /api/ingest/confirm-raw
 *
 * Confirm a direct-to-R2 raw content upload by updating D1 metadata.
 * Called by CLI after successfully uploading raw content via presigned URL.
 *
 * Body: { sessionKey: string, rawHash: string, rawSize: number }
 * Response: { confirmed: true } or error
 *
 * Auth: Either session cookie or Bearer pk_... API key.
 * For API key auth, we call the Worker which validates the key directly.
 */
export async function POST(request: Request) {
  // Try session auth first
  const session = await auth();

  let userId: string | null = null;

  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    // Check for Bearer API key
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      // For API key auth, the Worker will validate it directly
      // We pass the auth header through to the Worker
      userId = "__api_key__"; // Placeholder - Worker will resolve
    }
  }

  if (!userId && !request.headers.get("Authorization")?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateConfirmRawRequest(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // If we have a session userId, use WorkerClient with WORKER_SECRET
  // If we have an API key, pass it through to Worker directly
  try {
    const authHeader = request.headers.get("Authorization");

    if (userId && userId !== "__api_key__") {
      // Session auth - use WorkerClient
      const client = getWorkerClient();
      const result = await client.post("/ingest/confirm-raw", userId, {
        sessionKey: validation.sessionKey,
        rawHash: validation.rawHash,
        rawSize: validation.rawSize,
      });
      return NextResponse.json(result);
    }

    // API key auth - pass through to Worker
    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) {
      return NextResponse.json(
        { error: "WORKER_URL not configured" },
        { status: 500 },
      );
    }

    const response = await fetch(new URL("/ingest/confirm-raw", workerUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader!,
      },
      body: JSON.stringify({
        sessionKey: validation.sessionKey,
        rawHash: validation.rawHash,
        rawSize: validation.rawSize,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(result, { status: response.status });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: `Worker request failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
