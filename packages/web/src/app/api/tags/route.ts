import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth.js";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db.js";
import { getD1Client } from "@/lib/d1.js";
import { auth } from "@/lib/auth.js";
import {
  buildListTagsQuery,
  buildCreateTagQuery,
  validateCreateTag,
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

/** GET /api/tags — list all tags for the authenticated user. */
export async function GET(request: Request) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sql, params } = buildListTagsQuery(user.userId);
  const result = await d1.query<TagRow>(sql, params);

  return NextResponse.json({ tags: result.results });
}

/** POST /api/tags — create a new tag. */
export async function POST(request: Request) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateCreateTag(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const { sql, params } = buildCreateTagQuery(id, user.userId, validation.data!);

  try {
    await d1.execute(sql, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: `Tag "${validation.data!.name}" already exists` },
        { status: 409 },
      );
    }
    throw err;
  }

  // Return the created tag
  const tag: TagRow = {
    id,
    user_id: user.userId,
    name: validation.data!.name,
    color: validation.data!.color ?? null,
    created_at: new Date().toISOString(),
  };

  return NextResponse.json({ tag }, { status: 201 });
}
