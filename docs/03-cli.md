# 03 - CLI

## Overview

The `pika` CLI parses local coding agent session files, extracts full conversation content, and uploads them to the Pika cloud service.

**npm package**: `@nocoo/pika`
**Binary**: `pika`
**Framework**: `citty` (UnJS)

## Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `pika sync` | Parse local sessions and upload | `--upload` (default: true), `--dev` |
| `pika login` | Connect CLI to dashboard via browser OAuth | `--force`, `--dev` |
| `pika status` | Show sync status and session stats | -- |

**Supported sources**: `claude-code`, `codex`, `gemini-cli`, `opencode` (SQLite primary + JSON fallback), `vscode-copilot`

## CLI Source Layout

```
packages/cli/src/
├── bin.ts                      # Entry: runMain(main)
├── cli.ts                      # Command definitions (citty defineCommand)
├── commands/
│   ├── sync.ts                 # Orchestrates parse + upload
│   ├── login.ts                # Browser OAuth flow
│   └── status.ts               # Display sync status
├── upload/
│   ├── engine.ts               # Generic batch upload with retry
│   └── content.ts              # R2 content upload (gzip)
├── parsers/                    # Per-source session parsers (see 04-parsers.md)
├── drivers/                    # Discovery + incremental cursor (see 04-parsers.md)
│   ├── registry.ts             # Constructs active drivers from detected sources
│   └── types.ts                # Driver interfaces
├── storage/
│   └── cursor-store.ts         # Persist per-file sync cursors
├── config/
│   └── manager.ts              # Read/write ~/.config/pika/
└── utils/
    ├── paths.ts                # Default source paths (platform-aware)
    └── file-changed.ts         # inode + mtime + size triple-check
```

## Login Flow

Identical pattern to pew, adapted for pika's API:

```
1. Check ~/.config/pika/config.json for existing token
2. Start http.createServer() on port 0 (OS picks random)
3. Open browser: {apiUrl}/api/auth/cli?callback=http://127.0.0.1:{port}/callback
4. Server authenticates user (Google OAuth via NextAuth)
5. Server generates api_key: "pk_" + crypto.getRandomValues(32 hex)
6. Redirects to: http://127.0.0.1:{port}/callback?api_key={key}&email={email}
7. CLI saves api_key to config.json, displays success
8. Timeout: 120 seconds
```

## Sync Pipeline

```
pika sync
  │
  ├── 1. File Drivers: discover + incremental parse
  │     ├── For each file-based source (Claude, Codex, Gemini, OpenCode JSON, VSCode Copilot):
  │     │   ├── Discover candidate files on disk
  │     │   ├── Check cursor (inode + mtime + size)
  │     │   ├── Skip unchanged files
  │     │   ├── Resume from cursor position
  │     │   └── Collect ParseResult[] (CanonicalSession + RawSessionArchive)
  │     └── Track sessionKey→filePath for cursor rollback
  │
  ├── 2. DB Drivers: query + full canonical parse
  │     ├── OpenCode SQLite (primary OpenCode path, highest local volume):
  │     │   ├── Check DB inode (reset watermark if DB replaced)
  │     │   ├── Watermark-filtered change detection (new messages since last sync)
  │     │   ├── Full canonical build (ALL messages, not just new ones)
  │     │   ├── Faithful raw: per-row RawSourceFile from original DB data
  │     │   └── Cross-source dedup via SyncContext (skip if JSON already has newer data)
  │     └── Track DB-sourced session keys for cursor rollback
  │
  ├── 3. Upload Metadata (all results, file + DB, mixed together)
  │     ├── Transform to SessionSnapshot[] (content_hash + raw_hash via SHA-256)
  │     ├── Batch: 50 records per POST
  │     ├── POST /api/ingest/sessions
  │     ├── Auth: Authorization: Bearer pk_...
  │     └── Retry: 5xx → 2 retries (1s, 2s backoff); 429 → Retry-After
  │
  ├── 4. Upload Content (versioned idempotent, per-session)
  │     ├── Canonical: PUT /api/ingest/content/{session_key}/canonical
  │     │   Headers: Content-Encoding: gzip, X-Content-Hash, X-Parser-Revision, X-Schema-Version
  │     ├── Raw: presigned PUT directly to R2 (bypasses API double-hop)
  │     │   Fallback: PUT /api/ingest/content/{session_key}/raw via proxy
  │     │   R2 key: {user_id}/{session_key}/raw/{raw_hash}.json.gz (content-addressed, immutable)
  │     └── Server decides:
  │           both hashes match → no-op,
  │           content differs + newer revision → overwrite canonical + append raw,
  │           only raw differs → append raw archive only,
  │           older revision → 409 reject
  │
  └── 5. Cursor Rollback + Save
        ├── On content upload failure for file-sourced sessions:
        │   rollback file cursor to previous value
        ├── On content upload failure for DB-sourced sessions:
        │   rollback openCodeSqlite cursor to previous value
        └── Save cursor state AFTER successful upload
```

## Local State Files

All stored under `~/.config/pika/`:

| File | Purpose |
|------|---------|
| `config.json` | API key + device UUID |
| `config.dev.json` | Dev environment config |
| `cursors.json` | Per-file byte offsets, dir mtimes, SQLite cursors |

### Config Format

```typescript
interface PikaConfig {
  token?: string;     // "pk_" + 32 hex chars
  deviceId?: string;  // UUID v4, generated once per install
}
```

## Upload Engine Design

Reusable across metadata and content uploads:

```typescript
// packages/cli/src/upload/engine.ts

interface UploadEngineOptions {
  apiUrl: string;
  apiKey: string;
  userId: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

// Retry logic:
// - 5xx: retry with exponential backoff (1s, 2s)
// - 429: respect Retry-After header
// - 4xx (except 429): fail immediately
// - 401: error message about re-login
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Not logged in | `consola.error("Not logged in. Run: pika login")` |
| No sources found | `consola.info("No AI tool sessions found")` |
| Network error | Retry with backoff, then fail gracefully |
| Corrupted JSONL line / parse error | Collected in memory, `consola.warn` summary at sync end |
| API auth failure (401) | `consola.error("API key invalid. Run: pika login --force")` |
| Partial upload failure | Cursor NOT advanced; retry on next sync |

### Parse Errors

Parse errors are **never silently dropped**. For an archival product, silent data loss is unacceptable — users must know when sessions are incomplete.

Each error conforms to:
```typescript
interface ParseError {
  timestamp: string;          // ISO 8601
  source: Source;             // which parser
  filePath: string;           // source file that failed
  line?: number;              // line number (for JSONL parsers)
  error: string;              // error message
  sessionKey?: string;        // if known at time of failure
}
```

**Visibility**:
- `pika sync` collects errors in memory and prints `consola.warn("N parse errors in this run")` at the end
- `pika status` shows error summary (if parse error log exists)
- Errors do NOT block the sync pipeline — other sessions continue to parse and upload normally
