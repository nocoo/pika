# Changelog

All notable changes to this project will be documented in this file.

## [0.8.5] - 2026-06-24

### Features

- **L2 Worker E2E suite** — New `bun run test:e2e` boots a local `wrangler dev --local` (port 17022), applies all migrations to an isolated SQLite, and runs end-to-end HTTP tests against `/api/live`, `/api/sessions`, `/api/ingest/sessions`; runs in parallel with G2 in pre-push and as its own CI job
- **Parallel git hooks** — Rewrote pre-commit (L1 + G1) and pre-push (Build → L2 + G2) as bat-style parallel stages with per-stage log buffering; failures surface the specific stage that broke

### Fixes

- **`bun run dev:all` 401 loop** — `wrangler dev` resolves `[[routes]]` even in local mode and rewrites Host to the prod custom_domain (`pika.hexly.ai`), so `isLocalhost` rejected every browser dev request and `accessAuth` 401'd in an infinite SPA reload loop. `isLocalhost` now also accepts `DEV_USER_EMAIL` (only ever set in `.dev.vars`, never in prod `wrangler.toml`) as a dev signal
- **Session detail 404 in dev** — R2 binding had no `remote = true` while D1 did, so dev saw real session metadata but `env.BUCKET.get(content_key)` hit an empty local bucket. R2 binding now mirrors D1's remote mode
- **Fresh-checkout E2E** — `[assets].directory = "./dist"` requires `dist/` to exist before wrangler will start. E2E setup now creates a placeholder when no build output is present, so `bun run test:e2e` works on a fresh clone (vite's `emptyOutDir` cleans it on the next real build)
- **E2E auth bypass** — `accessAuth` now honors `E2E_SKIP_AUTH` with the same prod-fenced double-gate as `apiKeyAuth`; without it, `wrangler dev --local`'s `cf` injection caused 401 on every non-`/api/live` endpoint
- **E2E process group kill** — global-setup spawns wrangler with `detached: true` so teardown can `process.kill(-pid, "SIGTERM")` the workerd grandchild — fixes port 17022 leaking across repeated `bun run test:e2e` runs
- **E2E shell-argv path safety** — Switched `execSync` with interpolated paths to `execFileSync("npx", [...argv])` so PERSIST_DIR / migration paths with spaces don't break
- **EOVERRIDE in E2E setup** — Dropped duplicate root `dependencies.ws` (npm 9+ rejects a dep that's also in `overrides`, breaking `npx wrangler` invocations)

### Security

- **CVE patches via deps** — Bumped hono ^4.12.26, react-router 8.0.1, vitest 4.1.9, undici ^7.28.0; added overrides for `ws >=8.21`, `esbuild >=0.28.1`, `fast-xml-builder >=1.1.7`

### Chores

- **Major dep upgrades** — TypeScript 5 → 6.0.3 (dropped deprecated `baseUrl` across 3 tsconfigs), vitest 3 → 4.1.9 (mock-constructor migration, `MockFn` type alias), lucide-react 0.577 → 1.21 (extracted `Github` icon locally since v1 dropped brand icons), `@vitejs/plugin-react` 4 → 6, react-router 7 → 8
- **Minor dep upgrades** — React 19.2, wrangler 4.103, `@cloudflare/workers-types` 4.20260621.1, `@aws-sdk/client-s3` 3.1074, radix-ui 1.6, tailwindcss 4.3, biome 2.5, jose, swr, shiki, jsdom
- **Remote test env removed** — Deleted `[env.test]` wrangler config, `pika-test` worker/D1/R2 references, `deploy:test`, `scripts/setup-test-env.sh`, and `assertTestDatabase`/`assertTestBucket` helpers; L2 now runs entirely against local wrangler dev
- **Per-hook tool gating** — `scripts/ensure-tools.sh` takes tool keywords as args; pre-commit asks for `bun gitleaks`, pre-push additionally for `osv-scanner npx` so a missing pre-push tool no longer blocks commits
- **`ingest` E2E round-trip** — Test now `GET`s the session back to verify the upsert really hit D1, not just that the endpoint returned 200
- **Doc cleanup** — Removed stale `pika-test` rows from README + `docs/00-architecture.md`, replaced `--env test` example with `--env=""`, fixed retrospective entry that still pointed at `[env.test.vars]`

## [0.8.4] - 2026-04-16

### Fixes

- **OpenCode SQLite watermark** — Fix cursor never advancing when all sessions are skipped by JSON cross-source dedup, causing 7,099 sessions to be full-scanned on every `pika sync` run

### Performance

- **Batch session skip** — Use single `SELECT DISTINCT session_id` query to identify sessions with new messages, reducing per-session queries from O(N) to O(1) + O(changed)
- **Boundary ID collection** — Replace per-session boundary ID loop with single cross-session query

## [0.8.3] - 2026-04-14

### Fixes

- **Search integrity** — Exclude sessions with NULL `content_key` from search results, preventing partial-write windows from surfacing incomplete sessions during multi-batch D1 ingestion
- **Ingest robustness** — Split D1 batch statements at 500-limit boundary and defer `content_key` UPDATE to final batch for atomic content visibility
- **Accessibility** — Add `aria-label` to sidebar sign-out avatar button for screen readers
- **Tag editor** — Add missing `title` tooltip on edit-mode color swatch (consistent with create-mode)

### Chores

- **Design system** — Restore correct 3-layer luminance hierarchy (L0 background > L1 card > L2 secondary), replace hardcoded colors with theme tokens, add CSS variables for sidebar widths
- **Typography** — Replace arbitrary text sizes (`text-[9px]`, `text-[10px]`, etc.) with `text-micro` utility class
- **Motion** — Replace broad `transition-all` with specific transition properties
- **CI** — Add full monorepo build (`next build`) to pre-push gate; add base-ci quality gate workflow
- **Layout** — Replace fragile `calc()` with flex layout in project sidebar, remove hard max-w caps on titles

## [0.8.2] - 2026-04-11

### Features

- **E2E test infrastructure** — Add Playwright config and initial BDD tests for L3 quality tier
- **Test IDs** — Add data-testid attributes to dashboard, session, and search components for E2E targeting
- **Session user helper** — Add E2E auth bypass helper for test environments

### Fixes

- **Tags API** — Standardize response format across endpoints
- **E2E tests** — Migrate to production database, fix NODE_ENV type cast

### Chores

- **Documentation** — Add L2/L3 E2E implementation design document
- **Dependencies** — Add Playwright, fix vitest coverage-v8 brace-expansion conflict

## [0.8.1] - 2026-04-10

### Improvements

- **Query performance** — Exclude soft-deleted sessions by default for faster queries

### Fixes

- **CLI filters** — Strict integer validation for numeric filter params
- **Bug fixes** — Address three bugs from code review

## [0.8.0] - 2026-04-09

### Features

- **Session editing** — Edit session title and description via CLI (`pika sessions edit`) and API (`PATCH /sessions/:id`)
- **Advanced filters** — Add `--model`, `--min-messages`, `--max-messages`, `--min-duration`, `--max-duration`, `--min-tokens`, `--max-tokens` filters to sessions list
- **Batch trash** — Support batch trash operations from CLI
- **Tag name support** — Use tag names (not just IDs) in add/remove operations with case-insensitive lookup
- **Description column** — Add description field to sessions table

### Chores

- **Documentation** — Complete all doc 14 tasks

## [0.7.0] - 2026-04-09

### Features

- **CLI CRUD commands** — Full session/project/tag/search management from command line:
  - `pika sessions list/get/content` — List, view, and export session content
  - `pika sessions trash/star` — Move to trash or star sessions
  - `pika projects list` — List projects with activity stats
  - `pika tags list/create/add/remove` — Manage session tags
  - `pika search` — Full-text search across sessions
- **Output formats** — JSON, table, minimal, text, and markdown output modes
- **Pagination** — Cursor-based and offset pagination with `--limit`, `--page`, `--cursor`
- **Source aliases** — Use `gemini`, `claude`, `copilot` as shortcuts for full source names

### Fixes

- **Source filter** — `--source=gemini` now correctly maps to `gemini-cli` (was silently returning all sessions)
- **Content formatting** — Tool messages display correctly in text/markdown output
- **API compatibility** — Handle 204 No Content, snake_case responses, envelope unwrapping

### Chores

- **Security** — Update vite 7.3.1 → 8.0.7 (CVE fixes)
- **Code quality** — Biome lint auto-fixes, 95% test coverage threshold

## [0.6.3] - 2026-04-06

### Improvements

- **CLI refactor** — Migrate to `@nocoo/cli-base` shared infrastructure library, reducing duplicate code for config management, OAuth login, update checking, and browser opening
- **Login page** — Beautified OAuth success page with basalt design system (dark theme, Inter font, golden yellow checkmark icon)

## [0.6.2] - 2026-04-06

### Fixes

- **CLI update command** — Use correct npm package name `@nocoo/pika` instead of `@pika/cli`

## [0.6.1] - 2026-04-05

### Fixes

- **npm binary version** — Rebuild CLI binary to embed correct version string (0.6.0 publish had stale binary)

## [0.6.0] - 2026-04-05

### Features

- **Unified Worker API** — Migrate all session/content D1 queries through Cloudflare Worker instead of direct D1 HTTP API. Eliminates 100 req/s rate limit and simplifies auth to single `WORKER_SECRET`
- **CLI update command** — Add `pika update` and `pika update --check` for self-updating CLI to latest version. Auto-detects package manager (bun/pnpm/yarn/npm)
- **Keyboard navigation** — Add arrow key navigation to search results

### Fixes

- **Accessibility** — Add aria-label to search input, aria-hidden to decorative elements, focus-visible styles, and 32×32px touch targets for star buttons
- **E2E bypass** — Add E2E_SKIP_AUTH support to resolveUserForWorker for test environments

### Chores

- **Cleanup** — Remove unused D1 CLI auth and live modules (replaced by Worker proxy)
- **Documentation** — Add unified Worker API design doc (docs/11)

## [0.5.7] - 2026-04-03

### Fixes

- **Login skeleton** — Add dedicated `LoginSkeleton` component for Suspense fallback, matching badge card structure per Basalt B-1 spec

### Chores

- **Port migration** — Migrate dev/E2E ports from 7040/17040 to 7022/17022
- **Dockerfile alignment** — Align Dockerfile EXPOSE port to 7022

## [0.5.6] - 2026-03-30

### Fixes

- **npm binary version** — Rebuild CLI binary to embed correct version string (previous publish had stale `0.5.4`)

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
