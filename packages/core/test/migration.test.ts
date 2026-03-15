import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  import.meta.dirname,
  "../../../scripts/migrations/001-init.sql",
);

describe("001-init migration", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Enable WAL mode and foreign keys like D1
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  it("applies migration without syntax errors", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(() => db.exec(sql)).not.toThrow();
  });

  it("creates all expected tables", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("users");
    expect(tables).toContain("accounts");
    expect(tables).toContain("sessions");
    expect(tables).toContain("messages");
    expect(tables).toContain("message_chunks");
    // FTS5 virtual table
    expect(tables).toContain("chunks_fts");
  });

  it("creates expected indexes", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r: any) => r.name);

    expect(indexes).toContain("idx_sessions_user_time");
    expect(indexes).toContain("idx_sessions_user_source");
    expect(indexes).toContain("idx_sessions_user_project");
    expect(indexes).toContain("idx_sessions_user_starred");
    expect(indexes).toContain("idx_sessions_user_tokens");
    expect(indexes).toContain("idx_messages_session");
    expect(indexes).toContain("idx_chunks_message");
    expect(indexes).toContain("idx_chunks_session");
  });

  it("sessions table has versioning columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    const columns = db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((r: any) => r.name);

    expect(columns).toContain("content_hash");
    expect(columns).toContain("raw_hash");
    expect(columns).toContain("parser_revision");
    expect(columns).toContain("schema_version");
    expect(columns).toContain("content_key");
    expect(columns).toContain("raw_key");
  });

  it("message_chunks table has tool_context column", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    const columns = db
      .prepare("PRAGMA table_info(message_chunks)")
      .all()
      .map((r: any) => r.name);

    expect(columns).toContain("content");
    expect(columns).toContain("tool_context");
    expect(columns).toContain("chunk_index");
    expect(columns).toContain("ordinal");
  });

  it("enforces unique constraint on (user_id, session_key)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    // Insert a user first
    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();

    // Insert a session
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();

    // Duplicate should fail
    expect(() =>
      db
        .prepare(
          `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
           VALUES ('s2', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("enforces unique constraint on (message_id, chunk_index)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO messages (id, session_id, user_id, role, ordinal, timestamp)
       VALUES ('m1', 's1', 'u1', 'user', 0, '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO message_chunks (id, session_id, message_id, user_id, ordinal, chunk_index, content)
       VALUES ('c1', 's1', 'm1', 'u1', 0, 0, 'Hello world')`,
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO message_chunks (id, session_id, message_id, user_id, ordinal, chunk_index, content)
           VALUES ('c2', 's1', 'm1', 'u1', 0, 0, 'Duplicate chunk')`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("FTS5 auto-sync triggers work on insert", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO messages (id, session_id, user_id, role, ordinal, timestamp)
       VALUES ('m1', 's1', 'u1', 'user', 0, '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO message_chunks (id, session_id, message_id, user_id, ordinal, chunk_index, content, tool_context)
       VALUES ('c1', 's1', 'm1', 'u1', 0, 0, 'How to deploy Next.js', 'Bash: npm run build')`,
    ).run();

    // FTS should find the content
    const results = db
      .prepare("SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'deploy'")
      .all();
    expect(results.length).toBe(1);

    // FTS should find tool_context
    const toolResults = db
      .prepare(
        "SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'tool_context:Bash'",
      )
      .all();
    expect(toolResults.length).toBe(1);
  });

  it("cascade deletes messages and chunks when session is deleted", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO messages (id, session_id, user_id, role, ordinal, timestamp)
       VALUES ('m1', 's1', 'u1', 'user', 0, '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO message_chunks (id, session_id, message_id, user_id, ordinal, chunk_index, content)
       VALUES ('c1', 's1', 'm1', 'u1', 0, 0, 'Hello')`,
    ).run();

    // Delete session — should cascade
    db.prepare("DELETE FROM sessions WHERE id = 's1'").run();

    const messages = db.prepare("SELECT * FROM messages").all();
    const chunks = db.prepare("SELECT * FROM message_chunks").all();
    expect(messages.length).toBe(0);
    expect(chunks.length).toBe(0);
  });

  it("FTS delete trigger fires on chunk deletion", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO messages (id, session_id, user_id, role, ordinal, timestamp)
       VALUES ('m1', 's1', 'u1', 'user', 0, '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO message_chunks (id, session_id, message_id, user_id, ordinal, chunk_index, content)
       VALUES ('c1', 's1', 'm1', 'u1', 0, 0, 'Searchable text here')`,
    ).run();

    // Verify FTS has the entry
    let results = db
      .prepare(
        "SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'Searchable'",
      )
      .all();
    expect(results.length).toBe(1);

    // Delete the chunk
    db.prepare("DELETE FROM message_chunks WHERE id = 'c1'").run();

    // FTS should no longer find it
    results = db
      .prepare(
        "SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'Searchable'",
      )
      .all();
    expect(results.length).toBe(0);
  });
});

// ── 002-tags migration ─────────────────────────────────────────

const MIGRATION_002_PATH = resolve(
  import.meta.dirname,
  "../../../scripts/migrations/002-tags.sql",
);

describe("002-tags migration", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");

    // Apply 001 first (prerequisite)
    const init = readFileSync(MIGRATION_PATH, "utf-8");
    db.exec(init);
  });

  afterEach(() => {
    db.close();
  });

  it("applies migration without syntax errors", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    expect(() => db.exec(sql)).not.toThrow();
  });

  it("creates tags and session_tags tables", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tags', 'session_tags') ORDER BY name",
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toEqual(["session_tags", "tags"]);
  });

  it("creates expected indexes", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_session_tags_%' ORDER BY name",
      )
      .all()
      .map((r: any) => r.name);

    expect(indexes).toEqual(["idx_session_tags_session", "idx_session_tags_tag"]);
  });

  it("tags table has expected columns", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    const columns = db
      .prepare("PRAGMA table_info(tags)")
      .all()
      .map((r: any) => r.name);

    expect(columns).toContain("id");
    expect(columns).toContain("user_id");
    expect(columns).toContain("name");
    expect(columns).toContain("color");
    expect(columns).toContain("created_at");
  });

  it("enforces unique constraint on (user_id, name)", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();

    db.prepare(
      "INSERT INTO tags (id, user_id, name, color) VALUES ('t1', 'u1', 'bug', '#ff0000')",
    ).run();

    expect(() =>
      db
        .prepare(
          "INSERT INTO tags (id, user_id, name, color) VALUES ('t2', 'u1', 'bug', '#00ff00')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("allows same tag name for different users", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'a@test.com')",
    ).run();
    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u2', 'b@test.com')",
    ).run();

    db.prepare(
      "INSERT INTO tags (id, user_id, name) VALUES ('t1', 'u1', 'bug')",
    ).run();

    expect(() =>
      db
        .prepare(
          "INSERT INTO tags (id, user_id, name) VALUES ('t2', 'u2', 'bug')",
        )
        .run(),
    ).not.toThrow();
  });

  it("session_tags cascades on session delete", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      "INSERT INTO tags (id, user_id, name) VALUES ('t1', 'u1', 'bug')",
    ).run();
    db.prepare(
      "INSERT INTO session_tags (session_id, tag_id) VALUES ('s1', 't1')",
    ).run();

    // Delete session — session_tags should cascade
    db.prepare("DELETE FROM sessions WHERE id = 's1'").run();

    const rows = db.prepare("SELECT * FROM session_tags").all();
    expect(rows.length).toBe(0);
  });

  it("session_tags cascades on tag delete", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      "INSERT INTO tags (id, user_id, name) VALUES ('t1', 'u1', 'bug')",
    ).run();
    db.prepare(
      "INSERT INTO session_tags (session_id, tag_id) VALUES ('s1', 't1')",
    ).run();

    // Delete tag — session_tags should cascade
    db.prepare("DELETE FROM tags WHERE id = 't1'").run();

    const rows = db.prepare("SELECT * FROM session_tags").all();
    expect(rows.length).toBe(0);
  });

  it("session_tags enforces composite primary key", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    db.prepare(
      "INSERT INTO users (id, email) VALUES ('u1', 'test@example.com')",
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, session_key, source, started_at, last_message_at, duration_seconds, snapshot_at, parser_revision, schema_version)
       VALUES ('s1', 'u1', 'claude:abc', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 3600, '2026-01-01T01:01:00Z', 1, 1)`,
    ).run();
    db.prepare(
      "INSERT INTO tags (id, user_id, name) VALUES ('t1', 'u1', 'bug')",
    ).run();
    db.prepare(
      "INSERT INTO session_tags (session_id, tag_id) VALUES ('s1', 't1')",
    ).run();

    // Duplicate should fail
    expect(() =>
      db
        .prepare(
          "INSERT INTO session_tags (session_id, tag_id) VALUES ('s1', 't1')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("is idempotent with 001 — existing tables unaffected", () => {
    const sql = readFileSync(MIGRATION_002_PATH, "utf-8");
    db.exec(sql);

    // Verify 001 tables still exist
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions', 'messages') ORDER BY name",
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toEqual(["messages", "sessions", "users"]);
  });
});
