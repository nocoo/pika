# 04 - Parsers

## Overview

Pika parsers extract **full conversation content** from local coding agent session files. This is fundamentally different from pew's parsers which only extract token deltas.

Each source has:
- A **parser**: reads raw files, emits `CanonicalSession` + `RawSessionArchive` objects
- A **driver**: handles discovery, incremental cursors, and coordinates parsing
- **Error handling**: parse failures are logged to `~/.config/pika/parse-errors.jsonl` (never silently dropped). See [03-cli.md](./03-cli.md#parse-error-queue) for details.

## Canonical Data Model

Defined in `packages/core/src/types.ts`:

```typescript
type Source = "claude-code" | "codex" | "gemini-cli" | "opencode" | "vscode-copilot";

interface CanonicalSession {
  sessionKey: string;           // "claude:{id}", "codex:{id}", etc.
  source: Source;
  parserRevision: number;       // monotonic integer, e.g., 1, 2, 3
  schemaVersion: number;        // e.g., 1
  startedAt: string;            // ISO 8601
  lastMessageAt: string;
  durationSeconds: number;
  projectRef: string | null;    // SHA-256 hash (16 hex) for privacy
  projectName: string | null;   // human-readable (from local path)
  model: string | null;         // primary model (last seen)
  title: string | null;         // from source if available
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  snapshotAt: string;           // ISO 8601
}

interface CanonicalMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;              // full content (not truncated)
  toolName?: string;            // "Read", "Edit", "Bash", etc.
  toolInput?: string;           // stringified summary of tool input
  toolResult?: string;          // stringified summary of tool result
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  timestamp: string;            // ISO 8601
}
```

## Raw Data Model

Each parser also produces a `RawSessionArchive` that preserves the original source payloads verbatim:

```typescript
interface RawSessionArchive {
  sessionKey: string;
  source: Source;
  parserRevision: number;       // parser revision that collected this raw data
  collectedAt: string;          // ISO 8601
  sourceFiles: RawSourceFile[]; // one or more source files
}

interface RawSourceFile {
  path: string;                 // original file path (for audit)
  format: "jsonl" | "json" | "sqlite-export";
  content: string;              // raw file content (or JSON-serialized rows)
}
```

## Dual-Layer Parser Output

Each parser emits **two outputs** per session:

1. **Canonical output** (`CanonicalSession`): Normalized conversation for display, search, and replay. All source-specific formats are mapped into a uniform structure.
2. **Raw output** (`RawSessionArchive`): Original source payloads preserved verbatim. Enables future re-parsing when parser logic improves, and serves as an audit trail.

This dual-layer approach means parser bugs can be fixed and sessions re-parsed from raw archives without asking users to re-upload. Raw archives use content-addressed R2 paths (`raw/{raw_hash}.json.gz`), so each unique raw payload is truly immutable — re-ingest writes a new key rather than overwriting. The canonical layer is overwritten on re-ingest to reflect the latest parser output.

## Source Parsers

### Claude Code

**File**: `packages/cli/src/parsers/claude.ts`

| Field | Value |
|-------|-------|
| Base dir | `~/.claude` |
| File pattern | `~/.claude/projects/**/*.jsonl` |
| Format | JSONL, one line per event |
| Session key | `claude:{sessionId}` (from `sessionId` field) |
| Project ref | SHA-256 hash of dir name under `projects/` |
| Cursor | Byte-offset per file (inode + mtime + size) |

**Message extraction**:
- Filter for `type: "human"` and `type: "assistant"` entries
- `message.content` may be a string or array of content blocks
- Content blocks: `{type: "text", text: "..."}`, `{type: "tool_use", name: "...", input: {...}}`
- Tool results: `{type: "tool_result", content: "..."}`
- Token usage: `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`

### Codex CLI

**File**: `packages/cli/src/parsers/codex.ts`

| Field | Value |
|-------|-------|
| Base dir | `~/.codex/sessions` |
| File pattern | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Format | JSONL rollout files (one session per file) |
| Session key | `codex:{payload.id}` from session_meta, or `codex:{uuid-from-filename}` |
| Project ref | SHA-256 hash of `session_meta.payload.cwd` |
| Cursor | Byte-offset + last totals + last model |

**Message extraction** (top-level `type` field, NOT `kind`):
- `type: "session_meta"` → session metadata (`payload.id`, `payload.cwd`, `payload.timestamp`)
- `type: "turn_context"` → per-turn context (`payload.model`, `payload.cwd`)
- `type: "event_msg"` → UI events (subtypes via `payload.type`):
  - `user_message` → `payload.message` (user input text)
  - `agent_message` → `payload.message` (final assistant output text)
  - `agent_reasoning` → thinking (skipped for content)
  - `token_count` → `payload.info.total_token_usage` (cumulative totals, last event wins)
- `type: "response_item"` → API response items (subtypes via `payload.type`):
  - `message` → role-based messages (`user`/`assistant`/`developer`); developer messages skipped
  - `function_call` → `payload.name`, `payload.arguments`, `payload.call_id`
  - `function_call_output` → `payload.call_id`, `payload.output`
  - `reasoning` → encrypted thinking (skipped)

### Gemini CLI

**File**: `packages/cli/src/parsers/gemini.ts`

| Field | Value |
|-------|-------|
| Base dir | `~/.gemini` |
| File pattern | `~/.gemini/tmp/*/chats/session-*.json` |
| Format | Single JSON file per session |
| Session key | `gemini:{sessionId}` |
| Project ref | SHA-256 hash of `projectHash` (already a hash in source) |
| Cursor | Array index + last totals + last model |

**File structure** (top-level JSON object):
- `sessionId`: UUID string
- `projectHash`: SHA-256 hash string (Gemini CLI's project identifier)
- `startTime`: ISO 8601 timestamp
- `lastUpdated`: ISO 8601 timestamp
- `messages[]`: array of message objects

**Message extraction** (discriminated by `type` field):
- `type: "user"` → `content: [{text: "..."}]` (array of objects with `text` field)
- `type: "gemini"` → `content: "..."` (plain string), `model`, `tokens`, `toolCalls[]`, `thoughts[]`
- `type: "info"` → system info messages (login prompts, etc.) — skipped

**Token usage**: per-message on gemini messages, summed across all turns
- `tokens: { input, output, cached, thoughts, tool, total }`

**Tool calls**: embedded in gemini messages as `toolCalls[]`:
- `{ name, displayName, status, args: {}, result: [{functionResponse: {id, name, response: {output: "..."}}}], id, timestamp }`

**Thoughts**: `[{ subject, description, timestamp }]` — skipped for conversation content

### OpenCode

**Files**: `packages/cli/src/parsers/opencode.ts`, `packages/cli/src/drivers/session/opencode-sqlite.ts`, `packages/cli/src/drivers/session/opencode.ts`

OpenCode has the highest local usage volume among all sources. It supports two data paths, with **SQLite as the primary (preferred) path** and JSON files as a fallback:

| Path | Driver | Parser | Priority |
|------|--------|--------|----------|
| **SQLite DB** (primary) | `opencode-sqlite.ts` (DbDriver) | `parseOpenCodeSqliteSession()` | Runs second; authoritative when data overlaps with JSON |
| JSON files (fallback) | `opencode.ts` (FileDriver) | `parseOpenCodeJsonSession()` | Runs first; used when DB is unavailable |

#### Why SQLite is the primary path

1. **Atomic reads**: SQLite provides transactional consistency across session/message/part tables — JSON files can be partially written
2. **Single-file source**: One DB file vs. thousands of JSON files across three directory trees
3. **Efficient change detection**: Watermark-based cursor on `time_created` column vs. stat-ing every file
4. **Faithful raw preservation**: Each DB row's `data` column is captured as an individual `RawSourceFile` with virtual paths (`{dbPath}#session/{id}`, `{dbPath}#message/{id}`, `{dbPath}#part/{msgId}/{index}`)
5. **Full canonical snapshots**: Change detection uses watermark-filtered queries, but canonical output always queries ALL messages to produce complete snapshots (never partial fragments)

#### SQLite path (primary)

| Field | Value |
|-------|-------|
| DB path | `~/.local/share/opencode/opencode.db` |
| Tables | `session`, `message`, `part` — each with `data` JSON blob column |
| Session key | `opencode:{sessionID}` |
| Project ref | SHA-256 hash of `session.projectID` |
| Cursor | `OpenCodeSqliteCursor`: inode + `lastTimeCreated` watermark + `lastMessageIds` boundary dedup |

**Sync cycle**:
1. **DB existence check** — stat the DB file; if missing, return empty
2. **Inode check** — if inode changed (DB replaced), reset watermark to scan from scratch
3. **For each session in DB**:
   a. **Change detection**: watermark-filtered query (`time_created >= ?`) with `lastMessageIds` dedup to find new messages
   b. **Skip if no new messages** since watermark
   c. **Full canonical build**: query ALL messages (no watermark, no dedup) to produce a complete snapshot
   d. **Raw fidelity**: query each row's `data` column as-is, build per-row `RawSourceFile` entries
   e. **Cross-source dedup**: if JSON driver already produced equal-or-newer data, skip
4. **Watermark advance**: track max `time_created` from new messages; collect boundary message IDs for next-run dedup

**Cross-source dedup**:
- JSON driver runs first and deposits `{ lastMessageAt, totalMessages }` per session into `SyncContext.openCodeSessionState`
- SQLite driver reads this state: skip if JSON `lastMessageAt >= sqlite` AND JSON `totalMessages >= sqlite`
- If SQLite has newer data (which is the common case), the SQLite version wins

**Cursor rollback on upload failure**:
- If content upload fails for any DB-sourced session, `cursorState.openCodeSqlite` is rolled back to `prevDbCursor`
- Next sync will re-query and re-process those sessions

#### JSON path (fallback)

| Field | Value |
|-------|-------|
| Session dir | `~/.local/share/opencode/storage/session/{projectID}/ses_*.json` |
| Message dir | `~/.local/share/opencode/storage/message/ses_*/msg_*.json` |
| Part dir | `~/.local/share/opencode/storage/part/msg_*/prt_*.json` |
| Session key | `opencode:{sessionID}` |
| Cursor | File-level triple-check (inode + mtime + size) + message dir mtime tracking |

**Three-layer data model** (same structure as SQLite `data` column contents):
- **Session JSON**: Metadata only (`id`, `projectID`, `directory`, `title`, `time.created/updated`)
- **Message JSON**: Metadata only (`id`, `sessionID`, `role`, `time`, `modelID`, `tokens`)
  - Tokens per assistant message: `{input, output, reasoning, cache: {read, write}}`
- **Part JSON**: Actual content, discriminated by `type` field:
  - `"text"`: Text content (`text` field). `synthetic: true` → system prompt (skipped)
  - `"tool"`: Tool invocation. `state.status`: `"completed"` or `"running"`.
    Input: `state.input`, Output: `state.output` or `state.metadata.output`
  - `"reasoning"`: Chain-of-thought (skipped)
  - `"step-start"` / `"step-finish"`: Step boundaries (skipped)
  - `"patch"`: File patches (skipped)
  - `"file"`: Embedded files/images (skipped)
  - `"compaction"`: Context compaction markers (skipped)

**Dual parsing strategy:**

Both paths produce the same canonical and raw formats. The SQLite path is preferred (see above). When both produce data for the same session, cross-source dedup ensures only the more complete version is uploaded. In practice, the SQLite DB is always present when OpenCode has been used, so the JSON path primarily serves as a redundancy mechanism.

### VSCode Copilot

**File**: `packages/cli/src/parsers/vscode-copilot.ts`

| Field | Value |
|-------|-------|
| Base dirs | `~/Library/Application Support/Code/User` (+ Insiders) |
| File patterns | `workspaceStorage/*/chatSessions/*.jsonl` + `globalStorage/emptyWindowChatSessions/*.jsonl` |
| Format | CRDT-style append-only JSONL |
| Session key | `copilot:{sessionId}` |
| Cursor | Byte-offset + request metadata mapping + processed indices |

**CRDT reconstruction**:
- `kind=0` (Snapshot): Full session state
- `kind=1` (Set): Overwrite value at JSON path
- `kind=2` (Append): Append to array
- Most complex parser due to deferred result correlation

## Driver Architecture

The pipeline supports two driver kinds with **equal status** in the sync pipeline:

- **FileDriver**: For sources stored as flat files (JSONL, JSON). The pipeline orchestrates: discover → stat → shouldSkip → resumeState → parse → buildCursor.
- **DbDriver**: For sources stored in databases. The driver manages its own DB lifecycle, cursor, and dedup. Currently used by OpenCode SQLite — the highest-volume local source.

Both driver kinds produce the same `ParseResult` (canonical + raw), go through the same upload pipeline, and have the same cursor rollback guarantees on upload failure.

```
packages/cli/src/drivers/
+-- registry.ts             # Factory: construct active drivers from detected sources
+-- types.ts                # FileDriver + DbDriver interfaces (equal status)
+-- session/
    +-- claude.ts            # FileDriver
    +-- codex.ts             # FileDriver
    +-- gemini.ts            # FileDriver
    +-- opencode.ts          # FileDriver (JSON fallback)
    +-- opencode-sqlite.ts   # DbDriver (primary OpenCode path)
    +-- vscode-copilot.ts    # FileDriver
```

### Driver Interfaces

```typescript
// Both drivers produce the same output
interface ParseResult {
  canonical: CanonicalSession;
  raw: RawSessionArchive;
}

// File-based driver — for JSONL/JSON sources
interface FileDriver {
  source: Source;
  discover(): Promise<string[]>;
  shouldSkip(cursor: FileCursor, fp: Fingerprint): boolean;
  resumeState(cursor: FileCursor, fp: Fingerprint): ResumeState;
  parse(filePath: string, resume: ResumeState): Promise<ParseResult[]>;
  buildCursor(fp: Fingerprint, results: ParseResult[]): FileCursor;
}

// DB-based driver — for database sources (OpenCode SQLite)
// Equal citizen: same upload path, same cursor rollback guarantees
interface DbDriver<TCursor> {
  source: Source;
  run(prevCursor: TCursor | undefined, ctx: SyncContext): Promise<DbDriverResult<TCursor>>;
}

interface DbDriverResult<TCursor> {
  results: ParseResult[];
  cursor: TCursor;
  rowCount: number;
}
```

### Pipeline Execution Order

```
1. File drivers (sequential, each discovers + parses its files)
   └─ OpenCode JSON runs here, deposits session state into SyncContext
2. DB drivers (after all file drivers)
   └─ OpenCode SQLite reads SyncContext for cross-source dedup
3. Upload metadata (batch POST, all results mixed)
4. Upload content (per-session PUT, all results mixed)
5. Cursor rollback on failure (both file cursors AND DB cursors)
```

### Incremental Sync

| Source | Driver Kind | Mechanism | Change Detection |
|--------|------------|-----------|-----------------|
| **OpenCode (SQLite)** | **DbDriver** | **Watermark (`lastTimeCreated`) + boundary dedup** | **DB inode; full canonical on any change** |
| Claude Code | FileDriver | Byte-offset JSONL | inode + mtime + size |
| Codex CLI | FileDriver | Byte-offset + cumulative diff | inode + mtime + size |
| Gemini CLI | FileDriver | Array-index JSON | inode + mtime + size |
| OpenCode (JSON) | FileDriver | File triple-check + msg dir mtime | inode + mtime + size |
| VSCode Copilot | FileDriver | Byte-offset + CRDT state | inode + mtime + size |

### File Change Detection

Triple-check in `packages/cli/src/utils/file-changed.ts`:

A file is **unchanged** only when ALL THREE match:
1. **inode** -- detects file rotation/replacement
2. **mtimeMs** -- detects writes since last scan
3. **size** -- catches in-place overwrites with same mtime

### Discovery Paths

Resolved in `packages/cli/src/utils/paths.ts` (platform-aware):

| Source | macOS Path | Driver Kind |
|--------|-----------|-------------|
| **OpenCode (SQLite)** | `~/.local/share/opencode/opencode.db` | DbDriver |
| Claude Code | `~/.claude/projects/` | FileDriver |
| Codex CLI | `~/.codex/sessions/` | FileDriver |
| Gemini CLI | `~/.gemini/tmp/*/chats/` | FileDriver |
| OpenCode (JSON) | `~/.local/share/opencode/storage/` | FileDriver |
| VSCode Copilot | `~/Library/Application Support/Code/User/` | FileDriver |

The driver registry (`registry.ts`) only activates drivers for sources that exist on disk. For OpenCode, both drivers activate independently — the SQLite driver when the DB file exists, the JSON driver when the storage directories exist.
