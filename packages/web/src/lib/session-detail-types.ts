import type { Source } from "@pika/core";

export interface SessionDetailRow {
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
  summary: string | null;
  description: string | null;
  content_key: string | null;
  content_size: number | null;
  raw_key: string | null;
  raw_size: number | null;
  raw_hash: string | null;
  content_hash: string | null;
  is_starred: number;
  deleted_at: string | null;
  snapshot_at: string;
  ingested_at: string;
}

export interface SessionDetailResponse {
  session: SessionDetailRow;
  contentUrl: string | null;
  rawUrl: string | null;
}
