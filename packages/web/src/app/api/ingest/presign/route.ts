import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { validatePresignRequest } from "@/lib/ingest";
import { getR2Client } from "@/lib/r2";

/**
 * POST /api/ingest/presign
 *
 * Generate a presigned PUT URL for direct-to-R2 raw content upload.
 * Body: { sessionKey: string, rawHash: string }
 * Response: { url: string, key: string }
 *
 * Auth: Either session cookie or Bearer pk_... API key.
 * For API key auth, we validate via Worker /auth/me endpoint.
 *
 * Note: This route stays in Next.js because presigned URL generation
 * requires the AWS S3 SDK with R2 credentials, which the Worker cannot
 * provide (Workers use native R2 bindings instead).
 */
export async function POST(request: Request) {
  // Try session auth first
  const session = await auth();

  let userId: string | null = null;

  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    // Check for Bearer API key - validate via Worker /auth/me
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer pk_")) {
      try {
        const workerUrl = process.env.WORKER_URL;
        if (!workerUrl) {
          return NextResponse.json(
            { error: "WORKER_URL not configured" },
            { status: 500 },
          );
        }

        // Call Worker /auth/me to validate API key and get userId
        const response = await fetch(new URL("/auth/me", workerUrl), {
          method: "GET",
          headers: {
            Authorization: authHeader,
          },
        });

        if (response.ok) {
          const result = (await response.json()) as { userId: string };
          userId = result.userId;
        }
      } catch {
        // API key validation failed
      }
    }
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validatePresignRequest(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const r2 = getR2Client();
  const key = `${userId}/${validation.sessionKey}/raw/${validation.rawHash}.json.gz`;

  try {
    const url = await r2.putPresignedUrl(key, "application/gzip");
    return NextResponse.json({ url, key });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to generate presigned URL: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
