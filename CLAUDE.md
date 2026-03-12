# CLAUDE.md

## Project Overview

**Pika** is a SaaS for replaying and searching coding agent sessions. It consists of 4 packages in a Bun workspace monorepo:

| Package | Purpose |
|---------|---------|
| `packages/core` | Shared types, constants, validators |
| `packages/cli` | CLI tool (`@nocoo/pika`) for parsing + uploading sessions |
| `packages/web` | Next.js 15 dashboard (Railway) |
| `packages/worker` | Cloudflare Worker for D1/R2 writes |

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **CLI**: citty + consola
- **Web**: Next.js 15 (App Router), Tailwind v4, shadcn/ui, Recharts
- **Auth**: NextAuth v5 (Google OAuth, JWT)
- **DB**: Cloudflare D1 (SQLite) — metadata + chunked FTS5 index (no truncation)
- **Storage**: Cloudflare R2 — canonical (mutable) + raw (content-addressed, immutable) conversation content (gzip)
- **Worker**: Cloudflare Workers — idempotent versioned ingest to D1 + R2
- **Testing**: Vitest (90% coverage), Husky hooks
- **Test runner note**: `bun test` uses Bun's native test runner; `bunx vitest run` uses Vitest under Node. Migration tests (bun:sqlite) only run under `bun test`.

## Four-Layer Testing

| Layer | What | When | Threshold |
|-------|------|------|-----------|
| L1: UT | Business logic, parsers, validators | pre-commit | 90% coverage |
| L2: Lint | tsc --noEmit (all packages) | pre-commit | Zero errors |
| L3: API E2E | All REST API endpoints | pre-push | 100% endpoints |
| L4: BDD E2E | Core user flows (Playwright) | On demand | Core flows |

**Ports**: dev=7040, API E2E=17040, BDD E2E=27040

## Key Commands

```bash
bun install                    # install dependencies
bun test                       # run unit tests (bun native runner, includes bun:sqlite tests)
bunx vitest run --coverage     # run tests with coverage report (vitest/node, excludes migration tests)
bun run build                  # build all packages
bun run lint                   # type-check all packages (root + web tsconfig)
```

## Supported Sources

- Claude Code (`~/.claude/projects/**/*.jsonl`)
- Codex CLI (`~/.codex/sessions/**/*.jsonl`)
- Gemini CLI (`~/.gemini/tmp/*/chats/*.json`)
- OpenCode (`~/.local/share/opencode/` — JSON + SQLite)
- VSCode Copilot (`~/Library/Application Support/Code/User/` — CRDT JSONL)

## Design Documents

See `docs/README.md` for the numbered document index.

## Retrospective

- **better-sqlite3 → bun:sqlite**: Bun 1.3.9 dropped `better-sqlite3` support. Migration tests now use `bun:sqlite` (Bun built-in). API is nearly identical (`prepare/all/run/exec/close`), but pragmas use `db.run("PRAGMA ...")` instead of `db.pragma("...")`. These tests are excluded from vitest (Node can't resolve `bun:sqlite`) and only run via `bun test`.
- **Dual test runners**: `bun test` (Bun native) and `bunx vitest run` (Node/Vite) have different module resolution. Bun-specific imports (`bun:sqlite`) must be excluded from vitest config. Always verify both runners pass.
- **git add -A atomicity trap**: When uncommitted files from multiple logical changes exist, `git add -A` stages everything. Always stage selectively (`git add <paths>`) to maintain atomic commits.
- **Web package tsconfig independence**: Next.js tsconfig is incompatible with TypeScript project references (`composite: true`). Root lint script runs both: `tsc --noEmit && tsc --noEmit -p packages/web/tsconfig.json`.
- **Extracting testable logic from Next.js routes**: Route handlers in App Router are hard to unit test directly. Extract pure business logic into separate `.ts` files (e.g., `cli-auth.ts`) that accept deps as params, then import in the route handler. This keeps coverage high without needing a full Next.js test environment.
- **vi.stubEnv is vitest-only**: `vi.stubEnv()` / `vi.unstubAllEnvs()` do not exist in Bun's native test runner. For dual-runner compatibility, use direct `process.env` assignment with manual save/restore. Cast via `(process.env as Record<string, string>)[key]` to satisfy TS readonly constraint on `NODE_ENV`.
- **Stub DB in route handlers is a false green**: A route handler with a no-op stub DB will pass all unit tests but leave the auth chain broken end-to-end. Always wire real infra (even if it's a thin HTTP client) early; stub DB should only exist in test mocks, never in production route code.
- **Worker upsert WHERE must match design doc**: The idempotent versioned overwrite clause must check `content_hash`, `raw_hash`, `parser_revision`, and `schema_version` — not just `snapshot_at`. Using only `snapshot_at` allows stale parser output to overwrite newer canonical data.
- **Next.js on Railway → D1 via HTTP REST API**: Since Next.js runs on Railway (not Cloudflare), it cannot use D1 bindings. Use the Cloudflare D1 REST API (`/client/v4/accounts/{id}/d1/database/{id}/query`) with `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` env vars. The Worker uses native D1 bindings for batch writes; Next.js uses HTTP for lightweight reads/writes.
