import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth.js";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db.js";
import { getD1Client } from "@/lib/d1.js";
import { auth } from "@/lib/auth.js";
import {
  buildGetTagQuery,
  buildUpdateTagQuery,
  buildDeleteTagQuery,
  validateUpdateTag,
  type TagRow,
} from "@/lib/tags.js";

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

/** PATCH /api/tags/[tagId] — update a tag. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> },
) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tagId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateUpdateTag(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors }, { status: 400 });
  }

  const { sql, params: qParams } = buildUpdateTagQuery(tagId, user.userId, validation.data!);

  try {
    const meta = await d1.execute(sql, qParams);
    if (meta.changes === 0) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: `Tag name "${validation.data!.name}" already exists` },
        { status: 409 },
      );
    }
    throw err;
  }

  // Fetch the updated tag
  const getQ = buildGetTagQuery(tagId, user.userId);
  const result = await d1.firstOrNull<TagRow>(getQ.sql, getQ.params);

  return NextResponse.json({ tag: result });
}

/** DELETE /api/tags/[tagId] — delete a tag. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> },
) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tagId } = await params;

  const { sql, params: qParams } = buildDeleteTagQuery(tagId, user.userId);
  const meta = await d1.execute(sql, qParams);

  if (meta.changes === 0) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
