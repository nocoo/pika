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

**Supported sources**: `claude-code`, `codex`, `gemini-cli`, `opencode`, `vscode-copilot`

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
│   ├── cursor-store.ts         # Persist per-file sync cursors
│   └── upload-queue.ts         # JSONL append-only queue
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
3. Open browser: {apiUrl}/api/auth/cli?callback=http://localhost:{port}/callback
4. Server authenticates user (Google OAuth via NextAuth)
5. Server generates api_key: "pk_" + crypto.getRandomValues(32 hex)
6. Redirects to: http://localhost:{port}/callback?api_key={key}&email={email}
7. CLI saves api_key to config.json, displays success
8. Timeout: 120 seconds
```

## Sync Pipeline

```
pika sync
  │
  ├── 1. Discovery: find source files on disk
  │     (recursive walk of known directories)
  │
  ├── 2. Incremental Parse: for each source
  │     ├── Check cursor (inode + mtime + size)
  │     ├── Skip unchanged files
  │     ├── Resume from cursor position
  │     └── Emit CanonicalSession[] + RawSessionArchive[]
  │
  ├── 3. Split: for each session
  │     ├── SessionMetadata (~1KB) → meta-queue.jsonl
  │     ├── CanonicalContent (gzip) → content-queue/{session_key}/canonical.json.gz
  │     └── RawContent (gzip) → content-queue/{session_key}/raw.json.gz
  │
  ├── 4. Upload Metadata
  │     ├── Read from meta-queue.jsonl (byte-offset tracking)
  │     ├── Batch: 50 records per POST
  │     ├── POST /api/ingest/sessions
  │     ├── Payload includes: content_hash, raw_hash, parser_revision, schema_version
  │     ├── Auth: Authorization: Bearer pk_...
  │     └── Retry: 5xx → 2 retries (1s, 2s backoff); 429 → Retry-After
  │
  ├── 5. Upload Content (versioned idempotent)
  │     ├── For each pending session directory
  │     ├── Compute content_hash: SHA-256 of uncompressed canonical JSON
  │     ├── Compute raw_hash: SHA-256 of uncompressed raw JSON
  │     ├── PUT /api/ingest/content/{session_key}/canonical
  │     │   Headers: Content-Encoding: gzip, X-Content-Hash, X-Parser-Revision, X-Schema-Version
  │     ├── PUT /api/ingest/content/{session_key}/raw
  │     │   Headers: Content-Encoding: gzip, X-Raw-Hash
  │     │   R2 key: {user_id}/{session_key}/raw/{raw_hash}.json.gz (content-addressed, immutable)
  │     └── Server decides:
  │           both hashes match → no-op,
  │           content differs + newer revision → overwrite canonical + append raw,
  │           only raw differs → append raw archive only,
  │           older revision → 409 reject
  │
  └── 6. Update Cursors
        └── Save cursor state AFTER successful upload
```

## Local State Files

All stored under `~/.config/pika/`:

| File | Purpose |
|------|---------|
| `config.json` | API key + device UUID |
| `config.dev.json` | Dev environment config |
| `cursors.json` | Per-file byte offsets, dir mtimes, SQLite cursors |
| `meta-queue.jsonl` | Pending session metadata uploads |
| `meta-queue.state.json` | Metadata upload byte offset |
| `content-queue/` | Pending gzip content files (canonical.json.gz + raw.json.gz per session) |
| `content-queue.state.json` | Content upload tracking |
| `parse-errors.jsonl` | Parse error log (file path, line, error message, timestamp) |

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
// packages/cli/src/commands/upload-engine.ts

interface UploadEngineOptions {
  apiUrl: string;
  apiKey: string;
  endpoint: string;            // e.g., "/api/ingest/sessions"
  batchSize: number;           // 50 for metadata
  maxRetries: number;          // 2
  initialBackoffMs: number;    // 1000
}

// Retry logic:
// - 5xx: retry with exponential backoff (1s, 2s)
// - 429: respect Retry-After header
// - 4xx: fail immediately
// - Save offset only after ALL batches succeed
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Not logged in | `consola.error("Not logged in. Run: pika login")` |
| No sources found | `consola.info("No AI tool sessions found")` |
| Network error | Retry with backoff, then fail gracefully |
| Corrupted JSONL line / parse error | Log to `~/.config/pika/parse-errors.jsonl`, `consola.warn` at sync end |
| API auth failure (401) | `consola.error("API key invalid. Run: pika login --force")` |
| Partial upload failure | Cursor NOT advanced; retry on next sync |

### Parse Error Queue

Parse errors are **never silently dropped**. For an archival product, silent data loss is unacceptable — users must know when sessions are incomplete.

```
~/.config/pika/parse-errors.jsonl
```

Each line is a JSON object:
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
- `pika sync` prints `consola.warn("N parse errors in this run")` at the end if any errors occurred
- `pika status` shows total error count and the last 5 errors
- Errors do NOT block the sync pipeline — other sessions continue to parse and upload normally
- Error file is rotated when it exceeds 1MB (old errors archived to `parse-errors.1.jsonl`)
