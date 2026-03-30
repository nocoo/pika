# Changelog

All notable changes to this project will be documented in this file.

## [0.5.5] - 2026-03-30

### Features

- **Inline progress with spinner** — CLI sync output now uses terminal inline refresh ( `\r\x1b[2K`) with Unicode spinner animation and block progress bar instead of repetitive per-line logging

### Refactor

- **Streaming batch pipeline** — Replace monolithic `allResults[]` accumulation with `currentBatch[]` that flushes every 50 sessions (parse → metadata upload → content upload → release memory), reducing peak RSS from ~14 GB to ~4 GB
- **DB driver streaming** — OpenCode SQLite driver streams results via `onResult` callback instead of building full array, bounding memory regardless of total session count

## [0.5.4] - 2026-03-30

### Fixes

- **R2 stale pointers** — NULL stale R2 pointers when content hash changes in metadata upsert, preventing orphaned storage references
- **Sidebar logo** — Replace undefined `logo256` variable with static path, fixing broken logo image
- **Sortable table headers** — Add `aria-sort` attribute to sortable table headers for accessibility
- **Dashboard accessibility** — Fix breadcrumb aria, group label, and GitHub link per basalt B-2 spec
- **Login page** — Fix layout, aspect ratio, callbackUrl, and aria-hidden issues
- **Activity heatmap** — Add Activity title to heatmap card for layout alignment with Sources

### Refactor

- **Dashboard layout** — Dashboard page restructured with `DashboardSegment` component and period selector
- **PeriodSelector & DataTable** — Refinements to bulk bar, table layout, and period control
- **Card styling** — Remove border from SessionCard, SearchResultCard, ProjectCard; adopt basalt three-tier luminance system for card components
- **Logo sizes** — Standardize logo sizes per basalt B-3 spec

### Testing

- **Hash-change key invalidation** — Add tests for canonical and raw upload key invalidation on content hash change
- **Dual runner compat** — Fix `bun test` compatibility by skipping vitest-only `vi.mock` tests (headObject) under Bun runtime

## [0.5.0] - 2026-03-27

### Features

- **Six-dimension quality framework** — Full quality infrastructure: L1 unit tests (98%+ coverage), G1 static analysis (tsc + Biome), G2 security scanning (gitleaks + osv-scanner), D1 test isolation (dedicated D1-test + R2-test with marker verification)
- **L2 API E2E tests** — 57 endpoint tests across 4 spec files (sessions, search/stats/projects, tags, live health) with dedicated E2E vitest config and auth bypass mode
- **Batch upload pipeline** — Two-phase memory-efficient upload: metadata batches first, then content batches. Prevents 25GB+ RSS on large syncs (~5800 sessions) by keeping only one batch in memory at a time

### Fixes

- **Memory leak** — Sync pipeline accumulated all sessions + JSON copies + gzip buffers simultaneously; now batched with per-batch GC eligibility
- **Empty session upload prevention** — Three-layer defense: driver-level `parse()` returns `[]` for zero-message sessions, pipeline filters before upload, worker rejects `totalMessages < 1`
- **Subagent file deduplication** — Exclude `subagents/` directory from Claude Code discovery; subagent JSONL files share the parent session's `sessionId`, causing duplicate uploads. Reduces discovered files from ~2800 to ~400
- **Logger stage ordering** — Split interleaved metadata+content loop into two-phase pipeline so CLI progress output correctly shows metadata complete before content starts

### Infrastructure

- Biome lint + format (replaced manual style checks)
- gitleaks secret scanning in pre-push hook
- osv-scanner dependency audit in pre-push hook
- Pre-commit hook: L1 unit tests (90%+ coverage) + G1 (Biome lint)
- Pre-push hook: L2 E2E + G2 security gates
- D1-test database with `_test_marker` table for 2-layer isolation verification
- Next.js 16 alignment (config + type declarations)

## [0.4.0] - 2026-03-18

### Features

- **Projects page** — Full project-centric dashboard with stats overview, ranking chart, and session drill-down; sidebar navigation integration
- **Left/right split layout** — Projects page uses 3/10 + 7/10 grid with left sidebar (project list grouped by scope) and right panel (collapsible overview + detail)
- **Scope grouping** — Projects automatically grouped by personal / work / other based on workspace path convention
- **Project filters** — Filter by minimum session count and scope (personal/work)
- **Worktree project merging** — Projects from different worktree paths but same logical project are merged into a single card with aggregated stats
- **Multi-value projectKey queries** — Sessions and activity APIs support comma-separated project keys for merged project drill-down
- **Project display names** — Parse `…/workspace/{scope}/{project}` paths into short names with scope badges

### Enhancements

- **ScopeBadge component** — Visual badge for personal/work scope
- **ProjectCard** — Compact card with mini donut chart showing source distribution, session/message/token stats
- **ProjectRankingChart** — Top 10 projects horizontal bar chart by session count
- **ProjectActivityChart** — 90-day area chart for per-project daily session activity
- **Collapsible overview** — Stats cards and ranking chart can be collapsed to focus on detail
- **Placeholder state** — FolderKanban icon with prompt when no project is selected

### Fixes

- Fix Recharts `ref` reserved prop collision by renaming to `projectRef` in chart data
- Fix selected project ring clipping in sidebar overflow container

## [0.3.0] - 2026-03-18

### Features

- **Search dialog** — Sidebar-integrated search trigger (fake input with ⌘K badge) that opens a large dialog overlay with full FTS5 search; clicking a result closes the dialog and navigates to session detail
- **⌘K keyboard shortcut** — Global ⌘K / Ctrl+K shortcut to toggle search dialog from anywhere in the dashboard
- **Sync progress logging** — CLI sync pipeline now logs progress during upload for better visibility

### Enhancements

- **SearchResultCard dual mode** — Supports both `<Link>` (page) and `<button>` (dialog) rendering via optional `onClick` prop
- **Search removed from sidebar nav** — Search is now exclusively accessed via the dialog trigger / ⌘K; the standalone search page remains for backward compatibility

### Infrastructure

- shadcn Dialog component added (Radix UI)
- CLI bundled as single-file via Bun for npm publish

## [0.2.1] - 2026-03-15

### Features

- **Markdown rendering** — Full markdown support in session replay via react-markdown + remark-gfm (headings, lists, tables, blockquotes, strikethrough, task lists, bold/italic, links)
- **Syntax highlighting** — Code blocks highlighted with shiki (dual theme: github-light/github-dark), async loading with plain-text fallback
- **Agent brand avatars** — Each source (Claude, Codex, Gemini, OpenCode, Copilot) gets a branded SVG icon instead of a generic letter
- **User profile avatar** — Google profile photo shown for user messages via NextAuth session
- **Identity hover cards** — Hover on avatars to see user profile or agent details (model, token usage, timestamp)
- **Scroll to top** — Floating button appears after 500px scroll with smooth fade animation
- **Enhanced end marker** — Session end shows statistics summary (messages, duration, tokens) with centered horizontal lines
- **Enhanced timestamp separator** — Horizontal line with centered time label for clearer message grouping
- **Tool call improvements** — Success/neutral color tinting, Badge labels for Input/Output, JSON syntax highlighting via shiki, accordion expand animation
- **Message entrance animation** — Fade-in with staggered delay, respects prefers-reduced-motion

### Enhancements

- **Sessions DataTable** — Replaced card grid with sortable TanStack Table, offset pagination, model filter
- **Multi-select & batch operations** — Bulk star, tag, delete via DataTable checkboxes
- **Soft delete & trash** — Sessions can be trashed and restored, with isolated query builders
- **Auto-generated titles** — Sessions without titles get a title from the first user message
- **Shared UI components** — AgentBadge and ModelBadge extracted as reusable components

### Fixes

- Fix SQLite UPDATE table alias error (use subquery pattern)
- Fix message range filter from 1-10 to 0-10
- Fix Docker standalone deploy (static imports, image optimization, AUTH_URL build arg)
- Fix migration test location for Docker build

### Infrastructure

- Golden yellow rebrand (primary color)
- Explicit test file exclude in core tsconfig
- shadcn hover-card component added

## [0.2.0] - 2026-03-15

First tagged release. Pika is a SaaS for replaying and searching coding agent sessions — CLI parses local AI tool logs, uploads to the cloud, and a web dashboard provides full-text search and session replay.

### Features

- **Multi-source session parsing** — Claude Code, Codex CLI, Gemini CLI, OpenCode (JSON + SQLite), VSCode Copilot (CRDT JSONL)
- **CLI tool (`@nocoo/pika`)** — `pika login` (OAuth via browser), `pika sync` (incremental parse + upload), `pika status` (sync state overview), `--source` filter for per-source sync
- **Cloudflare Worker ingest** — idempotent versioned upserts to D1 + R2, chunked FTS5 indexing, canonical + raw dual storage
- **Next.js dashboard** — session list, session replay, full-text search with `<mark>` highlights, stats overview, star/unstar, tag management
- **Upload pipeline** — parallel content upload with concurrency control, D1 429 retry, cursor rollback on upload failure
- **Auth** — NextAuth v5 Google OAuth (JWT), CLI Bearer API key auth, E2E bypass mode
- **R2 presigned URL direct upload** — raw archives uploaded client-side via presigned URLs
- **Health check** — `/api/live` endpoint with version reporting

### Security

- **Stored XSS prevention** — FTS5 snippets sanitized server-side (HTML-escaped, only `<mark>` tags restored)
- **API key hashing** — SHA-256 hashed at rest, fresh key generated on each login
- **Ingest body size limits** — Content uploads capped at 50 MB compressed, metadata at 2 MB, requests without `Content-Length` rejected (411)
- **Gzip bomb defense** — decompressed content capped at 256 MB via streaming size tracking in Worker
- **Content proxy streaming** — R2 responses streamed instead of buffered to prevent OOM
- **Dependency audit clean** — all CVEs resolved via overrides (undici ≥7.24.0, cookie ≥0.7.0)
- **Config file permissions** — `~/.config/pika/` files restricted to owner-only (0600)
- **Localhost-only CLI callbacks** — open redirect prevention
- **Worker auth scoping** — R2 content reads scoped by authenticated user ID

### Infrastructure

- Bun workspace monorepo (core, cli, web, worker)
- Vitest with 98%+ coverage, Husky pre-commit/pre-push hooks
- D1 migrations (001-init, 002-tags, 003-hash-api-keys)
- Railway deployment (Next.js), Cloudflare Workers deployment (ingest)
