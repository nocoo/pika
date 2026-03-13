import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { getR2Client } from "@/lib/r2";
import { auth } from "@/lib/auth";
import {
  buildSessionDetailQuery,
  type SessionDetailRow,
} from "@/lib/session-detail";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const { sql, params: queryParams } = buildSessionDetailQuery(id, user.userId);
  const row = await d1.firstOrNull<SessionDetailRow>(sql, queryParams);

  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Generate presigned URLs for R2 content
  const r2 = getR2Client();
  let contentUrl: string | null = null;
  let rawUrl: string | null = null;

  if (row.content_key) {
    contentUrl = await r2.getPresignedUrl(row.content_key);
  }

  if (row.raw_key) {
    rawUrl = await r2.getPresignedUrl(row.raw_key);
  }

  return NextResponse.json({
    session: row,
    contentUrl,
    rawUrl,
  });
}
