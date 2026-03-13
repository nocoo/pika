import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth.js";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db.js";
import { getD1Client } from "@/lib/d1.js";
import { auth } from "@/lib/auth.js";
import { proxyToWorker, getProxyConfig } from "@/lib/ingest.js";

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

  let config;
  try {
    config = getProxyConfig();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server configuration error" },
      { status: 500 },
    );
  }

  const result = await proxyToWorker(config, {
    method: "POST",
    path: "/ingest/sessions",
    userId: user.userId,
    body: request.body,
    contentType: request.headers.get("Content-Type") ?? "application/json",
  });

  return new NextResponse(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}
