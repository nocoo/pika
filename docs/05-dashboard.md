# 05 - Dashboard

## Overview

The Pika dashboard is a Next.js 16 (App Router) web application deployed on Railway. It provides session browsing, full-text search, session replay, and usage statistics.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Framework | Next.js 16 (App Router, standalone output) |
| React | React 19 |
| CSS | Tailwind CSS v4 |
| UI Components | shadcn/ui + Radix UI |
| Charts | Recharts |
| Auth | NextAuth v5 (Google OAuth, JWT strategy) |
| D1 Access | D1 REST API (read) via `lib/d1.ts` singleton |
| R2 Access | `@aws-sdk/client-s3` for presigned URLs |
| Deployment | Docker (Bun build, Node.js runtime) on Railway |

## Route Structure

```
packages/web/src/app/
+-- login/                      # Google OAuth login page
+-- (dashboard)/                # Authenticated layout group
|   +-- dashboard/              # Overview: stats, activity, recent sessions
|   +-- sessions/               # Session list with search + filters
|   +-- sessions/[id]/          # Session replay (full conversation)
|   +-- search/                 # Full-text search page
|   +-- settings/               # Tags, CLI status, account settings
+-- api/
    +-- auth/                   # NextAuth routes + CLI OAuth callback
    |   +-- [...nextauth]/      # NextAuth catch-all
    |   +-- cli/                # CLI login callback handler
    +-- ingest/
    |   +-- sessions/           # Session metadata ingest (proxy to Worker)
    |   +-- content/            # Content upload (proxy to R2)
    +-- sessions/               # Session CRUD queries
    +-- search/                 # Full-text search queries
    +-- tags/                   # Tag CRUD
    +-- stats/                  # Dashboard statistics
```

## Key Pages

### Dashboard (`/dashboard`)

Overview page showing:
- Total sessions count, sessions this week
- Activity heatmap (sessions per day, last 90 days)
- Source distribution pie chart (Claude, Codex, Gemini, etc.)
- Recent sessions list (last 10)
- Top projects by session count

**Data source**: `GET /api/stats` -> D1 aggregate queries

### Session List (`/sessions`)

Paginated session list with:
- **Search bar**: Full-text search across message content
- **Filters**: Source, project, time range, starred, tags
- **Sort**: Last active (default), started at, token usage, duration
- **Pagination**: Cursor-based (keyset) for performance

Each session card shows: source icon, title/first message preview, project name, timestamp, message count, duration, token usage, tags.

**Data source**: `GET /api/sessions?source=...&project=...&from=...&to=...&sort=...&cursor=...`

### Session Replay (`/sessions/[id]`)

Full conversation display:
1. **Load metadata** from D1 (instant)
2. **Load full content** from R2 `canonical.json.gz` (async, shows loading state)
3. **Render messages** sequentially with:
   - Role-based styling (user = right, assistant = left, tool = indented)
   - Code blocks with syntax highlighting
   - Tool calls with expandable input/output
   - Timestamps between messages
   - Token usage per turn (collapsible)

**Navigation**: Jump to specific message, keyboard shortcuts (j/k for next/prev)

**Data source**: `GET /api/sessions/{id}` (metadata) + R2 presigned URL (content)

### Search (`/search`)

Full-text search across message chunks with:
- Search input with instant feedback
- Results grouped by session, showing matching chunk snippets
- FTS5 `snippet()` for keyword highlighting in results
- Filters: source, project, time range
- Click result -> jump to the specific message within a session replay

**Data source**: `GET /api/search?q=...&source=...&from=...&to=...`

**Query implementation**:
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

### Settings (`/settings`)

- **Tags**: Create, edit, delete tags with color picker
- **CLI Status**: Show connected device, last sync time, total sessions
- **Account**: Email, avatar, API key management (regenerate)
- **Data**: Export/delete account data

## API Routes

### Ingest (write path)

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/ingest/sessions` | POST | Bearer `pk_...` | Batch session metadata upsert |
| `/api/ingest/content/{key}/canonical` | PUT | Bearer `pk_...` | Upload canonical conversation (gzip) to R2 |
| `/api/ingest/content/{key}/raw` | PUT | Bearer `pk_...` | Upload raw source payload (gzip) to R2 |

Both routes validate the Bearer token against `users.api_key`, then proxy to the CF Worker with `WORKER_SECRET`.

### Queries (read path)

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/sessions` | GET | JWT cookie | List sessions with filters |
| `/api/sessions/{id}` | GET | JWT cookie | Session metadata + R2 presigned URL |
| `/api/search` | GET | JWT cookie | Full-text search |
| `/api/tags` | GET/POST | JWT cookie | List/create tags |
| `/api/tags/{id}` | PATCH/DELETE | JWT cookie | Update/delete tag |
| `/api/sessions/{id}/tags` | POST/DELETE | JWT cookie | Add/remove tag from session |
| `/api/sessions/{id}/star` | POST/DELETE | JWT cookie | Star/unstar session |
| `/api/stats` | GET | JWT cookie | Dashboard statistics |

## Component Structure

```
packages/web/src/components/
+-- ui/                         # shadcn/ui primitives
|   +-- button, card, input, dialog, popover, badge, ...
+-- dashboard/
|   +-- stats-cards.tsx         # Metric summary cards
|   +-- activity-heatmap.tsx    # Session activity heatmap
|   +-- source-chart.tsx        # Source distribution
+-- sessions/
|   +-- session-list.tsx        # Paginated session list
|   +-- session-card.tsx        # Individual session card
|   +-- session-filters.tsx     # Filter controls
|   +-- session-replay.tsx      # Full conversation replay
|   +-- message-bubble.tsx      # Individual message rendering
|   +-- tool-call.tsx           # Tool call display (expandable)
+-- search/
|   +-- search-input.tsx        # Search bar with debounce
|   +-- search-results.tsx      # Results list with highlights
+-- layout/
    +-- sidebar.tsx             # Navigation sidebar
    +-- header.tsx              # Top bar with user menu
```

## D1 Read Access

Dashboard reads from D1 via REST API (not native binding, since Next.js runs on Railway, not Cloudflare):

```typescript
// packages/web/src/lib/d1.ts
class D1Client {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      }
    );
    // parse response...
  }
}
```

## Deployment

- **Dockerfile**: Multi-stage (Bun build -> Node.js 22-slim runtime)
- **Platform**: Railway (Docker builder)
- **Output**: `next.config.ts` with `output: "standalone"`
- **Environment variables**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_API_TOKEN`, `CF_R2_*`, `WORKER_SECRET`, `WORKER_URL`
