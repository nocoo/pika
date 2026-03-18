/**
 * Projects query builders.
 *
 * Aggregate queries for the project-centric dashboard page.
 * All queries are scoped to a single user and exclude soft-deleted sessions.
 * No `projects` table — pure aggregation on `sessions`.
 */

import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export interface ProjectItem {
  project_ref: string;
  project_name: string | null;
  session_count: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_activity: string; // ISO timestamp
}

export interface ProjectSourceCount {
  source: Source;
  count: number;
}

export interface ProjectOverview {
  totalProjects: number;
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ProjectDailyActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ProjectsResponse {
  overview: ProjectOverview;
  projects: ProjectItem[];
  sourceDistribution: Record<string, ProjectSourceCount[]>;
}

// ── Query builders ─────────────────────────────────────────────

/**
 * List all projects with aggregate stats.
 * Returns one row per project, ordered by session count descending.
 */
export function buildProjectListQuery(userId: string): BuiltQuery {
  return {
    sql: `
SELECT
  project_ref,
  project_name,
  COUNT(*) AS session_count,
  COALESCE(SUM(total_messages), 0) AS total_messages,
  COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens,
  MAX(last_message_at) AS last_activity
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
GROUP BY project_ref
ORDER BY session_count DESC
    `.trim(),
    params: [userId],
  };
}

/**
 * Overview stats across all projects.
 * Returns a single row with totals.
 */
export function buildProjectOverviewQuery(userId: string): BuiltQuery {
  return {
    sql: `
SELECT
  COUNT(DISTINCT project_ref) AS total_projects,
  COUNT(*) AS total_sessions,
  COALESCE(SUM(total_messages), 0) AS total_messages,
  COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
    `.trim(),
    params: [userId],
  };
}

/**
 * Source distribution across all projects.
 * Returns project_ref × source combinations for client-side grouping.
 */
export function buildProjectSourceDistributionQuery(
  userId: string,
): BuiltQuery {
  return {
    sql: `
SELECT project_ref, source, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref IS NOT NULL
GROUP BY project_ref, source
ORDER BY project_ref, count DESC
    `.trim(),
    params: [userId],
  };
}

/**
 * Daily activity for a single project (last N days, default 90).
 */
export function buildProjectDailyActivityQuery(
  userId: string,
  projectRef: string,
  days = 90,
): BuiltQuery {
  return {
    sql: `
SELECT date(started_at) AS date, COUNT(*) AS count
FROM sessions
WHERE user_id = ? AND deleted_at IS NULL AND project_ref = ? AND started_at >= datetime('now', ? || ' days')
GROUP BY date(started_at)
ORDER BY date ASC
    `.trim(),
    params: [userId, projectRef, `-${days}`],
  };
}

// ── Assembly helpers ───────────────────────────────────────────

/**
 * Null-safe assembly of overview stats from a query row.
 */
export function assembleProjectOverview(
  row: {
    total_projects: number;
    total_sessions: number;
    total_messages: number;
    total_input_tokens: number;
    total_output_tokens: number;
  } | null,
): ProjectOverview {
  return {
    totalProjects: row?.total_projects ?? 0,
    totalSessions: row?.total_sessions ?? 0,
    totalMessages: row?.total_messages ?? 0,
    totalInputTokens: row?.total_input_tokens ?? 0,
    totalOutputTokens: row?.total_output_tokens ?? 0,
  };
}

/**
 * Group flat source distribution rows into a Map keyed by project_ref.
 */
export function groupSourceDistribution(
  rows: { project_ref: string; source: Source; count: number }[],
): Record<string, ProjectSourceCount[]> {
  const result: Record<string, ProjectSourceCount[]> = {};
  for (const row of rows) {
    const list = result[row.project_ref] ?? [];
    list.push({ source: row.source, count: row.count });
    result[row.project_ref] = list;
  }
  return result;
}
