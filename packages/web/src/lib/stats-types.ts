/**
 * Dashboard stats response types — mirror packages/api `/stats` shape.
 * Pure types, no DB query builders (those live in packages/api / packages/worker).
 */

import type { Source } from "@pika/core";

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
  date: string;
  count: number;
}

export interface TopProject {
  project_key: string;
  project_name: string | null;
  count: number;
}

export interface StatsResponse {
  overview: OverviewStats;
  sourceDistribution: SourceCount[];
  dailyActivity: DailyActivity[];
  topProjects: TopProject[];
}
