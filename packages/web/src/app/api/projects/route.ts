import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import {
  buildProjectListQuery,
  buildProjectOverviewQuery,
  buildProjectSourceDistributionQuery,
  assembleProjectOverview,
  groupSourceDistribution,
  type ProjectItem,
} from "@/lib/projects";
import type { Source } from "@pika/core";

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

  const userId = user.userId;

  // Run all queries in parallel
  const [overviewResult, listResult, sourceResult] = await Promise.all([
    d1.firstOrNull<{
      total_projects: number;
      total_sessions: number;
      total_messages: number;
      total_input_tokens: number;
      total_output_tokens: number;
    }>(
      buildProjectOverviewQuery(userId).sql,
      buildProjectOverviewQuery(userId).params,
    ),

    d1.query<ProjectItem>(
      buildProjectListQuery(userId).sql,
      buildProjectListQuery(userId).params,
    ),

    d1.query<{ project_ref: string; source: Source; count: number }>(
      buildProjectSourceDistributionQuery(userId).sql,
      buildProjectSourceDistributionQuery(userId).params,
    ),
  ]);

  return NextResponse.json({
    overview: assembleProjectOverview(overviewResult),
    projects: listResult.results,
    sourceDistribution: groupSourceDistribution(sourceResult.results),
  });
}
