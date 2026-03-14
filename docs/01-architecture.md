# 01 - Architecture

## Overview

Pika is a SaaS for replaying and searching coding agent sessions. Users install a CLI (`pika`) that parses local AI tool conversation logs, uploads them to the cloud, and views them via a web dashboard with full-text search.

**Core value**: _Recall + Search_ -- what did you ask the AI, what did it do, which tools did it call, and what code did it change?

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Monorepo | Bun workspaces | Fast installs, native TS, same as pew |
| Language | TypeScript (strict) | Full-stack consistency |
| CLI | `citty` + `consola` + `picocolors` | Lightweight, tree-shakeable, proven in pew |
| Web | Next.js 16 (App Router) on Railway | SSR, mature ecosystem, Docker deploy |
| UI | Tailwind v4 + shadcn/ui + Radix | Shared dashboard theme with pew |
| Auth | NextAuth v5 (Google OAuth, JWT) | Battle-tested, D1 adapter |
| Database | Cloudflare D1 (SQLite) | Metadata + chunked FTS5 index |
| Object Store | Cloudflare R2 | Canonical + raw conversation content (gzip) |
| Ingest Worker | Cloudflare Workers | D1 batch writes + R2 puts |
| Testing | Vitest (90% coverage) | Fast, native ESM |

## Monorepo Structure

```
pika/
├── packages/
│   ├── core/           # Shared types, constants, validators
│   ├── cli/            # CLI (@nocoo/pika, published to npm)
│   ├── web/            # Dashboard (Next.js on Railway)
│   └── worker/         # Cloudflare Worker (pika-ingest)
├── scripts/
│   └── migrations/     # D1 SQL migration files
├── docs/               # Numbered design documents
├── vitest.config.ts
├── Dockerfile
└── CLAUDE.md
```

### Package Responsibilities

| Package | npm Name | Published | Purpose |
|---------|----------|-----------|---------|
| `packages/core` | `@pika/core` | No (private) | Shared TS types, constants, validation |
| `packages/cli` | `@nocoo/pika` | Yes (npm) | CLI for parsing + uploading sessions |
| `packages/web` | `@pika/web` | No (private) | Dashboard (Next.js) |
| `packages/worker` | `@pika/worker` | No (private) | Cloudflare Worker for D1/R2 writes |

## Data Flow

```
User's Machine                          Cloud
───────────────────                     ─────────────────────────────────

File sources (FileDriver):
~/.claude/projects/**/*.jsonl   ─┐
~/.codex/sessions/**/*.jsonl    ─┤
~/.gemini/tmp/*/chats/*.json    ─┼─► pika CLI ──► parse ──► compress
~/.local/share/opencode/*.json  ─┤   (session     + split
~/Library/.../Code/User/...     ─┘    parsers)
                                        ▲
DB sources (DbDriver):                 │
~/.local/share/opencode/        ───────┘
  opencode.db (SQLite, primary)
                                        │
~/.config/pika/                         │ metadata batch (JSON, 50/batch)
  config.json  (API key)                │ content upload (canonical + raw gzip, per-session)
  cursors.json (sync state)             │
                                        ▼
                               ┌─────────────────┐
                               │  Next.js API     │
                               │  (Railway)       │
                               │                  │
                               │  Auth + Validate │
                               │  + Proxy         │
                               └────────┬─────────┘
                                        │ WORKER_SECRET auth
                                        ▼
                               ┌─────────────────┐     ┌──────────┐
                               │  CF Worker       │────►│ D1       │
                               │  (pika-ingest)   │     │ metadata │
                               │                  │     │ + FTS    │
                               │                  │────►│          │
                               └─────────────────┘     └──────────┘
                                        │
                                        │ R2 PUT
                                        ▼
                               ┌──────────────────────────────────┐
                               │  R2 Bucket                      │
                               │  (pika-sessions)                │
                               │  canonical.json.gz (mutable)    │
                               │  raw/{hash}.json.gz (immutable) │
                               └──────────────────────────────────┘
```

## Authentication Architecture

### Dashboard (Web)
1. User clicks "Sign in with Google"
2. NextAuth v5 handles Google OAuth flow
3. JWT session stored in cookie
4. API routes validate JWT on each request

### CLI
1. `pika login` starts a local HTTP server on a random port
2. Opens browser to `{apiUrl}/api/auth/cli?callback=http://127.0.0.1:{port}/callback`
3. Server-side: if user is authenticated, generates/retrieves `api_key` (`pk_` + 32 hex)
4. Redirects back to CLI's local server with `api_key` in query params
5. CLI saves `api_key` to `~/.config/pika/config.json`
6. All subsequent CLI requests use `Authorization: Bearer pk_...`

### Security constraints
- CLI callback URL must be `127.0.0.1` (server-validated)
- Login timeout: 120 seconds
- WORKER_SECRET shared secret between Next.js and CF Worker

## Key Design Decisions

### Why dual storage (D1 + R2)?
D1 has a 1MB per-row limit and 5MB per-query result limit. A single coding session can contain 1-5MB of conversation content. Storing full content in D1 would hit limits quickly. Solution:
- **D1**: Session metadata + message metadata + chunked content for FTS5 search (no truncation — content is split into ~2000-char chunks at natural boundaries, all independently searchable)
- **R2 canonical**: Full normalized conversation (`canonical.json.gz`) for session replay
- **R2 raw**: Original source payloads (`raw/{hash}.json.gz`) content-addressed and immutable — re-ingest creates new keys, never overwrites old archives

### Why not pure Cloudflare (Pages + Workers)?
Next.js on Railway is the **MVP choice**: SSR with full Node.js runtime, mature auth (NextAuth), easy Docker deployment, complex server-side data fetching. Pure CF Pages/Workers would require significant compromises on dashboard complexity. This is not a permanent decision — if Cloudflare ecosystem matures (better Next.js support, auth patterns), the dashboard can converge to Cloudflare Workers.

### Why split ingest (metadata vs content)?
Metadata is small (~1KB/session) and batched efficiently (50/batch via D1 batch API). Content is large (10KB-5MB) and needs individual upload to R2. Splitting avoids large payloads blocking metadata ingest.
