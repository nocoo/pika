# 02 - Database

## Overview

Pika uses a **dual storage** strategy:
- **Cloudflare D1** (SQLite): session metadata, message summaries, FTS5 index, auth tables
- **Cloudflare R2**: full conversation content as gzip-compressed JSON

## D1 Schema

### Auth Tables (NextAuth v5)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  email_verified INTEGER,
  image TEXT,
  api_key TEXT UNIQUE,                  -- "pk_" + 32 hex chars for CLI auth
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,               -- "google"
  provider_account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  UNIQUE(provider, provider_account_id)
);
```

### Sessions Table

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                  -- UUID, server-generated
  user_id TEXT NOT NULL REFERENCES users(id),
  session_key TEXT NOT NULL,            -- source-prefixed: "claude:{id}", "codex:{id}"

  source TEXT NOT NULL,                 -- "claude-code" | "codex" | "gemini-cli" | "opencode" | "vscode-copilot"

  -- Temporal
  started_at TEXT NOT NULL,             -- ISO 8601
  last_message_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL,            -- when CLI generated this snapshot

  -- Counts
  user_messages INTEGER NOT NULL DEFAULT 0,
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,

  -- Token usage (aggregated)
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cached_tokens INTEGER NOT NULL DEFAULT 0,

  -- Context
  project_ref TEXT,                     -- SHA-256 hash (16 hex) for privacy
  project_name TEXT,                    -- human-readable (from local path)
  model TEXT,                           -- primary model used
  title TEXT,                           -- session title
  summary TEXT,                         -- AI-generated summary (future)

  -- Content reference
  content_key TEXT,                     -- R2 object key
  content_size INTEGER,                 -- compressed size in bytes

  -- User organization
  is_starred INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  UNIQUE(user_id, session_key)
);
```

### Messages Table

Messages are stored with **truncated content** (first 2000 chars) for FTS indexing and list display. Full content lives in R2.

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                  -- UUID
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  role TEXT NOT NULL,                   -- "user" | "assistant" | "tool" | "system"
  content TEXT NOT NULL,                -- truncated to 2000 chars for D1/FTS

  -- Tool metadata (NULL if not tool call/result)
  tool_name TEXT,                       -- "Read", "Edit", "Bash", "WebFetch", etc.
  tool_input_summary TEXT,              -- abbreviated: file path, command, etc.

  -- Per-message token usage
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,

  model TEXT,                           -- model for this turn

  -- Ordering
  ordinal INTEGER NOT NULL,             -- 0-based position in session
  timestamp TEXT NOT NULL,              -- ISO 8601

  created_at TEXT DEFAULT (datetime('now'))
);
```

### Tags Table

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color TEXT,                           -- hex color: "#ff6b6b"
  UNIQUE(user_id, name)
);

CREATE TABLE session_tags (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, tag_id)
);
```

## Indexes

### Structured Query Indexes

```sql
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

-- Message lookup by user (for global search join)
CREATE INDEX idx_messages_user
  ON messages(user_id, timestamp DESC);

-- Tag lookups
CREATE INDEX idx_session_tags_session ON session_tags(session_id);
CREATE INDEX idx_session_tags_tag ON session_tags(tag_id);
```

### Full-Text Search (FTS5)

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  tool_name,
  tool_input_summary,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Auto-sync triggers
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, tool_name, tool_input_summary)
  VALUES (new.rowid, new.content, new.tool_name, new.tool_input_summary);
END;

CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, tool_name, tool_input_summary)
  VALUES ('delete', old.rowid, old.content, old.tool_name, old.tool_input_summary);
END;

CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, tool_name, tool_input_summary)
  VALUES ('delete', old.rowid, old.content, old.tool_name, old.tool_input_summary);
  INSERT INTO messages_fts(rowid, content, tool_name, tool_input_summary)
  VALUES (new.rowid, new.content, new.tool_name, new.tool_input_summary);
END;
```

## Query Performance Matrix

| Query | Index/Mechanism | Complexity |
|-------|-----------------|------------|
| Session list (paginated by time) | `idx_sessions_user_time` | O(log n) + page size |
| Filter by source | `idx_sessions_user_source` | Covering index scan |
| Filter by project | `idx_sessions_user_project` | Covering index scan |
| Starred sessions | `idx_sessions_user_starred` | Partial index, tiny result set |
| Sort by token usage | `idx_sessions_user_tokens` | Index-ordered scan |
| Session replay (messages) | `idx_messages_session` | Sequential by ordinal |
| Full-text search | `messages_fts` MATCH | FTS5 inverted index |
| Tag filter | Join via `session_tags` | Small join table |

## R2 Storage Layout

```
Bucket: pika-sessions
└── {user_id}/
    └── {session_key}/
        └── full.json.gz          # Complete conversation (gzip compressed)
```

### R2 Object Format (`full.json.gz`)

```typescript
interface SessionContent {
  sessionKey: string;
  source: Source;
  messages: FullMessage[];
}

interface FullMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;              // full content, NOT truncated
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  model?: string;
  tokens?: {
    input: number;
    output: number;
    cached: number;
  };
  timestamp: string;
}
```

### R2 Size Estimates

| Metric | Estimate |
|--------|----------|
| Avg session (raw JSON) | 50-500 KB |
| Avg session (gzip) | 10-100 KB |
| Compression ratio | ~75-85% |
| 1000 sessions | ~50 MB R2 |

## D1 Limits & Mitigations

| Limit | Value | Mitigation |
|-------|-------|------------|
| Max row size | 1 MB | Messages truncated to 2000 chars; full content in R2 |
| Max query result | 5 MB | Pagination (LIMIT/OFFSET); session list returns metadata only |
| Max batch size (free) | 50 statements | Batch ingest capped at 50 records |
| Max DB size (free) | 5 GB | Messages are truncated; R2 handles bulk |
| FTS5 index overhead | ~30-50% of text | Acceptable given truncated content |

## Migration Strategy

Migrations live in `scripts/migrations/` with numeric prefixes:

```
scripts/migrations/
├── 001-init.sql              # Auth + sessions + messages + FTS5
├── 002-tags.sql              # Tags + session_tags
└── ...                       # Incremental additions
```

Applied via `wrangler d1 migrations apply`.
