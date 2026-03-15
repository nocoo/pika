# Changelog

All notable changes to this project will be documented in this file.

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
