import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveUser } from "@/lib/cli-auth";
import { getD1Client } from "@/lib/d1";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import {
  assembleOverviewStats,
  buildDailyActivityQuery,
  buildOverviewQuery,
  buildSourceDistributionQuery,
  buildTopProjectsQuery,
  buildWeekCountQuery,
  type DailyActivity,
  type SourceCount,
  type TopProject,
} from "@/lib/stats";

// ── Period → days mapping ──────────────────────────────────────

const PERIOD_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
  month: null, // handled separately below
  all: null, // all-time, no filter
};

function periodToActivityDays(period: string): number | null {
  // "month" = first day of current month to today
  if (period === "month") return null;
  return PERIOD_DAYS[period] ?? 365;
}

// ── Route ─────────────────────────────────────────────────────

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
  const period = searchParams.get("period") ?? "365d";
  const activityDays = periodToActivityDays(period);

  // For "month" period, build a custom query with first-of-month filter
  const activityQuery =
    period === "month"
      ? {
          sql: `
SELECT date(started_at) AS date, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND started_at >= date('now', 'start of month')
GROUP BY date(started_at)
ORDER BY date ASC
          `.trim(),
          params: [user.userId] as unknown[],
        }
      : buildDailyActivityQuery(user.userId, activityDays);

  const userId = user.userId;

  // Run all queries in parallel
  const [
    overviewResult,
    weekResult,
    sourceResult,
    activityResult,
    projectsResult,
  ] = await Promise.all([
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
      activityQuery.sql,
      activityQuery.params as string[],
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
