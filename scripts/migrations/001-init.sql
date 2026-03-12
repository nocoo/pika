-- 001-init.sql
-- Auth + sessions + messages + message_chunks + FTS5

-- ── Auth Tables (NextAuth v5) ──────────────────────────────────

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  email_verified INTEGER,
  image TEXT,
  api_key TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  UNIQUE(provider, provider_account_id)
);

-- ── Sessions ───────────────────────────────────────────────────

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_key TEXT NOT NULL,

  source TEXT NOT NULL,

  -- Temporal
  started_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL,

  -- Counts
  user_messages INTEGER NOT NULL DEFAULT 0,
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,

  -- Token usage (aggregated)
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cached_tokens INTEGER NOT NULL DEFAULT 0,

  -- Context
  project_ref TEXT,
  project_name TEXT,
  model TEXT,
  title TEXT,
  summary TEXT,

  -- Content references (R2 keys)
  content_key TEXT,
  content_size INTEGER,
  raw_key TEXT,
  raw_size INTEGER,

  -- Versioning & idempotency
  content_hash TEXT,
  raw_hash TEXT,
  parser_revision INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,
  ingested_at TEXT,

  -- User organization
  is_starred INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  UNIQUE(user_id, session_key)
);

-- ── Messages ───────────────────────────────────────────────────

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  role TEXT NOT NULL,

  -- Tool metadata
  tool_name TEXT,
  tool_input_summary TEXT,

  -- Per-message token usage
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,

  model TEXT,

  -- Ordering
  ordinal INTEGER NOT NULL,
  timestamp TEXT NOT NULL,

  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Message Chunks (Chunked FTS) ──────────────────────────────

CREATE TABLE message_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  ordinal INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,

  content TEXT NOT NULL,
  tool_context TEXT,

  created_at TEXT DEFAULT (datetime('now')),

  UNIQUE(message_id, chunk_index)
);

-- ── Indexes ────────────────────────────────────────────────────

-- Session list by time (most common query)
CREATE INDEX idx_sessions_user_time
  ON sessions(user_id, last_message_at DESC);

-- Filter by source
CREATE INDEX idx_sessions_user_source
  ON sessions(user_id, source, last_message_at DESC);

-- Filter by project
CREATE INDEX idx_sessions_user_project
  ON sessions(user_id, project_ref, last_message_at DESC);

-- Starred sessions (partial index)
CREATE INDEX idx_sessions_user_starred
  ON sessions(user_id, is_starred, last_message_at DESC)
  WHERE is_starred = 1;

-- Sort by token usage
CREATE INDEX idx_sessions_user_tokens
  ON sessions(user_id, total_input_tokens DESC);

-- Message lookup by session
CREATE INDEX idx_messages_session
  ON messages(session_id, ordinal);

-- Chunk lookup by message
CREATE INDEX idx_chunks_message
  ON message_chunks(message_id, chunk_index);

-- Chunk lookup by session (for batch delete on re-ingest)
CREATE INDEX idx_chunks_session
  ON message_chunks(session_id);

-- ── FTS5 ───────────────────────────────────────────────────────

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  tool_context,
  content='message_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Auto-sync triggers
CREATE TRIGGER chunks_fts_ai AFTER INSERT ON message_chunks BEGIN
  INSERT INTO chunks_fts(rowid, content, tool_context)
  VALUES (new.rowid, new.content, new.tool_context);
END;

CREATE TRIGGER chunks_fts_ad AFTER DELETE ON message_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, tool_context)
  VALUES ('delete', old.rowid, old.content, old.tool_context);
END;

CREATE TRIGGER chunks_fts_au AFTER UPDATE ON message_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, tool_context)
  VALUES ('delete', old.rowid, old.content, old.tool_context);
  INSERT INTO chunks_fts(rowid, content, tool_context)
  VALUES (new.rowid, new.content, new.tool_context);
END;
