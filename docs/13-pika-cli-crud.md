# 13. Pika CLI CRUD Implementation

> Design document for implementing read/update/delete operations in Pika CLI.

## Overview

This document describes how Pika CLI will leverage the enhanced `@nocoo/cli-base` to provide full CRUD operations on sessions, projects, tags, and search functionality.

## Goals

1. **AI-Friendly Interface** — Output formats optimized for AI agent consumption (full response envelopes in json mode)
2. **Progressive Disclosure** — Minimize token usage with layered detail levels
3. **Consistent Patterns** — All resources follow the same command structure
4. **Independent Testability** — Each command handler returns a result object; exit codes set by wrapper

## Command Structure

```
pika
├── sync              # (existing) Upload local sessions
├── login             # (existing) Authenticate via browser
├── status            # (existing) Show sync status
├── update            # (existing) Update CLI
├── sessions          # NEW: Session management
│   ├── list          # List sessions with filters
│   ├── get           # Get session details
│   ├── content       # Get session content (messages)
│   ├── trash         # Soft-delete or restore a session
│   └── star          # Star/unstar a session
├── projects          # NEW: Project browsing
│   └── list          # List projects with stats
├── search            # NEW: Full-text search
└── tags              # NEW: Tag management
    ├── list          # List all tags
    ├── create        # Create a new tag
    ├── add           # Add tag to session
    └── remove        # Remove tag from session
```

## Progressive Disclosure Strategy

### Level 1: Minimal (for AI batch processing)

```bash
$ pika sessions list --format=minimal --limit=100
sess_abc123
sess_def456
sess_ghi789
...
```

**Use case**: AI agent collecting session IDs for batch operations.

### Level 2: Summary (default for humans)

```bash
$ pika sessions list
┌──────────────┬─────────────────────────┬─────────────┬──────┬───────────┐
│ ID           │ Title                   │ Source      │ Msgs │ Date      │
├──────────────┼─────────────────────────┼─────────────┼──────┼───────────┤
│ sess_abc123  │ Fix login bug           │ claude-code │   42 │ 2h ago    │
│ sess_def456  │ Add search feature      │ codex       │   18 │ yesterday │
│ sess_ghi789  │ Refactor API client     │ claude-code │   67 │ 3d ago    │
└──────────────┴─────────────────────────┴─────────────┴──────┴───────────┘
More results available. Use --cursor <token> to continue.
```

### Level 3: Detail (single item)

```bash
$ pika sessions get sess_abc123 --format=json
{
  "id": "sess_abc123",
  "session_key": "claude-code/project-abc/1712567890",
  "title": "Fix login bug",
  "source": "claude-code",
  "project_ref": "/path/to/project",
  "project_name": "pika",
  "started_at": "2026-04-08T10:30:00Z",
  "last_message_at": "2026-04-08T11:45:00Z",
  "total_messages": 42,
  "user_messages": 15,
  "assistant_messages": 27,
  "total_input_tokens": 15234,
  "total_output_tokens": 8976,
  "total_cached_tokens": 2341,
  "duration_seconds": 4500,
  "is_starred": false,
  "deleted_at": null
}
```

**Note**: Content is NOT included by default — use `pika sessions content <id>`.

### Level 4: Full Content (separate command)

```bash
$ pika sessions content sess_abc123
{
  "messages": [
    { "role": "user", "content": "I need to fix the login bug..." },
    { "role": "assistant", "content": "Let me analyze the issue..." }
  ]
}
```

## Command Specifications

### sessions list

```bash
pika sessions list [options]

Options:
  --limit <n>         Max results (default: 50, max: 100)
  --cursor <string>   Cursor for keyset pagination (from previous response)
  --page <n>          Page number (alternative to cursor)
  --project <key>     Filter by project name/key
  --source <name>     Filter by source (claude-code, codex, etc.)
  --starred           Show only starred sessions
  --deleted           Show only deleted sessions (trash)
  --from <date>       Filter by last_message_at >= date (ISO 8601)
  --to <date>         Filter by last_message_at <= date (ISO 8601)
  --sort <field>      Sort by: last_message_at, started_at, total_messages, duration_seconds
  --format <fmt>      Output: json, table, minimal, auto (default: auto)
```

**API**: `GET /sessions`

**Response shape**:
```typescript
{
  sessions: SessionRow[];
  cursor: string | null;     // for keyset pagination
  hasMore: boolean;
  // Only with page param:
  totalCount?: number;
  page?: number;
  pageSize?: number;
}
```

### sessions get

```bash
pika sessions get <id> [options]

Options:
  --format <fmt>      Output: json, table, auto (default: auto)
```

**API**: `GET /sessions/:id`

**Response**: Full session metadata (no content).

### sessions content

```bash
pika sessions content <id> [options]

Options:
  --format <fmt>      Output: json (default)
```

**API**: `GET /sessions/:id/content`

**Response**: Raw conversation content from R2, decompressed.

### sessions trash

```bash
pika sessions trash <id> [options]

Options:
  --restore    Restore a deleted session instead of deleting
```

**API**: `PATCH /sessions/:id/trash`

**Request body**: `{ "deleted": true }` or `{ "deleted": false }` for restore.

### sessions star

```bash
pika sessions star <id> [--unstar]
```

**API**: `PATCH /sessions/:id/star`

**Request body**: `{ "starred": true }` or `{ "starred": false }`.

### projects list

```bash
pika projects list [options]

Options:
  --format <fmt>      Output: json, table, minimal, auto (default: auto)
```

**API**: `GET /projects`

**Response shape**:
```typescript
{
  overview: {
    totalProjects: number;
    totalSessions: number;
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  projects: ProjectItem[];
  sourceDistribution: Record<string, { source: Source; count: number }[]>;
}
```

**Note**: Projects use composite key (`COALESCE(project_name, project_ref)`), not a stable identifier. No individual project GET endpoint exists — use `sessions list --project <key>`.

### search

```bash
pika search <query> [options]

Options:
  --limit <n>       Max results (default: 50, max: 100)
  --source <name>   Filter by source
  --from <date>     Filter by last_message_at >= date (ISO 8601)
  --to <date>       Filter by last_message_at <= date (ISO 8601)
  --format <fmt>    Output: json, table, auto (default: auto)
```

**API**: `GET /search?q=<query>`

**Response shape**:
```typescript
{
  results: SearchResultRow[];
  total: number;
}
```

**Output (table)**:
```
┌──────────────┬─────────────────────────┬─────────────────────────────────────┐
│ Session      │ Title                   │ Snippet                             │
├──────────────┼─────────────────────────┼─────────────────────────────────────┤
│ sess_abc123  │ Fix login bug           │ ...the OAuth token was expiring...  │
│ sess_def456  │ Auth refactor           │ ...moved token refresh to...        │
└──────────────┴─────────────────────────┴─────────────────────────────────────┘
```

### tags list

```bash
pika tags list [options]

Options:
  --format <fmt>    Output: json, table, minimal, auto (default: auto)
```

**API**: `GET /tags`

**Response**: `{ tags: TagRow[] }` ordered by name.

### tags create

```bash
pika tags create <name> [options]

Options:
  --color <hex>     Hex color (e.g. #ff6b6b)
```

**API**: `POST /tags`

**Request body**: `{ "name": "...", "color": "#..." }`

### tags add / remove

```bash
pika tags add <session-id> <tag-id>
pika tags remove <session-id> <tag-id>
```

**API**:
- Add: `PUT /sessions/:id/tags` with body `{ "tagId": "..." }`
- Remove: `DELETE /sessions/:id/tags` with body `{ "tagId": "..." }`

**Note**: Operations use `tagId` (UUID), not tag name. List tags first to get IDs.

## Implementation Architecture

### File Structure

```
packages/cli/src/
├── commands/
│   ├── sessions/
│   │   ├── index.ts        # Subcommand group definition
│   │   ├── list.ts         # pika sessions list
│   │   ├── get.ts          # pika sessions get
│   │   ├── content.ts      # pika sessions content
│   │   ├── trash.ts        # pika sessions trash
│   │   ├── star.ts         # pika sessions star
│   │   └── types.ts        # Response type definitions
│   ├── projects/
│   │   ├── index.ts
│   │   ├── list.ts
│   │   └── types.ts
│   ├── search/
│   │   ├── index.ts
│   │   └── types.ts
│   ├── tags/
│   │   ├── index.ts
│   │   ├── list.ts
│   │   ├── create.ts
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   └── types.ts
│   ├── sync.ts             # (existing)
│   ├── login.ts            # (existing)
│   ├── status.ts           # (existing)
│   └── update.ts           # (existing)
├── api/
│   └── client.ts           # Pika-specific ApiClient wrapper
├── output/
│   ├── formatters.ts       # Pika-specific table columns
│   └── utils.ts            # Truncation, date formatting
└── cli.ts                  # Updated with new subcommands
```

### Command Implementation Pattern

Each command follows a consistent pattern for testability. The core logic returns a result object; exit codes are set by the wrapper.

```typescript
// commands/sessions/list.ts

import {
  defineCommand,
  resolveFormat,
  parsePaginationArgs,
  buildPaginationParams,
  withErrorHandling,
  OutputFormatter,
  type OutputFormat,
} from "@nocoo/cli-base";
import type { ApiClient } from "@nocoo/cli-base";
import { sessionListColumns } from "../../output/formatters.js";
import { createPikaClient, PIKA_PAGINATION } from "../../api/client.js";
import type { SessionListResponse } from "./types.js";
import type { ParsedPaginationArgs } from "@nocoo/cli-base";

/** Custom error for API failures — caught by withErrorHandling */
class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Core logic — throws on error, caught by withErrorHandling.
 * Returns void on success; all output goes through formatter.
 */
export async function runSessionsList(
  args: ParsedPaginationArgs & {
    project?: string;
    source?: string;
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  // Build pagination params using shared helper
  const params = buildPaginationParams(args);
  if (args.project) params.projectKey = args.project;
  if (args.source) params.source = args.source;

  const response = await client.get<SessionListResponse>("/sessions", params);

  if (!response.ok) {
    throw new ApiError(response.error ?? `API error: ${response.status}`, response.status);
  }

  const data = response.data!;

  // Output full envelope in json mode, items only in table/minimal
  formatter.response(
    { items: data.sessions, raw: data },
    { columns: sessionListColumns, minimalKey: "id" }
  );

  // Pagination hints to stderr in table mode only (not json/minimal)
  if (args.format === "table" && data.hasMore) {
    if (data.page != null) {
      // Page mode: suggest next page
      formatter.info(`Page ${data.page} of ${Math.ceil(data.totalCount! / data.pageSize!)}. Use --page ${data.page + 1} to continue.`);
    } else if (data.cursor) {
      // Cursor mode: suggest cursor
      formatter.info(`More results available. Use --cursor ${data.cursor} to continue.`);
    }
  }
}

/** Command definition — wires dependencies and handles exit code */
export default defineCommand({
  meta: {
    name: "list",
    description: "List sessions with optional filters",
  },
  args: {
    // Pika-specific pagination args (defined in api/client.ts)
    limit: {
      type: "string",
      default: "50",
      description: "Maximum number of items to return (max: 100)",
    },
    page: {
      type: "string",
      description: "Page number (starts at 1). Uses offset pagination.",
    },
    cursor: {
      type: "string",
      description: "Cursor for keyset pagination (from previous response)",
    },
    format: {
      type: "string",
      description: "Output format: json, table, minimal, auto (default: auto)",
    },
    project: {
      type: "string",
      description: "Filter by project key",
    },
    source: {
      type: "string",
      description: "Filter by source (claude-code, codex, etc.)",
    },
  },
  async run({ args }) {
    const format = resolveFormat(args.format);
    const formatter = new OutputFormatter({ format });

    await withErrorHandling(async () => {
      const client = createPikaClient();

      // Parse and validate pagination args (throws if page + cursor both set)
      const pagination = parsePaginationArgs(
        { limit: args.limit, page: args.page, cursor: args.cursor },
        PIKA_PAGINATION  // { defaultLimit: 50, maxLimit: 100 }
      );

      // Core logic throws on error — caught by withErrorHandling
      await runSessionsList(
        { ...pagination, project: args.project, source: args.source, format },
        { client, formatter }
      );
    }, formatter);
  },
});

// ── api/client.ts ─────────────────────────────────────────────
// Pika-specific pagination config (matches API constants)
export const PIKA_PAGINATION = {
  defaultLimit: 50,
  maxLimit: 100,
} as const;
```

### Testing Pattern

```typescript
// commands/sessions/list.test.ts

import { describe, expect, it } from "vitest";
import { runSessionsList } from "./list.js";
import { createMockClient, createMockFormatter } from "../../test-utils.js";

describe("sessions list", () => {
  it("outputs paginated sessions with full envelope in json mode", async () => {
    const apiResponse = {
      sessions: [
        { id: "sess_1", title: "Test 1", source: "claude-code" },
        { id: "sess_2", title: "Test 2", source: "codex" },
      ],
      cursor: "next_cursor",
      hasMore: true,
    };
    const mockClient = createMockClient({ "/sessions": apiResponse });
    const mockFormatter = createMockFormatter("json");

    await runSessionsList(
      { limit: 20, mode: "cursor", format: "json" },
      { client: mockClient, formatter: mockFormatter }
    );

    // Verify response() was called with full envelope
    expect(mockFormatter.responseCalls[0].raw).toEqual(apiResponse);
    expect(mockFormatter.responseCalls[0].items).toHaveLength(2);
    // No pagination hints in json mode
    expect(mockFormatter.infoCalls).toHaveLength(0);
  });

  it("suggests --page for page mode pagination in table mode", async () => {
    const mockClient = createMockClient({
      "/sessions": {
        sessions: [{ id: "sess_1" }],
        cursor: null,
        hasMore: true,
        totalCount: 100,
        page: 1,
        pageSize: 50,
      },
    });
    const mockFormatter = createMockFormatter("table");

    await runSessionsList(
      { limit: 50, page: 1, mode: "page", format: "table" },
      { client: mockClient, formatter: mockFormatter }
    );

    // Should suggest --page 2, not --cursor
    expect(mockFormatter.infoCalls[0]).toContain("--page 2");
    expect(mockFormatter.infoCalls[0]).not.toContain("--cursor");
  });

  it("suggests --cursor for cursor mode pagination in table mode", async () => {
    const mockClient = createMockClient({
      "/sessions": {
        sessions: [{ id: "sess_1" }],
        cursor: "abc123",
        hasMore: true,
      },
    });
    const mockFormatter = createMockFormatter("table");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "table" },
      { client: mockClient, formatter: mockFormatter }
    );

    // Should suggest --cursor, not --page
    expect(mockFormatter.infoCalls[0]).toContain("--cursor abc123");
  });

  it("throws ApiError on non-ok response", async () => {
    const mockClient = createMockClient({}, { status: 500, error: "Internal error" });
    const mockFormatter = createMockFormatter("json");

    await expect(
      runSessionsList(
        { limit: 20, mode: "cursor", format: "json" },
        { client: mockClient, formatter: mockFormatter }
      )
    ).rejects.toThrow("Internal error");
  });
});
```

## API Endpoints Summary

These endpoints already exist on the Worker:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | List sessions with cursor/page pagination |
| GET | `/sessions/:id` | Get session metadata |
| GET | `/sessions/:id/content` | Get session content from R2 |
| PATCH | `/sessions/:id/star` | Star/unstar session |
| PATCH | `/sessions/:id/trash` | Soft-delete or restore session |
| GET | `/projects` | List projects with aggregates |
| GET | `/search?q=` | Full-text search |
| GET | `/tags` | List all tags |
| POST | `/tags` | Create a tag |
| PATCH | `/tags/:id` | Update a tag |
| DELETE | `/tags/:id` | Delete a tag |
| GET | `/sessions/:id/tags` | List tags for a session |
| PUT | `/sessions/:id/tags` | Add tag to session (body: `{ tagId }`) |
| DELETE | `/sessions/:id/tags` | Remove tag from session (body: `{ tagId }`) |

## CLI Updated Structure

```typescript
// cli.ts

import { defineCommand } from "@nocoo/cli-base";
import { PIKA_VERSION } from "@pika/core";

export const main = defineCommand({
  meta: {
    name: "pika",
    version: PIKA_VERSION,
    description: "Replay and search coding agent sessions",
  },
  subCommands: {
    // Existing
    sync: () => import("./commands/sync.js").then((m) => m.default),
    login: () => import("./commands/login.js").then((m) => m.default),
    status: () => import("./commands/status.js").then((m) => m.default),
    update: () => import("./commands/update.js").then((m) => m.default),

    // New CRUD commands
    sessions: () => import("./commands/sessions/index.js").then((m) => m.default),
    projects: () => import("./commands/projects/index.js").then((m) => m.default),
    search: () => import("./commands/search/index.js").then((m) => m.default),
    tags: () => import("./commands/tags/index.js").then((m) => m.default),
  },
});
```

## Implementation Phases

### Phase 1: Foundation
1. Implement cli-base enhancements (doc 12)
2. Add `ApiClient` wrapper in pika
3. Add test utilities

### Phase 2: Read Operations
1. `sessions list` / `sessions get` / `sessions content`
2. `projects list`
3. `search`
4. `tags list`

### Phase 3: Write Operations
1. `sessions trash`
2. `sessions star`
3. `tags create` / `tags add` / `tags remove`

### Phase 4: Polish
1. Error message improvements
2. Offline detection
3. Help text and examples

## Open Questions

1. **Batch operations**: Should we expose `POST /sessions/batch` for bulk star/trash operations?
2. **Output to file**: Should we support `--output <file>` for large exports?
3. **Watch mode**: Should `pika sessions list --watch` poll for updates?
4. **Tag by name**: Should `tags add` accept tag name and resolve to ID automatically?
