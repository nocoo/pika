import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import { getProxyConfig } from "@/lib/ingest";
import {
  buildSessionDetailQuery,
  type SessionDetailRow,
} from "@/lib/session-detail";

/**
 * GET /api/sessions/[id]/content
 *
 * Proxies canonical session content from R2 via the Cloudflare Worker.
 * The worker has native R2 bindings and handles gzip decompression.
 * This avoids CORS issues and R2 API token permission limitations.
 */
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

  if (!row.content_key) {
    return new NextResponse(null, { status: 204 });
  }

  // Proxy through the Cloudflare Worker which has native R2 bindings
  const config = getProxyConfig();
  const workerUrl = `${config.workerUrl}/content/${encodeURIComponent(row.content_key)}`;

  const workerRes = await fetch(workerUrl, {
    headers: {
      Authorization: `Bearer ${config.workerSecret}`,
      "X-User-Id": user.userId,
    },
  });

  if (!workerRes.ok) {
    const body = await workerRes.text().catch(() => "");
    console.error(
      `[content-proxy] Worker fetch failed: ${workerRes.status}`,
      { key: row.content_key, body: body.slice(0, 500) },
    );
    return NextResponse.json(
      { error: "Failed to fetch content from storage" },
      { status: workerRes.status === 404 ? 404 : 502 },
    );
  }

  // Stream the worker response body directly — avoids buffering the entire
  // R2 object in Node.js memory (prevents OOM on large sessions).
  return new NextResponse(workerRes.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300",
    },
  });
}
