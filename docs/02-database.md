# 02 - Database

## Overview

Pika uses a **three-tier storage** strategy:
- **Cloudflare D1** (SQLite): session metadata, message metadata, chunked content for FTS5 search
- **Cloudflare R2** (raw archive): complete raw source payloads (gzip), immutable archive
- **Cloudflare R2** (canonical): full canonical conversation content (gzip), for replay

### Design Principles

1. **No irreversible truncation**: D1 never stores truncated-then-discarded content. All searchable text is chunked, never clipped.
2. **Idempotent versioned overwrites**: Same session can be re-uploaded safely. content_hash deduplicates; parser_version enables re-parse without data loss.
3. **Canonical + Raw dual layer**: Canonical (normalized) data powers the UI; raw source payloads are archived for future re-parsing, distillation, or audit.
4. **Schema supports future derived artifacts**: summary, embeddings, memory candidates can attach to sessions without schema migration.

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

  -- Content references (R2 keys)
  content_key TEXT,                     -- R2 key for canonical conversation
  content_size INTEGER,                 -- compressed size in bytes
  raw_key TEXT,                         -- R2 key for raw source payload
  raw_size INTEGER,                     -- compressed raw size in bytes

  -- Versioning & idempotency
  content_hash TEXT,                    -- SHA-256 of uncompressed canonical JSON
  parser_version TEXT NOT NULL DEFAULT '1.0.0',  -- parser that produced this data
  schema_version INTEGER NOT NULL DEFAULT 1,     -- canonical schema version
  ingested_at TEXT,                     -- when server accepted this upload

  -- User organization
  is_starred INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  UNIQUE(user_id, session_key)
);
```

### Messages Table

Messages store metadata and role/tool info. Full content is NOT here — it lives in `message_chunks`.

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                  -- UUID
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  role TEXT NOT NULL,                   -- "user" | "assistant" | "tool" | "system"

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

### Message Chunks Table (Chunked FTS)

Every message's content is split into chunks (max ~2000 chars at natural boundaries: paragraph, sentence, line). Each chunk is independently searchable via FTS5.

**Why chunks instead of truncation?**
- Truncation is irreversible — you permanently lose the tail of long messages
- Chunks preserve ALL searchable content in D1, no information loss
- Each chunk stays within D1's comfortable row size
- Future uses: embedding generation, memory distillation can operate per-chunk

```sql
CREATE TABLE message_chunks (
  id TEXT PRIMARY KEY,                  -- UUID
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  ordinal INTEGER NOT NULL,             -- message ordinal (denormalized for search joins)
  chunk_index INTEGER NOT NULL,         -- 0-based chunk position within message

  content TEXT NOT NULL,                -- chunk text (~2000 chars max, split at natural boundaries)

  created_at TEXT DEFAULT (datetime('now')),

  UNIQUE(message_id, chunk_index)
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

### Derived Artifacts Table (Future)

Reserved for attaching computed/derived data to sessions. Not implemented in MVP, but the schema is ready.

```sql
-- FUTURE: not in 001-init.sql, included here for design reference
CREATE TABLE derived_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  kind TEXT NOT NULL,                   -- "summary" | "memory_candidates" | "embeddings_ref" | "distilled_notes"
  content TEXT,                         -- JSON payload (inline for small artifacts)
  storage_key TEXT,                     -- R2 key (for large artifacts like embeddings)

  producer TEXT NOT NULL,               -- what generated this: "pika-v1", "gpt-4o", "user"
  producer_version TEXT,                -- version of the producer

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_derived_session_kind
  ON derived_artifacts(session_id, kind);
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

-- Chunk lookup by message
CREATE INDEX idx_chunks_message
  ON message_chunks(message_id, chunk_index);

-- Chunk lookup by session (for batch delete on re-ingest)
CREATE INDEX idx_chunks_session
  ON message_chunks(session_id);

-- Tag lookups
CREATE INDEX idx_session_tags_session ON session_tags(session_id);
CREATE INDEX idx_session_tags_tag ON session_tags(tag_id);
```

### Full-Text Search (FTS5) on Chunks

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  content='message_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Auto-sync triggers
CREATE TRIGGER chunks_fts_ai AFTER INSERT ON message_chunks BEGIN
  INSERT INTO chunks_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;

CREATE TRIGGER chunks_fts_ad AFTER DELETE ON message_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER chunks_fts_au AFTER UPDATE ON message_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO chunks_fts(rowid, content)
  VALUES (new.rowid, new.content);
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
| Full-text search | `chunks_fts` MATCH + join | FTS5 inverted index |
| Tag filter | Join via `session_tags` | Small join table |
| Idempotency check | `UNIQUE(user_id, session_key)` + `content_hash` | O(1) lookup |

### FTS Search Query (Chunked)

```sql
SELECT mc.session_id, mc.message_id, mc.ordinal, mc.chunk_index,
       snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 64) as snippet,
       s.session_key, s.source, s.project_name, s.title, s.started_at
FROM chunks_fts f
JOIN message_chunks mc ON mc.rowid = f.rowid
JOIN sessions s ON mc.session_id = s.id
WHERE chunks_fts MATCH ?
  AND mc.user_id = ?
  AND s.source IN (?)              -- optional filter
  AND s.last_message_at >= ?       -- optional filter
  AND s.last_message_at <= ?       -- optional filter
ORDER BY rank
LIMIT 50
```

## Ingest Idempotency Protocol

### Write Semantics

Same `user_id + session_key` can be uploaded repeatedly. The server decides what to do:

```
1. Look up existing session by (user_id, session_key)
2. If not found → INSERT (new session)
3. If found:
   a. Compare content_hash
      - Same hash → no-op (return 200, skip D1/R2 writes)
      - Different hash:
        i.  Check parser_version + schema_version
        ii. If new version >= existing → OVERWRITE
            - Delete old message_chunks + messages (cascade)
            - Insert new messages + chunks
            - Update R2 canonical content
            - Archive raw payload to R2 (always, even on overwrite)
            - Update session metadata + content_hash + ingested_at
        iii.If new version < existing → REJECT (return 409)
```

### Worker Upsert SQL

```sql
INSERT INTO sessions (id, user_id, session_key, source, ..., content_hash, parser_version, schema_version, ingested_at)
VALUES (?, ?, ?, ?, ..., ?, ?, ?, datetime('now'))
ON CONFLICT (user_id, session_key) DO UPDATE SET
  source = excluded.source,
  started_at = excluded.started_at,
  last_message_at = excluded.last_message_at,
  -- ... all metadata fields ...
  content_hash = excluded.content_hash,
  parser_version = excluded.parser_version,
  schema_version = excluded.schema_version,
  ingested_at = datetime('now'),
  updated_at = datetime('now')
WHERE excluded.content_hash != sessions.content_hash
  AND excluded.schema_version >= sessions.schema_version;
```

## R2 Storage Layout

```
Bucket: pika-sessions
+-- {user_id}/
    +-- {session_key}/
        +-- canonical.json.gz     # Normalized conversation (for replay)
        +-- raw.json.gz           # Original source payload (immutable archive)
```

### Canonical Object Format (`canonical.json.gz`)

```typescript
interface CanonicalSession {
  sessionKey: string;
  source: Source;
  parserVersion: string;        // e.g., "1.0.0"
  schemaVersion: number;        // e.g., 1
  messages: CanonicalMessage[];
}

interface CanonicalMessage {
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

### Raw Object Format (`raw.json.gz`)

```typescript
interface RawSessionArchive {
  sessionKey: string;
  source: Source;
  parserVersion: string;        // parser that collected this raw data
  collectedAt: string;          // ISO 8601
  sourceFiles: RawSourceFile[]; // one or more source files
}

interface RawSourceFile {
  path: string;                 // original file path (for audit)
  format: "jsonl" | "json" | "sqlite-export";
  content: string;              // raw file content (or JSON-serialized rows)
}
```

**Why keep raw?**
- Parser bugs can be fixed and sessions re-parsed from raw
- Future features (distillation, embedding) need original structure
- Audit trail: what did the source tool actually emit?
- Cost is negligible (~2x storage, R2 is cheap)

## R2 Size Estimates

| Metric | Per Session | 1000 Sessions/mo | 12 Months |
|--------|-------------|-------------------|-----------|
| Canonical (gzip) | 10-100 KB | 10-100 MB | 120 MB-1.2 GB |
| Raw (gzip) | 15-150 KB | 15-150 MB | 180 MB-1.8 GB |
| **Total R2** | 25-250 KB | 25-250 MB | **300 MB-3 GB** |

## D1 Limits & Mitigations

| Limit | Value | Mitigation |
|-------|-------|------------|
| Max row size | 1 MB | Chunks capped at ~2000 chars (~2KB); messages have no content column |
| Max query result | 5 MB | Pagination; session list returns metadata only |
| Max batch size (free) | 50 statements | Batch ingest capped at 50 records per batch |
| Max DB size (free) | 5 GB | See capacity budget below |
| FTS5 index overhead | ~30-50% of text | Applied to chunk content only |

## Capacity Budget (5000 sessions/month)

### Assumptions

| Metric | Value | Rationale |
|--------|-------|-----------|
| Sessions/month | 5,000 | Active individual developer |
| Avg messages/session | 20 | Mix of short chats and long coding sessions |
| Avg chunks/message | 2 | Most messages < 2000 chars; long assistant responses split to 2-4 |
| Avg chunk size | 1 KB | ~1000 chars of text |
| Avg message metadata | 200 B | role, tool_name, tokens, ordinal, timestamp |
| Avg session metadata | 500 B | All session columns |

### Monthly D1 Growth

| Table | Rows/month | Avg row size | Monthly growth |
|-------|-----------|--------------|----------------|
| sessions | 5,000 | 500 B | 2.5 MB |
| messages | 100,000 | 200 B | 20 MB |
| message_chunks | 200,000 | 1 KB | 200 MB |
| chunks_fts (index) | 200,000 | ~500 B | 100 MB |
| **Monthly total** | | | **~322 MB** |

### 12-Month Projection

| Metric | Value |
|--------|-------|
| Total sessions | 60,000 |
| Total messages | 1,200,000 |
| Total chunks | 2,400,000 |
| D1 size (data + FTS) | ~3.9 GB |
| R2 size (canonical + raw) | ~1.5-3 GB |
| **D1 headroom (5GB free)** | **~1.1 GB remaining** |

### Scaling Triggers

| Trigger | Threshold | Action |
|---------|-----------|--------|
| D1 approaching 4 GB | 80% capacity | Upgrade to D1 paid plan (50 GB) |
| FTS query > 500ms | p95 latency | Add user_id prefix to FTS query optimization |
| R2 > 10 GB | Storage cost | Evaluate lifecycle policy for old raw archives |
| Monthly sessions > 10K | 2x assumption | Re-evaluate chunk granularity |

## Migration Strategy

Migrations live in `scripts/migrations/` with numeric prefixes:

```
scripts/migrations/
+-- 001-init.sql              # Auth + sessions + messages + message_chunks + FTS5
+-- 002-tags.sql              # Tags + session_tags
+-- 003-derived-artifacts.sql # Future: derived_artifacts table
+-- ...                       # Incremental additions
```

Applied via `wrangler d1 migrations apply`.
