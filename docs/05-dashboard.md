# 05 - Dashboard

## Overview

The Pika dashboard is a Next.js 16 (App Router) web application deployed on Railway. It provides session browsing, full-text search, session replay, and usage statistics.

As of docs/16, all `/api/*` route handlers in web are thin forwarders that proxy the request to the api service (Hono on Bun, port 7023 dev / set via `API_INTERNAL_URL` in prod). Auth, validation, and Worker calls live in `packages/api`. Web still owns NextAuth (OAuth + JWT session) and the `/api/auth/cli` browser flow because those depend on NextAuth cookies.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Framework | Next.js 16 (App Router, standalone output) |
| React | React 19 |
| CSS | Tailwind CSS v4 |
| UI Components | shadcn/ui + Radix UI |
| Charts | Recharts |
| Auth | NextAuth v5 (Google OAuth, JWT strategy) |
| API access | Same-origin `/api/*` → api service via `lib/api-forward.ts` |
| D1 Access (web) | Only NextAuth's `D1AuthAdapter` (`lib/d1.ts`) for users/accounts persistence |
| R2 Access | Handled by api/worker (web no longer signs URLs directly) |
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

Full-text search across message chunks and tool context (tool names, file paths, commands):
- Search input with instant feedback
- Results grouped by session, showing matching chunk snippets and/or tool context
- FTS5 `snippet()` for keyword highlighting in results
- Searches both message content and tool metadata (e.g., "Bash npm install", "Read src/index.ts")
- Filters: source, project, time range
- Click result -> jump to the specific message within a session replay

**Data source**: `GET /api/search?q=...&source=...&from=...&to=...`

**Query implementation**:
```sql
SELECT mc.session_id, mc.message_id, mc.ordinal, mc.chunk_index,
       snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 64) as content_snippet,
       snippet(chunks_fts, 1, '<mark>', '</mark>', '...', 64) as tool_snippet,
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

All `/api/*` routes (except `/api/auth/*`) are now thin forwarders defined via `createForwardHandler` in `packages/web/src/lib/api-forward.ts`. They forward method, query string, and a small allowlist of headers (`cookie`, `authorization`, `x-e2e-user`, plus ingest-specific `x-content-hash`, `x-parser-revision`, `x-schema-version`, `x-raw-hash`, `content-encoding`) and stream the request body straight through (`duplex: "half"`) to avoid buffering large content uploads.

The api service (`packages/api`, Hono on Bun) owns the actual logic: auth via `requireUser` middleware, validation, and Worker calls. See `docs/16-api-extraction.md` for the migration plan.

### Ingest (write path)

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/ingest/sessions` | POST | Bearer `pk_...` | Batch session metadata upsert (forwards to api → Worker) |
| `/api/ingest/presign` | POST | Bearer `pk_...` | Presign R2 upload URL (forwards to api → Worker) |
| `/api/ingest/confirm-raw` | POST | Bearer `pk_...` | Confirm raw upload (validation in api, then forwards to Worker) |
| `/api/ingest/content/{key}/canonical` | PUT | Bearer `pk_...` | Stream gzip canonical conversation (forwards to api → R2) |
| `/api/ingest/content/{key}/raw` | PUT | Bearer `pk_...` | Stream gzip raw source payload (forwards to api → R2) |

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

Dashboard data reads no longer hit D1 directly from web. Web forwards `/api/*` to the api service, which calls the Worker (or D1 over HTTP for the few endpoints still using `lib/d1.ts`). The only direct D1 consumer in web is NextAuth's `D1AuthAdapter` (users/accounts persistence during OAuth sign-in), which keeps `lib/d1.ts` and `CF_D1_*` env vars alive (see `docs/11-unified-worker-api.md`).

## Deployment

- **Dockerfile**: Multi-stage (Bun build -> Node.js 22-slim runtime)
- **Platform**: Railway (Docker builder) — web and api are separate Railway services; same-origin via Caddy in prod
- **Output**: `next.config.ts` with `output: "standalone"`
- **Environment variables**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` (all four for D1AuthAdapter only), `API_INTERNAL_URL` (web → api), `WORKER_SECRET`, `WORKER_URL` (api → Worker; api also needs the same NextAuth + D1 vars to validate cookies and read users)
