import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveUser } from "@/lib/cli-auth";
import { getD1Client } from "@/lib/d1";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import {
  buildSessionCountQuery,
  buildSessionListQuery,
  parseSessionListParams,
  type SessionRow,
  shapeOffsetResponse,
  shapeSessionListResponse,
} from "@/lib/sessions";

export async function GET(request: Request) {
  const d1 = getD1Client();
  const db = new D1CliAuthDb(d1);

  const user = await resolveUser(request, {
    getSession: async () => {
      const session = await auth();
      if (!session?.user?.id) return null;
      return {
        userId: session.user.id,
        email: session.user.email ?? undefined,
      };
    },
    db,
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = parseSessionListParams(searchParams);

  const queryParams = {
    userId: user.userId,
    ...parsed,
  };

  const { sql, params } = buildSessionListQuery(queryParams);
  const result = await d1.query<SessionRow>(sql, params);

  // Offset pagination mode — include totalCount
  if (parsed.page) {
    const countQuery = buildSessionCountQuery(queryParams);
    const countResult = await d1.query<{ count: number }>(
      countQuery.sql,
      countQuery.params,
    );
    const totalCount = countResult.results[0]?.count ?? 0;

    const response = shapeOffsetResponse(
      result.results,
      totalCount,
      parsed.page,
      parsed.limit,
    );
    return NextResponse.json(response);
  }

  // Keyset pagination mode (default)
  const response = shapeSessionListResponse(
    result.results,
    parsed.sort,
    parsed.limit,
  );

  return NextResponse.json(response);
}
