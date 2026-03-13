import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth.js";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db.js";
import { getD1Client } from "@/lib/d1.js";
import { auth } from "@/lib/auth.js";
import {
  buildSessionTagsQuery,
  buildAddSessionTagQuery,
  buildRemoveSessionTagQuery,
  buildVerifySessionOwnerQuery,
  buildGetTagQuery,
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

/** GET /api/sessions/[id]/tags — list tags for a session. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify session ownership
  const verify = buildVerifySessionOwnerQuery(id, user.userId);
  const session = await d1.firstOrNull(verify.sql, verify.params);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { sql, params: qParams } = buildSessionTagsQuery(id, user.userId);
  const result = await d1.query<TagRow>(sql, qParams);

  return NextResponse.json({ tags: result.results });
}

/** PUT /api/sessions/[id]/tags — add a tag to a session. Body: { tagId } */
export async function PUT(
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

  const tagId = (body as Record<string, unknown>)?.tagId;
  if (typeof tagId !== "string" || !tagId) {
    return NextResponse.json({ error: "tagId is required" }, { status: 400 });
  }

  // Verify session ownership
  const verify = buildVerifySessionOwnerQuery(id, user.userId);
  const session = await d1.firstOrNull(verify.sql, verify.params);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Verify tag ownership
  const tagQ = buildGetTagQuery(tagId, user.userId);
  const tag = await d1.firstOrNull(tagQ.sql, tagQ.params);
  if (!tag) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  const { sql, params: qParams } = buildAddSessionTagQuery(id, tagId);
  await d1.execute(sql, qParams);

  return NextResponse.json({ added: true }, { status: 200 });
}

/** DELETE /api/sessions/[id]/tags — remove a tag from a session. Body: { tagId } */
export async function DELETE(
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

  const tagId = (body as Record<string, unknown>)?.tagId;
  if (typeof tagId !== "string" || !tagId) {
    return NextResponse.json({ error: "tagId is required" }, { status: 400 });
  }

  const { sql, params: qParams } = buildRemoveSessionTagQuery(id, tagId);
  await d1.execute(sql, qParams);

  return new NextResponse(null, { status: 204 });
}
