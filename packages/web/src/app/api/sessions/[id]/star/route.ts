import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import { buildToggleStarQuery } from "@/lib/sessions";

async function authenticate(request: Request) {
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

  return { user, d1 };
}

/** PATCH /api/sessions/[id]/star — toggle star. Body: { starred: boolean } */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const starred = (body as Record<string, unknown>)?.starred;
  if (typeof starred !== "boolean") {
    return NextResponse.json(
      { error: "starred (boolean) is required" },
      { status: 400 },
    );
  }

  const { sql, params: qParams } = buildToggleStarQuery(id, user.userId, starred);
  await d1.execute(sql, qParams);

  return NextResponse.json({ starred });
}
