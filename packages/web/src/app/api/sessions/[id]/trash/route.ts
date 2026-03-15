import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import { buildSoftDeleteQuery, buildRestoreQuery } from "@/lib/sessions";

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

/** PATCH /api/sessions/[id]/trash — soft-delete or restore. Body: { deleted: boolean } */
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

  const deleted = (body as Record<string, unknown>)?.deleted;
  if (typeof deleted !== "boolean") {
    return NextResponse.json(
      { error: "deleted (boolean) is required" },
      { status: 400 },
    );
  }

  const query = deleted
    ? buildSoftDeleteQuery(id, user.userId)
    : buildRestoreQuery(id, user.userId);

  await d1.execute(query.sql, query.params);

  return NextResponse.json({
    deleted,
    deleted_at: deleted ? new Date().toISOString() : null,
  });
}
