import { describe, it, expect } from "vitest";
import {
  buildSessionDetailQuery,
  canonicalR2Key,
  rawR2Key,
} from "./session-detail.js";

// ── buildSessionDetailQuery ────────────────────────────────────

describe("buildSessionDetailQuery", () => {
  it("returns SQL with sessionId and userId params", () => {
    const { sql, params } = buildSessionDetailQuery("sess-1", "user-1");

    expect(sql).toContain("FROM sessions s");
    expect(sql).toContain("s.id = ?");
    expect(sql).toContain("s.user_id = ?");
    expect(params).toEqual(["sess-1", "user-1"]);
  });

  it("selects all expected columns", () => {
    const { sql } = buildSessionDetailQuery("s", "u");

    const expectedColumns = [
      "s.id", "s.session_key", "s.source", "s.started_at", "s.last_message_at",
      "s.duration_seconds", "s.user_messages", "s.assistant_messages", "s.total_messages",
      "s.total_input_tokens", "s.total_output_tokens", "s.total_cached_tokens",
      "s.project_ref", "s.project_name", "s.model", "s.title", "s.summary",
      "s.content_key", "s.content_size", "s.raw_key", "s.raw_size",
      "s.raw_hash", "s.content_hash", "s.is_starred",
      "s.snapshot_at", "s.ingested_at",
    ];

    for (const col of expectedColumns) {
      expect(sql).toContain(col);
    }
  });
});

// ── R2 key helpers ─────────────────────────────────────────────

describe("canonicalR2Key", () => {
  it("builds correct key pattern", () => {
    expect(canonicalR2Key("user-1", "claude:abc123")).toBe(
      "user-1/claude:abc123/canonical.json.gz",
    );
  });
});

describe("rawR2Key", () => {
  it("builds correct key pattern with hash", () => {
    expect(rawR2Key("user-1", "claude:abc", "deadbeef")).toBe(
      "user-1/claude:abc/raw/deadbeef.json.gz",
    );
  });
});
