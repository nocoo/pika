import type { TableColumn } from "../../output/formatter.js";

// ─── API Response Types (snake_case from Worker) ──────────────

export interface ProjectItemRaw {
  project_key: string;
  project_name: string | null;
  project_refs: string | null;
  session_count: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_activity: string;
}

export interface ProjectsOverview {
  totalProjects: number;
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface SourceDistribution {
  source: string;
  count: number;
}

export interface ProjectsResponse {
  overview: ProjectsOverview;
  projects: ProjectItemRaw[];
  sourceDistribution: Record<string, SourceDistribution[]>;
}

// ─── Normalized type for display ──────────────────────────────

export interface ProjectItem {
  projectKey: string;
  sessionCount: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastActivity: string;
}

export function normalizeProject(raw: ProjectItemRaw): ProjectItem {
  return {
    projectKey: raw.project_key,
    sessionCount: raw.session_count,
    totalMessages: raw.total_messages,
    totalInputTokens: raw.total_input_tokens,
    totalOutputTokens: raw.total_output_tokens,
    lastActivity: raw.last_activity,
  };
}

// ─── Table column definitions ─────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 7) {
    return date.toLocaleDateString();
  }
  if (diffDay > 0) {
    return diffDay === 1 ? "yesterday" : `${diffDay}d ago`;
  }
  if (diffHour > 0) {
    return `${diffHour}h ago`;
  }
  if (diffMin > 0) {
    return `${diffMin}m ago`;
  }
  return "just now";
}

function truncate(s: string | null, maxLen: number): string {
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

export const projectListColumns: TableColumn<ProjectItem>[] = [
  { key: (row) => truncate(row.projectKey, 30), header: "Project", width: 30 },
  { key: (row) => String(row.sessionCount), header: "Sessions", width: 8, align: "right" },
  { key: (row) => formatNumber(row.totalMessages), header: "Msgs", width: 8, align: "right" },
  { key: (row) => formatNumber(row.totalInputTokens), header: "In Tokens", width: 10, align: "right" },
  { key: (row) => formatNumber(row.totalOutputTokens), header: "Out Tokens", width: 10, align: "right" },
  { key: (row) => formatRelativeTime(row.lastActivity), header: "Last Active", width: 12 },
];
