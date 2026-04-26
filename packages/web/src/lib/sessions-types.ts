/**
 * Subset of SessionRow used by dashboard's RecentSessions widget. Mirror of
 * the row shape returned by `/api/sessions` (full type lives in api package).
 */

import type { Source } from "@pika/core";

export interface SessionRow {
  id: string;
  session_key: string;
  source: Source;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  project_ref: string | null;
  project_name: string | null;
  model: string | null;
  title: string | null;
  is_starred: number;
  deleted_at: string | null;
}

export interface SessionListResponse {
  sessions: SessionRow[];
  cursor?: string | null;
  hasMore?: boolean;
  /** Present only in offset pagination mode */
  totalCount?: number;
}

export type SessionSort =
  | "last_message_at"
  | "started_at"
  | "total_input_tokens"
  | "total_messages"
  | "duration_seconds";

export interface SessionCardTag {
  id: string;
  name: string;
  color: string | null;
}

export interface SessionCardData extends SessionRow {
  tags?: SessionCardTag[];
}
