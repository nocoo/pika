import type { TableColumn } from "../../output/formatter.js";

// ─── API Response Types ───────────────────────────────────────

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface TagsResponse {
  tags: TagRow[];
}

export interface TagCreateResponse {
  id: string;
  name: string;
  color: string | null;
}

// ─── Table column definitions ─────────────────────────────────

export const tagListColumns: TableColumn<TagRow>[] = [
  { key: "id", header: "ID", width: 36 },
  { key: "name", header: "Name", width: 20 },
  { key: (row) => row.color ?? "(none)", header: "Color", width: 10 },
];
