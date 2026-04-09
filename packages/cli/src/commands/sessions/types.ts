// ─── API Response Types ───────────────────────────────────────

export interface SessionRow {
  id: string;
  session_key: string;
  title: string | null;
  summary: string | null;
  description: string | null;
  source: string;
  project_ref: string | null;
  project_name: string | null;
  started_at: string;
  last_message_at: string;
  total_messages: number;
  user_messages: number;
  assistant_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  duration_seconds: number;
  is_starred: boolean;
  deleted_at: string | null;
}

export interface SessionListResponse {
  sessions: SessionRow[];
  cursor: string | null;
  hasMore: boolean;
  totalCount?: number;
  page?: number;
  pageSize?: number;
}

export interface SessionContentResponse {
  messages: CanonicalMessage[];
}

/**
 * Canonical message format from R2 storage.
 * All content is plain string (no Anthropic-style blocks).
 * Tool information stored in separate fields.
 */
export interface CanonicalMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  timestamp: string;
}

// ─── Table column definitions ─────────────────────────────────

import type { TableColumn } from "../../output/formatter.js";

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
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

export const sessionListColumns: TableColumn<SessionRow>[] = [
  { key: "id", header: "ID", width: 14 },
  { key: (row) => truncate(row.title, 30), header: "Title", width: 30 },
  { key: "source", header: "Source", width: 12 },
  {
    key: (row) => String(row.total_messages),
    header: "Msgs",
    width: 5,
    align: "right",
  },
  {
    key: (row) => formatRelativeTime(row.last_message_at),
    header: "Date",
    width: 10,
  },
];

export const sessionDetailColumns: TableColumn<SessionRow>[] = [
  { key: "id", header: "ID" },
  { key: "session_key", header: "Session Key" },
  { key: (row) => row.title ?? "(untitled)", header: "Title" },
  { key: (row) => row.description ?? "", header: "Description" },
  { key: "source", header: "Source" },
  {
    key: (row) => row.project_name ?? row.project_ref ?? "(none)",
    header: "Project",
  },
  { key: "started_at", header: "Started" },
  { key: "last_message_at", header: "Last Message" },
  { key: (row) => String(row.total_messages), header: "Messages" },
  { key: (row) => String(row.user_messages), header: "User Messages" },
  {
    key: (row) => String(row.assistant_messages),
    header: "Assistant Messages",
  },
  { key: (row) => String(row.total_input_tokens), header: "Input Tokens" },
  { key: (row) => String(row.total_output_tokens), header: "Output Tokens" },
  { key: (row) => String(row.total_cached_tokens), header: "Cached Tokens" },
  { key: (row) => formatDuration(row.duration_seconds), header: "Duration" },
  { key: (row) => (row.is_starred ? "Yes" : "No"), header: "Starred" },
];

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}
