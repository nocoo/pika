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

**File**: `packages/cli/src/parsers/opencode.ts`

| Field | Value |
|-------|-------|
| Session dir | `~/.local/share/opencode/storage/session/{projectID}/ses_*.json` |
| Message dir | `~/.local/share/opencode/storage/message/ses_*/msg_*.json` |
| Part dir | `~/.local/share/opencode/storage/part/msg_*/prt_*.json` |
| DB path | `~/.local/share/opencode/opencode.db` |
| Session key | `opencode:{sessionID}` |
| Project ref | SHA-256 hash of `session.projectID` |
| Project name | `session.directory` (full path) |
| Cursor | Dir mtime optimization + file-level triple-check |

**Three-layer data model:**
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
1. **JSON files**: Three-dir reads (session + message + part per message)
   - Dir-level mtime check to skip unchanged session dirs
   - Messages sorted by `time.created`
2. **SQLite DB**: `session` + `message` + `part` tables
   - `message.data` and `part.data` are JSON blobs
   - Watermark-based cursor (`lastTimeCreated`)
   - Cross-source dedup via `SyncContext.messageKeys`

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

```
packages/cli/src/drivers/
+-- registry.ts         # Factory: construct active drivers from detected sources
+-- types.ts            # Driver interfaces
+-- session/            # Per-source session drivers
    +-- claude.ts
    +-- codex.ts
    +-- gemini.ts
    +-- opencode.ts
    +-- opencode-sqlite.ts
    +-- vscode-copilot.ts
```

### Driver Interface

```typescript
// Parse result contains both canonical and raw layers
interface ParseResult {
  canonical: CanonicalSession;
  raw: RawSessionArchive;
}

// File-based driver
interface FileDriver {
  source: Source;
  discover(): Promise<string[]>;
  shouldSkip(cursor: FileCursor, fp: Fingerprint): boolean;
  resumeState(cursor: FileCursor, fp: Fingerprint): ResumeState;
  parse(filePath: string, resume: ResumeState): Promise<ParseResult>;
  buildCursor(fp: Fingerprint, result: ParseResult): FileCursor;
}

// DB-based driver (OpenCode SQLite)
interface DbDriver {
  source: Source;
  run(prevCursor: DbCursor, ctx: DriverContext): Promise<DbResult>;
}
```

### Incremental Sync

| Source | Mechanism | Change Detection |
|--------|-----------|-----------------|
| Claude Code | Byte-offset JSONL | inode + mtime + size |
| Codex CLI | Byte-offset + cumulative diff | inode + mtime + size |
| Gemini CLI | Array-index JSON | inode + mtime + size |
| OpenCode (JSON) | Dir mtime + file triple-check | Two-level optimization |
| OpenCode (SQLite) | Watermark (`lastTimeCreated`) | inode check |
| VSCode Copilot | Byte-offset + CRDT state | inode + mtime + size |

### File Change Detection

Triple-check in `packages/cli/src/utils/file-changed.ts`:

A file is **unchanged** only when ALL THREE match:
1. **inode** -- detects file rotation/replacement
2. **mtimeMs** -- detects writes since last scan
3. **size** -- catches in-place overwrites with same mtime

### Discovery Paths

Resolved in `packages/cli/src/utils/paths.ts` (platform-aware):

| Source | macOS Path |
|--------|-----------|
| Claude Code | `~/.claude/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Gemini CLI | `~/.gemini/tmp/*/chats/` |
| OpenCode | `~/.local/share/opencode/` |
| VSCode Copilot | `~/Library/Application Support/Code/User/` |

The driver registry (`registry.ts`) only activates drivers for sources that exist on disk.
