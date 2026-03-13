import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import {
  buildOverviewQuery,
  buildWeekCountQuery,
  buildSourceDistributionQuery,
  buildDailyActivityQuery,
  buildTopProjectsQuery,
  assembleOverviewStats,
  type SourceCount,
  type DailyActivity,
  type TopProject,
} from "@/lib/stats";

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
  const [overviewResult, weekResult, sourceResult, activityResult, projectsResult] =
    await Promise.all([
      d1.firstOrNull<{
        total_sessions: number;
        total_messages: number;
        total_input_tokens: number;
        total_output_tokens: number;
      }>(buildOverviewQuery(userId).sql, buildOverviewQuery(userId).params),

      d1.firstOrNull<{ count: number }>(
        buildWeekCountQuery(userId).sql,
        buildWeekCountQuery(userId).params,
      ),

      d1.query<SourceCount>(
        buildSourceDistributionQuery(userId).sql,
        buildSourceDistributionQuery(userId).params,
      ),

      d1.query<DailyActivity>(
        buildDailyActivityQuery(userId).sql,
        buildDailyActivityQuery(userId).params,
      ),

      d1.query<TopProject>(
        buildTopProjectsQuery(userId).sql,
        buildTopProjectsQuery(userId).params,
      ),
    ]);

  return NextResponse.json({
    overview: assembleOverviewStats(overviewResult, weekResult),
    sourceDistribution: sourceResult.results,
    dailyActivity: activityResult.results,
    topProjects: projectsResult.results,
  });
}
