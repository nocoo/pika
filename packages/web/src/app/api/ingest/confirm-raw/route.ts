import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import { validateConfirmRawRequest, buildConfirmRawUpdate } from "@/lib/ingest";

/**
 * POST /api/ingest/confirm-raw
 *
 * Confirm a direct-to-R2 raw content upload by updating D1 metadata.
 * Called by CLI after successfully uploading raw content via presigned URL.
 *
 * Body: { sessionKey: string, rawHash: string, rawSize: number }
 * Response: { confirmed: true } or error
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

  const validation = validateConfirmRawRequest(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const update = buildConfirmRawUpdate({
    userId: user.userId,
    sessionKey: validation.sessionKey,
    rawHash: validation.rawHash,
    rawSize: validation.rawSize,
  });

  try {
    const meta = await d1.execute(update.sql, update.params);
    if (meta.changes === 0) {
      return NextResponse.json(
        { error: `Session not found: ${validation.sessionKey}` },
        { status: 404 },
      );
    }
    return NextResponse.json({ confirmed: true });
  } catch (err) {
    return NextResponse.json(
      { error: `D1 update failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
