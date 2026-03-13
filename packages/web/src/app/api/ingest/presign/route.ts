import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import { validatePresignRequest } from "@/lib/ingest";
import { getR2Client } from "@/lib/r2";

/**
 * POST /api/ingest/presign
 *
 * Generate a presigned PUT URL for direct-to-R2 raw content upload.
 * Body: { sessionKey: string, rawHash: string }
 * Response: { url: string, key: string }
 */
export async function POST(request: Request) {
  const d1 = getD1Client();
  const db = new D1CliAuthDb(d1);

  const user = await resolveUser(request, {
    getSession: async () => {
      const session = await auth();
      if (!session?.user?.id) return null;
      return { userId: session.user.id, email: session.user.email ?? undefined };
    },
    db,
  });

  if (!user) {
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
  const key = `${user.userId}/${validation.sessionKey}/raw/${validation.rawHash}.json.gz`;

  try {
    const url = await r2.putPresignedUrl(key, "application/gzip");
    return NextResponse.json({ url, key });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to generate presigned URL: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
