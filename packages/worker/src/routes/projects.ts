/**
 * Worker projects route handlers.
 *
 * Aggregate queries for project-centric dashboard.
 * Query logic reused from packages/web/src/lib/projects.ts.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
}

export interface ProjectItem {
  project_key: string;
  project_name: string | null;
  project_refs: string | null;
  session_count: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_activity: string;
}

export interface ProjectOverview {
  total_projects: number;
  total_sessions: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface ProjectSourceRow {
  project_key: string;
  source: Source;
  count: number;
}

export interface DailyActivity {
  date: string;
  sessions: number;
  messages: number;
  tokens: number;
  duration: number;
}

// ── Handlers ───────────────────────────────────────────────────

/**
 * GET /projects — List all projects with aggregate stats.
 */
export async function handleListProjects(
  userId: string,
  _searchParams: URLSearchParams,
  env: Env,
): Promise<Response> {
  const listSql = `
SELECT
  COALESCE(project_name, project_ref) AS project_key,
  project_name,
  GROUP_CONCAT(DISTINCT project_ref) AS project_refs,
  COUNT(*) AS session_count,
  COALESCE(SUM(total_messages), 0) AS total_messages,
  COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens,
  MAX(last_message_at) AS last_activity
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
GROUP BY COALESCE(project_name, project_ref)
ORDER BY session_count DESC
  `.trim();

  const overviewSql = `
SELECT
  COUNT(DISTINCT COALESCE(project_name, project_ref)) AS total_projects,
  COUNT(*) AS total_sessions,
  COALESCE(SUM(total_messages), 0) AS total_messages,
  COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
  `.trim();

  const sourceSql = `
SELECT COALESCE(project_name, project_ref) AS project_key, source, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
GROUP BY COALESCE(project_name, project_ref), source
ORDER BY project_key, count DESC
  `.trim();

  const [listResult, overviewResult, sourceResult] = await Promise.all([
    env.DB.prepare(listSql).bind(userId).all<ProjectItem>(),
    env.DB.prepare(overviewSql).bind(userId).first<ProjectOverview>(),
    env.DB.prepare(sourceSql).bind(userId).all<ProjectSourceRow>(),
  ]);

  // Group source distribution by project_key
  const sourceDistribution: Record<
    string,
    { source: Source; count: number }[]
  > = {};
  for (const row of sourceResult.results) {
    const list = sourceDistribution[row.project_key] ?? [];
    list.push({ source: row.source, count: row.count });
    sourceDistribution[row.project_key] = list;
  }

  return Response.json({
    overview: {
      totalProjects: overviewResult?.total_projects ?? 0,
      totalSessions: overviewResult?.total_sessions ?? 0,
      totalMessages: overviewResult?.total_messages ?? 0,
      totalInputTokens: overviewResult?.total_input_tokens ?? 0,
      totalOutputTokens: overviewResult?.total_output_tokens ?? 0,
    },
    projects: listResult.results,
    sourceDistribution,
  });
}

/**
 * GET /projects/activity — Daily activity for one or more projects.
 * Returns sessions, messages, tokens, and duration per day.
 */
export async function handleProjectActivity(
  userId: string,
  searchParams: URLSearchParams,
  env: Env,
): Promise<Response> {
  const projectKey = searchParams.get("projectKey");
  if (!projectKey) {
    return Response.json({ error: "projectKey is required" }, { status: 400 });
  }

  const daysRaw = searchParams.get("days");
  const days = daysRaw ? parseInt(daysRaw, 10) : 90;
  const validDays = Number.isNaN(days) || days < 1 ? 90 : Math.min(days, 365);

  const keys = projectKey.split(",").filter(Boolean);

  let sql: string;
  let params: unknown[];

  const selectClause = `
SELECT
  date(started_at) AS date,
  COUNT(*) AS sessions,
  COALESCE(SUM(total_messages), 0) AS messages,
  COALESCE(SUM(total_input_tokens), 0) + COALESCE(SUM(total_output_tokens), 0) AS tokens,
  COALESCE(SUM(duration_seconds), 0) AS duration
FROM sessions
  `.trim();

  if (keys.length === 1) {
    sql = `
${selectClause}
WHERE user_id = ? AND deleted_at IS NULL AND COALESCE(project_name, project_ref) = ? AND started_at >= datetime('now', ? || ' days')
GROUP BY date(started_at)
ORDER BY date ASC
    `.trim();
    params = [userId, keys[0]!, `-${validDays}`];
  } else {
    const placeholders = keys.map(() => "?").join(", ");
    sql = `
${selectClause}
WHERE user_id = ? AND deleted_at IS NULL AND COALESCE(project_name, project_ref) IN (${placeholders}) AND started_at >= datetime('now', ? || ' days')
GROUP BY date(started_at)
ORDER BY date ASC
    `.trim();
    params = [userId, ...keys, `-${validDays}`];
  }

  const result = await env.DB.prepare(sql)
    .bind(...params)
    .all<DailyActivity>();

  return Response.json({ activity: result.results });
}
