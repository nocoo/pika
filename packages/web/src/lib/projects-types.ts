import type { Source } from "@pika/core";

export interface ProjectItem {
  project_key: string;
  project_name: string | null;
  session_count: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_activity: string;
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
  date: string;
  sessions: number;
  messages: number;
  tokens: number;
  duration: number;
}

export interface ProjectsResponse {
  overview: ProjectOverview;
  projects: ProjectItem[];
  sourceDistribution: Record<string, ProjectSourceCount[]>;
}
