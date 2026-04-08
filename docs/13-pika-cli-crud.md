# 13. Pika CLI CRUD Implementation

> Design document for implementing read/update/delete operations in Pika CLI.

## Overview

This document describes how Pika CLI will leverage the enhanced `@nocoo/cli-base` to provide full CRUD operations on sessions, projects, tags, and search functionality.

## Goals

1. **AI-Friendly Interface** — Output formats optimized for AI agent consumption
2. **Progressive Disclosure** — Minimize token usage with layered detail levels
3. **Consistent Patterns** — All resources follow the same command structure
4. **Independent Testability** — Each command handler is a pure function with injected dependencies

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
Showing 3 of 156 sessions. Use --limit to see more.
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
  --from <date>       Sessions after this date (ISO 8601)
  --to <date>         Sessions before this date
  --sort <field>      Sort by: last_message_at, started_at, total_messages, duration_seconds
  --format <fmt>      Output: auto, json, table, minimal
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
  --format <fmt>      Output: auto, json
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
  --format <fmt>      Output: auto, json, table, minimal
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
  --from <date>     Sessions after this date
  --to <date>       Sessions before this date
  --format <fmt>    Output: auto, json, table
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
  --format <fmt>    Output: auto, json, table, minimal
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

Each command follows a consistent pattern for testability:

```typescript
// commands/sessions/list.ts

import { defineCommand } from "@nocoo/cli-base";
import { paginationArgs, formatArg, parsePaginationArgs } from "@nocoo/cli-base";
import type { ApiClient, OutputFormatter } from "@nocoo/cli-base";
import { sessionListColumns } from "../../output/formatters.js";
import type { SessionListResponse } from "./types.js";

/** Core logic — pure function, injectable dependencies */
export async function runSessionsList(
  args: {
    limit: number;
    cursor?: string;
    page?: number;
    project?: string;
    source?: string;
    format: string;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  const params: Record<string, string> = {
    limit: String(args.limit),
  };
  if (args.cursor) params.cursor = args.cursor;
  if (args.page) params.page = String(args.page);
  if (args.project) params.projectKey = args.project;
  if (args.source) params.source = args.source;

  const response = await client.get<SessionListResponse>("/sessions", params);

  if (!response.ok) {
    formatter.error(response.error ?? `API error: ${response.status}`);
    process.exitCode = 1;
    return;
  }

  formatter.list(response.data!.sessions, {
    columns: sessionListColumns,
    minimalKey: "id",
  });

  if (response.data!.hasMore) {
    formatter.info(
      `More results available. Use --cursor ${response.data!.cursor} to continue.`
    );
  }
}

/** Command definition — wires dependencies */
export default defineCommand({
  meta: {
    name: "list",
    description: "List sessions with optional filters",
  },
  args: {
    ...paginationArgs,
    ...formatArg,
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
    const client = createPikaClient();  // from api/client.ts
    const formatter = new OutputFormatter({
      format: resolveFormat(args.format),
    });

    await runSessionsList(
      {
        ...parsePaginationArgs(args),
        project: args.project,
        source: args.source,
        format: args.format ?? "auto",
      },
      { client, formatter }
    );
  },
});
```

### Testing Pattern

```typescript
// commands/sessions/list.test.ts

import { describe, expect, it, vi } from "vitest";
import { runSessionsList } from "./list.js";
import { createMockClient, createMockFormatter } from "../../test-utils.js";

describe("sessions list", () => {
  it("returns paginated sessions", async () => {
    const mockClient = createMockClient({
      "/sessions": {
        sessions: [
          { id: "sess_1", title: "Test 1", source: "claude-code" },
          { id: "sess_2", title: "Test 2", source: "codex" },
        ],
        cursor: "next_cursor",
        hasMore: false,
      },
    });
    const mockFormatter = createMockFormatter();

    await runSessionsList(
      { limit: 20, format: "json" },
      { client: mockClient, formatter: mockFormatter }
    );

    expect(mockFormatter.listCalls).toHaveLength(1);
    expect(mockFormatter.listCalls[0].items).toHaveLength(2);
  });

  it("passes filters to API", async () => {
    const mockClient = createMockClient({
      "/sessions": { sessions: [], cursor: null, hasMore: false },
    });
    const mockFormatter = createMockFormatter();

    await runSessionsList(
      { limit: 10, cursor: "abc", project: "pika", source: "claude-code", format: "json" },
      { client: mockClient, formatter: mockFormatter }
    );

    expect(mockClient.getCalls[0].params).toEqual({
      limit: "10",
      cursor: "abc",
      projectKey: "pika",
      source: "claude-code",
    });
  });

  it("handles API errors gracefully", async () => {
    const mockClient = createMockClient({}, { status: 500, error: "Internal error" });
    const mockFormatter = createMockFormatter();

    await runSessionsList(
      { limit: 20, format: "json" },
      { client: mockClient, formatter: mockFormatter }
    );

    expect(mockFormatter.errorCalls).toContain("Internal error");
    expect(process.exitCode).toBe(1);
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
