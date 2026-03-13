/**
 * Stats query builders.
 *
 * Aggregate queries for the dashboard overview page.
 * All queries are scoped to a single user.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export interface OverviewStats {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionsThisWeek: number;
}

export interface SourceCount {
  source: Source;
  count: number;
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface TopProject {
  project_ref: string;
  project_name: string | null;
  count: number;
}

export interface StatsResponse {
  overview: OverviewStats;
  sourceDistribution: SourceCount[];
  dailyActivity: DailyActivity[];
  topProjects: TopProject[];
}

// ── Query builders ─────────────────────────────────────────────

/**
 * Total counts across all user sessions.
 */
export function buildOverviewQuery(userId: string): BuiltQuery {
  return {
    sql: `
SELECT
  COUNT(*) AS total_sessions,
  COALESCE(SUM(total_messages), 0) AS total_messages,
  COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens
FROM sessions
WHERE user_id = ?
    `.trim(),
    params: [userId],
  };
}

/**
 * Sessions created in the last 7 days.
 */
export function buildWeekCountQuery(userId: string): BuiltQuery {
  return {
    sql: `
SELECT COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND started_at >= datetime('now', '-7 days')
    `.trim(),
    params: [userId],
  };
}

/**
 * Session count grouped by source.
 */
export function buildSourceDistributionQuery(userId: string): BuiltQuery {
  return {
    sql: `
SELECT source, COUNT(*) AS count
FROM sessions
WHERE user_id = ?
GROUP BY source
ORDER BY count DESC
    `.trim(),
    params: [userId],
  };
}

/**
 * Sessions per day for the last N days (default 90).
 */
export function buildDailyActivityQuery(
  userId: string,
  days = 90,
): BuiltQuery {
  return {
    sql: `
SELECT date(started_at) AS date, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND started_at >= datetime('now', ? || ' days')
GROUP BY date(started_at)
ORDER BY date ASC
    `.trim(),
    params: [userId, `-${days}`],
  };
}

/**
 * Top projects by session count (max 10).
 */
export function buildTopProjectsQuery(userId: string): BuiltQuery {
  return {
    sql: `
SELECT project_ref, project_name, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND project_ref IS NOT NULL
GROUP BY project_ref
ORDER BY count DESC
LIMIT 10
    `.trim(),
    params: [userId],
  };
}

// ── Assemble overview stats from query results ─────────────────

export function assembleOverviewStats(
  overviewRow: { total_sessions: number; total_messages: number; total_input_tokens: number; total_output_tokens: number } | null,
  weekRow: { count: number } | null,
): OverviewStats {
  return {
    totalSessions: overviewRow?.total_sessions ?? 0,
    totalMessages: overviewRow?.total_messages ?? 0,
    totalInputTokens: overviewRow?.total_input_tokens ?? 0,
    totalOutputTokens: overviewRow?.total_output_tokens ?? 0,
    sessionsThisWeek: weekRow?.count ?? 0,
  };
}
