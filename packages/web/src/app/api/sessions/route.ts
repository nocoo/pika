import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth.js";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db.js";
import { getD1Client } from "@/lib/d1.js";
import { auth } from "@/lib/auth.js";
import {
  buildSessionListQuery,
  parseSessionListParams,
  shapeSessionListResponse,
  type SessionRow,
} from "@/lib/sessions.js";

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const parsed = parseSessionListParams(searchParams);

  const { sql, params } = buildSessionListQuery({
    userId: user.userId,
    ...parsed,
  });

  const result = await d1.query<SessionRow>(sql, params);

  const response = shapeSessionListResponse(
    result.results,
    parsed.sort,
    parsed.limit,
  );

  return NextResponse.json(response);
}
