# Changelog

All notable changes to this project will be documented in this file.

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
