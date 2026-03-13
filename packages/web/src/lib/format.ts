/**
 * Pure formatting helpers for the dashboard.
 *
 * Dates, durations, source labels — no React dependency.
 */

import type { Source } from "@pika/core";

// ── Source labels ───────────────────────────────────────────────

const SOURCE_LABELS: Record<Source, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  "vscode-copilot": "VS Code Copilot",
};

export function sourceLabel(source: Source): string {
  return SOURCE_LABELS[source] ?? source;
}

// ── Duration formatting ────────────────────────────────────────

/**
 * Format seconds into a human-readable duration string.
 * Examples: "2m", "1h 23m", "3h", "< 1m"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0m";
  if (seconds < 60) return "< 1m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ── Relative time ──────────────────────────────────────────────

/**
 * Format an ISO timestamp into a relative time string.
 * Examples: "just now", "5m ago", "2h ago", "3d ago", "Jan 15"
 */
export function relativeTime(iso: string, now?: Date): string {
  const date = new Date(iso);
  const ref = now ?? new Date();
  const diffMs = ref.getTime() - date.getTime();

  if (diffMs < 0) return "just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  // Older than 30 days — show month + day
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Date formatting ────────────────────────────────────────────

/**
 * Format an ISO date string to "Jan 15, 2025" style.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format an ISO timestamp to "Jan 15, 2:30 PM" style.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Activity heatmap helpers ───────────────────────────────────

export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * Build a full 90-day heatmap grid from sparse daily activity data.
 * Fills in missing days with count=0.
 * Assigns intensity levels (0-4) based on the max count in the range.
 */
export function buildHeatmapData(
  dailyActivity: { date: string; count: number }[],
  days = 90,
  today?: Date,
): HeatmapDay[] {
  const ref = today ?? new Date();
  const activityMap = new Map<string, number>();
  for (const d of dailyActivity) {
    activityMap.set(d.date, d.count);
  }

  // Build full date range
  const result: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(ref);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: activityMap.get(key) ?? 0 });
  }

  // Compute max for level assignment
  const maxCount = Math.max(1, ...result.map((d) => d.count));

  return result.map((d) => ({
    ...d,
    level: countToLevel(d.count, maxCount),
  }));
}

function countToLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}
