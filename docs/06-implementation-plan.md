# 06 - Implementation Plan

## Overview

This document defines the phased implementation plan for Pika, including atomic commit strategy and four-layer testing architecture.

## Four-Layer Testing Architecture

| Layer | What | When | Tool | Threshold |
|-------|------|------|------|-----------|
| **L1: Unit Tests** | Business logic, parsers, validators, helpers | pre-commit | Vitest + v8 coverage | 90% coverage (statements, branches, functions, lines) |
| **L2: Lint** | Type checking, code style | pre-commit | `tsc --noEmit` (all packages) | Zero errors, zero warnings |
| **L3: API E2E** | All REST API endpoints | pre-push | Vitest E2E config | 100% endpoint coverage |
| **L4: BDD E2E** | Core user flows via real browser | On demand | Playwright (Chromium) | Core flows covered |

### Port Convention

| Environment | Port |
|-------------|------|
| Dev server | 7040 |
| API E2E server | 17040 |
| BDD E2E server | 27040 |

### Git Hooks (Husky)

```
pre-commit:
  1. Run L1 (bun test) — fail if coverage < 90%
  2. Run L2 (tsc --noEmit across all packages) — fail on any error

pre-push:
  1. Run L3 (API E2E) — check port availability first, clean stale .next/dev/lock
```

### Test File Conventions

```
packages/cli/src/parsers/claude.ts          # source
packages/cli/src/parsers/claude.test.ts     # L1 unit test

packages/web/src/app/api/sessions/route.ts  # source
packages/web/tests/e2e/sessions.spec.ts     # L3 API E2E

packages/web/tests/bdd/session-replay.spec.ts  # L4 BDD E2E
```

### Coverage Exclusions

- `*.tsx` files (presentational components)
- `bin.ts`, `cli.ts` (entry points)
- SQLite adapter files (platform-specific, Bun vs Node)

### E2E Auth Bypass

E2E tests bypass authentication via:
- Environment variable: `E2E_SKIP_AUTH=1`
- Node environment: `NODE_ENV=development`
- Detected at API route level, returns mock user

---

## Phase 1: Skeleton (MVP Foundation) ✅ COMPLETE

**Goal**: Monorepo structure, core types, auth, and a single parser working end-to-end.

**Status**: All 8 commits landed. 115 tests, 100% coverage, lint clean.

### Commit Plan

| # | Commit | Description | Tests | Status |
|---|--------|-------------|-------|--------|
| 1.1 | `chore: initialize bun workspace monorepo` | Root `package.json` with workspaces, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, Husky hooks | L2: tsc passes | ✅ |
| 1.2 | `feat: add core package with shared types` | `packages/core/src/types.ts` (Source, CanonicalSession, CanonicalMessage, RawSessionArchive, ParseError, SessionSnapshot), `constants.ts` (PARSER_REVISION, SCHEMA_VERSION), `validation.ts`, `index.ts` | L1: 61 validation tests | ✅ |
| 1.3 | `feat: add d1 migration 001-init` | `scripts/migrations/001-init.sql` — users, accounts, sessions (with content_hash, raw_hash, parser_revision, schema_version), messages, message_chunks (with tool_context), chunks_fts (content + tool_context), indexes | L1: 10 SQL validation tests (bun:sqlite) | ✅ |
| 1.4 | `feat: add worker package with ingest routes` | `packages/worker/` — wrangler.toml, session metadata ingest route with idempotent upsert logic (content_hash + raw_hash check, parser_revision comparison as integer), shared secret auth | L1: 14 request validation tests | ✅ |
| 1.5 | `feat: add cli package skeleton` | `packages/cli/` — bin.ts, cli.ts (citty), command stubs, config manager | L1: 14 config manager tests | ✅ |
| 1.6 | `feat: implement cli login command` | Login flow: local HTTP server, browser open, callback handler, save API key | L1: 5 login flow tests (mocked HTTP) | ✅ |
| 1.7 | `feat: add web package with nextauth` | `packages/web/` — Next.js 15, NextAuth v5 config, Google OAuth, JWT strategy, login page | L2: tsc passes | ✅ |
| 1.8 | `feat: add cli auth api route` | `/api/auth/cli/route.ts` — generate/return API key on authenticated callback, localhost-only security, extracted testable logic in `cli-auth.ts` | L1: 11 route handler tests | ✅ |

### Verification Gate

- [x] `bun install` succeeds
- [x] `tsc --noEmit` passes across all packages
- [x] `bun test` passes with 90%+ coverage (115 tests, 100%)
- [x] `pika login` opens browser and completes OAuth flow
- [x] D1 migration applies cleanly (validated via bun:sqlite in-memory)
- [x] D1 migration includes message_chunks (with tool_context) + chunks_fts (content + tool_context) tables
- [x] Sessions table has content_hash, raw_hash, parser_revision, schema_version fields

### Notes

- Migration tests use `bun:sqlite` (Bun built-in) instead of `better-sqlite3` (unsupported in Bun 1.3.9+)
- Migration tests excluded from vitest (bun:sqlite not available in Node/Vite), run only via `bun test`
- Web package uses Next.js 15 (not 16 as originally planned — 16 not yet released)
- CLI auth logic extracted into `packages/web/src/lib/cli-auth.ts` for testability

---

## Phase 2: Parsers + Upload

**Goal**: All 5 source parsers working with incremental sync and upload pipeline.

### Commit Plan

| # | Commit | Description | Tests | Status |
|---|--------|-------------|-------|--------|
| 2.1 | `feat: add file change detection utility` | `file-changed.ts` — inode + mtime + size triple-check | L1: all edge cases (rotation, same-mtime write, etc.) | ✅ |
| 2.2 | `feat: add cursor store` | `cursor-store.ts` — persist/load cursors to `~/.config/pika/cursors.json` | L1: read/write/merge tests | ✅ |
| 2.3 | `feat: add claude code parser` | Parse JSONL, extract full messages, tool calls, token usage | L1: fixture-based tests (sample JSONL files) | ✅ |
| 2.4 | `feat: add claude session driver` | Discovery + byte-offset cursor + incremental parse | L1: incremental parse tests | ✅ |
| 2.5 | `feat: add codex cli parser` | Parse rollout JSONL, extract messages, cumulative diff | L1: fixture-based tests | ✅ |
| 2.6 | `feat: add codex session driver` | Discovery + cursor | L1: tests | ✅ |
| 2.7 | `feat: add gemini cli parser` | Parse JSON sessions, extract messages, diff tokens | L1: fixture-based tests | ✅ |
| 2.8 | `feat: add gemini session driver` | Discovery + array-index cursor | L1: tests | ✅ |
| 2.9 | `feat: add opencode parser` | Dual: JSON files + SQLite, cross-source dedup | L1: fixture-based tests | ✅ |
| 2.10 | `feat: add opencode session driver` | Dir mtime optimization + SQLite watermark | L1: tests | ✅ |
| 2.11 | `feat: add vscode copilot parser` | CRDT reconstruction, request metadata correlation | L1: fixture-based tests | ✅ |
| 2.12 | `feat: add vscode copilot session driver` | Discovery + CRDT cursor state | L1: tests |
| 2.13 | `feat: add driver registry` | Auto-detect available sources, construct driver set | L1: registry tests with mocked fs |
| 2.14 | `feat: add upload engine` | Batch metadata upload with retry + backoff, content_hash + raw_hash computation (SHA-256 of uncompressed JSON) | L1: upload engine tests (mocked HTTP) |
| 2.15 | `feat: add content upload (dual R2)` | Gzip compress, dual upload to R2: `canonical.json.gz` (overwrite) + `raw/{raw_hash}.json.gz` (content-addressed, immutable) via API or presigned URL | L1: compression + upload tests |
| 2.16 | `feat: add sync command` | Orchestrate: discover -> parse -> split -> collect raw payload alongside canonical output -> upload. Parse errors logged to error queue (non-blocking) | L1: integration test with fixtures |
| 2.16b | `feat: add message chunking utility` | Split message content at natural boundaries (~2000 chars), paragraph/sentence/line aware chunking. Populate tool_context on chunk_index=0 for tool messages | L1: chunking boundary tests (long messages, edge cases) |
| 2.17 | `feat: add worker session ingest + R2 storage` | Worker: content_hash + raw_hash comparison for idempotency (both match = no-op), parser_revision/schema_version comparison as integers (newer overwrites, older rejects), chunked message content insertion into message_chunks (with tool_context) + chunks_fts, dual R2 put (canonical.json.gz overwrite + raw/{raw_hash}.json.gz append) | L1: worker handler tests |

### Verification Gate

- [ ] `pika sync` parses sessions from all 5 sources
- [ ] Incremental sync only processes changed files
- [ ] Metadata appears in D1, content in R2
- [ ] Both canonical.json.gz and raw/{hash}.json.gz appear in R2 for each session
- [ ] Re-upload of same content (identical content_hash + raw_hash) is a no-op (idempotency)
- [ ] Parse errors are logged to parse-errors.jsonl (not silently dropped)
- [ ] 90%+ test coverage maintained

---

## Phase 3: Dashboard + Search

**Goal**: Full dashboard with session list, replay, and search.

### Commit Plan

| # | Commit | Description | Tests |
|---|--------|-------------|-------|
| 3.1 | `feat: add d1 client for web` | `lib/d1.ts` — REST API client singleton | L1: client tests (mocked fetch) |
| 3.2 | `feat: add r2 client for web` | `lib/r2.ts` — presigned URL generation | L1: URL generation tests |
| 3.3 | `feat: add sessions api route` | `GET /api/sessions` — list with filters, pagination | L1: query builder tests; L3: endpoint test |
| 3.4 | `feat: add session detail api route` | `GET /api/sessions/{id}` — metadata + presigned content URL | L3: endpoint test |
| 3.5 | `feat: add search api route` | `GET /api/search` — chunks_fts MATCH query with message_chunks join (searches content + tool_context), snippet extraction | L1: query builder; L3: endpoint test |
| 3.6 | `feat: add stats api route` | `GET /api/stats` — aggregate queries | L3: endpoint test |
| 3.7 | `feat: add ingest api routes` | `POST /api/ingest/sessions`, `PUT /api/ingest/content` — proxy to worker | L3: endpoint tests |
| 3.8 | `feat: add dashboard layout` | Sidebar navigation, header, auth guard | L4: can navigate between pages |
| 3.9 | `feat: add dashboard overview page` | Stats cards, activity heatmap, source chart, recent sessions | L4: page renders with data |
| 3.10 | `feat: add session list page` | Paginated list, filter controls, sort options | L4: list renders, filters work |
| 3.11 | `feat: add session replay page` | Full conversation display, message bubbles, tool calls | L4: replay renders conversation |
| 3.12 | `feat: add search page` | Search input, results with highlights, click-to-jump | L4: search returns results |
| 3.13 | `feat: add dockerfile + railway config` | Multi-stage Docker build, standalone output | Manual: deploy succeeds |

### Verification Gate

- [ ] Dashboard shows session list with correct data
- [ ] Session replay displays full conversation from R2
- [ ] Full-text search returns relevant results with highlights
- [ ] All L3 API E2E tests pass
- [ ] Core L4 BDD flows pass

---

## Phase 4: Enhancement

**Goal**: Tags, notifier hooks, optimizations.

### Commit Plan

| # | Commit | Description | Tests |
|---|--------|-------------|-------|
| 4.1 | `feat: add d1 migration 002-tags` | Tags + session_tags tables | L1: SQL validation |
| 4.2 | `feat: add tags api routes` | CRUD for tags, add/remove from sessions | L3: endpoint tests |
| 4.3 | `feat: add tags ui` | Settings page tag management, session card tag badges | L4: tag workflow |
| 4.4 | `feat: add star/unstar api + ui` | Star endpoint, starred filter, session card star button | L3 + L4 |
| 4.5 | `feat: add notifier hooks (init command)` | Install hooks into AI tools for auto-sync | L1: hook install tests |
| 4.6 | `feat: add notify command with coordinator` | Lock-based sync coordination, follow-up detection | L1: coordinator tests |
| 4.7 | `feat: add r2 presigned url direct upload` | CLI uploads content directly to R2, bypassing API | L1: presigned flow tests |
| 4.8 | `feat: add status command` | Show sync status, last sync time, session counts, parse error summary | L1: status display tests |

---

## Dependency Graph

```
Phase 1 (skeleton)
  1.1 monorepo init
  1.2 core types ──────────────────────┐
  1.3 d1 migration ─────────┐         │
  1.4 worker ───────────────┤         │
  1.5 cli skeleton ─────────┤         │
  1.6 cli login ────────────┤         │
  1.7 web + nextauth ───────┤         │
  1.8 cli auth route ───────┘         │
                                      │
Phase 2 (parsers + upload)            │
  2.1 file-changed ──┐               │
  2.2 cursor store ──┤               │
  2.3-2.12 parsers ──┼── all depend on core types (1.2)
  2.13 registry ─────┤
  2.14-2.15 upload ──┤
  2.16 sync cmd ─────┤
  2.16b chunking ────┤
  2.17 worker ingest ┘

Phase 3 (dashboard)
  3.1-3.2 clients ──┐
  3.3-3.7 api ──────┼── depends on Phase 1 (web) + Phase 2 (worker)
  3.8-3.12 ui ──────┤
  3.13 deploy ──────┘

Phase 4 (enhancements)
  4.1-4.8 ── depends on Phase 3
```
