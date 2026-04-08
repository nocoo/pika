import type { TableColumn } from "../../output/formatter.js";

// ─── API Response Types ───────────────────────────────────────

export interface SearchResultRow {
  session_id: string;
  title: string | null;
  source: string;
  snippet: string;
  last_message_at: string;
}

export interface SearchResponse {
  results: SearchResultRow[];
  total: number;
}

// ─── Table column definitions ─────────────────────────────────

function truncate(s: string | null, maxLen: number): string {
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
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

export const searchResultColumns: TableColumn<SearchResultRow>[] = [
  { key: "session_id", header: "Session", width: 14 },
  { key: (row) => truncate(row.title, 25), header: "Title", width: 25 },
  { key: (row) => truncate(row.snippet, 40), header: "Snippet", width: 40 },
  { key: (row) => formatRelativeTime(row.last_message_at), header: "Date", width: 10 },
];
