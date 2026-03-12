# CLAUDE.md

## Project Overview

**Pika** is a SaaS for replaying and searching coding agent sessions. It consists of 4 packages in a Bun workspace monorepo:

| Package | Purpose |
|---------|---------|
| `packages/core` | Shared types, constants, validators |
| `packages/cli` | CLI tool (`@nocoo/pika`) for parsing + uploading sessions |
| `packages/web` | Next.js 16 dashboard (Railway) |
| `packages/worker` | Cloudflare Worker for D1/R2 writes |

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **CLI**: citty + consola
- **Web**: Next.js 16 (App Router), Tailwind v4, shadcn/ui, Recharts
- **Auth**: NextAuth v5 (Google OAuth, JWT)
- **DB**: Cloudflare D1 (SQLite) — metadata + FTS5 index
- **Storage**: Cloudflare R2 — full conversation content (gzip)
- **Worker**: Cloudflare Workers — ingest to D1 + R2
- **Testing**: Vitest (90% coverage), Husky hooks

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
bun test                       # run unit tests
bun run build                  # build all packages
bun run lint                   # type-check all packages
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

_(Record learnings and mistakes here as the project evolves)_
