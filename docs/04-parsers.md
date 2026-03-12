# 04 - Parsers

## Overview

Pika parsers extract **full conversation content** from local coding agent session files. This is fundamentally different from pew's parsers which only extract token deltas.

Each source has:
- A **parser**: reads raw files, emits `ParsedSession` objects
- A **driver**: handles discovery, incremental cursors, and coordinates parsing

## Parsed Data Model

Defined in `packages/core/src/types.ts`:

```typescript
type Source = "claude-code" | "codex" | "gemini-cli" | "opencode" | "vscode-copilot";

interface ParsedSession {
  sessionKey: string;           // "claude:{id}", "codex:{id}", etc.
  source: Source;
  startedAt: string;            // ISO 8601
  lastMessageAt: string;
  durationSeconds: number;
  projectRef: string | null;    // SHA-256 hash (16 hex) for privacy
  projectName: string | null;   // human-readable (from local path)
  model: string | null;         // primary model (last seen)
  title: string | null;         // from source if available
  messages: ParsedMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  snapshotAt: string;           // ISO 8601
}

interface ParsedMessage {
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
| Format | JSONL rollout files |
| Session key | `codex:{payload.id}` or `codex:{sha256(filePath)}` |
| Project ref | SHA-256 hash of `session_meta.payload.cwd` |
| Cursor | Byte-offset + last totals + last model |

**Message extraction**:
- `kind: "session_meta"` -> session metadata (cwd, model)
- `kind: "turn_context"` -> `payload.input_items[]` contains messages
- Input items have `role` and `content` fields
- Tool calls embedded in assistant messages as `tool_call` type items
- Token usage: cumulative `total_token_usage`, requires diffing

### Gemini CLI

**File**: `packages/cli/src/parsers/gemini.ts`

| Field | Value |
|-------|-------|
| Base dir | `~/.gemini` |
| File pattern | `~/.gemini/tmp/*/chats/session-*.json` |
| Format | Single JSON file per session with `messages[]` |
| Session key | `gemini:{sessionId}` or `gemini:{sha256(filePath)}` |
| Project ref | SHA-256 hash of `session.projectHash` |
| Cursor | Array index + last totals + last model |

**Message extraction**:
- `messages[]` array, each with `role` and `parts[]`
- Parts: `{text: "..."}` for content
- Tool calls in `functionCall` parts, results in `functionResponse` parts
- Token usage: cumulative `tokens` object, requires diffing

### OpenCode

**File**: `packages/cli/src/parsers/opencode.ts`

| Field | Value |
|-------|-------|
| Message dir | `~/.local/share/opencode/storage/message` |
| DB path | `~/.local/share/opencode/opencode.db` |
| File pattern | `ses_*/msg_*.json` (per-message JSON files) |
| Session key | `opencode:{sessionID}` |
| Project ref | SHA-256 hash of `session.project_id` (SQLite only) |
| Cursor | Dir mtime optimization + file-level triple-check |

**Dual parsing strategy** (same as pew):
1. **JSON files**: One file per message in session directories (`ses_xxx/`)
   - Dir-level mtime check to skip unchanged session dirs
   - `data.content`, `data.role` fields
2. **SQLite DB**: `session` + `message` tables
   - Watermark-based cursor (`lastTimeCreated`)
   - `data` field is a JSON blob in `message` table
   - Cross-source dedup to avoid double-counting

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
