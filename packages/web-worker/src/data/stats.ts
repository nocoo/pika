/**
 * Worker stats route handler.
 *
 * Dashboard overview statistics.
 * Query logic reused from packages/web/src/lib/stats.ts.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
}

export interface OverviewRow {
  total_sessions: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface WeekCountRow {
  count: number;
}

export interface SourceCountRow {
  source: Source;
  count: number;
}

export interface DailyActivityRow {
  date: string;
  count: number;
}

export interface TopProjectRow {
  project_key: string;
  project_name: string | null;
  count: number;
}

// ── Handler ────────────────────────────────────────────────────

/**
 * GET /stats — Dashboard overview statistics.
 */
export async function handleStats(userId: string, env: Env): Promise<Response> {
  const overviewSql = `
SELECT
  COUNT(*) AS total_sessions,
  COALESCE(SUM(total_messages), 0) AS total_messages,
  COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL
  `.trim();

  const weekSql = `
SELECT COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND started_at >= datetime('now', '-7 days')
  `.trim();

  const sourceSql = `
SELECT source, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL
GROUP BY source
ORDER BY count DESC
  `.trim();

  const dailySql = `
SELECT date(started_at) AS date, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND started_at >= datetime('now', '-90 days')
GROUP BY date(started_at)
ORDER BY date ASC
  `.trim();

  const topProjectsSql = `
SELECT COALESCE(project_name, project_ref) AS project_key, project_name, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
GROUP BY project_key
ORDER BY count DESC
LIMIT 10
  `.trim();

  const [
    overviewResult,
    weekResult,
    sourceResult,
    dailyResult,
    topProjectsResult,
  ] = await Promise.all([
    env.DB.prepare(overviewSql).bind(userId).first<OverviewRow>(),
    env.DB.prepare(weekSql).bind(userId).first<WeekCountRow>(),
    env.DB.prepare(sourceSql).bind(userId).all<SourceCountRow>(),
    env.DB.prepare(dailySql).bind(userId).all<DailyActivityRow>(),
    env.DB.prepare(topProjectsSql).bind(userId).all<TopProjectRow>(),
  ]);

  return Response.json({
    overview: {
      totalSessions: overviewResult?.total_sessions ?? 0,
      totalMessages: overviewResult?.total_messages ?? 0,
      totalInputTokens: overviewResult?.total_input_tokens ?? 0,
      totalOutputTokens: overviewResult?.total_output_tokens ?? 0,
      sessionsThisWeek: weekResult?.count ?? 0,
    },
    sourceDistribution: sourceResult.results,
    dailyActivity: dailyResult.results,
    topProjects: topProjectsResult.results,
  });
}
