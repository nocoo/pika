# pika

Coding Agent Session Replay & Search SaaS.

Upload, search, and replay your conversations with AI coding agents (Claude Code, Codex, Gemini, OpenCode, VSCode Copilot).

## Architecture

- **CLI** (`@nocoo/pika`): Parses local agent session files, uploads to cloud
- **Dashboard** (Next.js on Railway): Session browsing, replay, full-text search
- **Worker** (Cloudflare Workers): Ingests data to D1 + R2
- **Storage**: Cloudflare D1 (metadata + FTS5) + R2 (full conversations)

## Getting Started

```bash
bun install          # install dependencies (also sets up git hooks via husky)
```

## Testing & Quality Gates

Pika uses a two-layer automated quality gate enforced by git hooks. **Hooks cannot be skipped** — they run on every commit and every push.

### Commands

| Command | What it does |
|---------|-------------|
| `bun test` | Run all unit tests (Bun native runner, 911 tests) |
| `bun run lint` | Type-check all packages (`tsc --noEmit` for root + web) |
| `bunx vitest run` | Run unit tests via Vitest (Node runner, excludes `bun:sqlite` tests) |
| `bunx vitest run --coverage` | Run tests with v8 coverage report |

### Git Hooks (Husky)

| Hook | Runs | Purpose |
|------|------|---------|
| **pre-commit** | `bun test && bun run lint` | Block commits with failing tests or type errors |
| **pre-push** | `bun test && bun run lint` | Double-check before code reaches remote |

Hooks are installed automatically by `bun install` (via the `prepare` script). They live in `.husky/` and are checked into git so every contributor gets them.

### Coverage

Coverage is enforced at **90%** across all four metrics (statements, branches, functions, lines) via `vitest.config.ts` thresholds.

```bash
bunx vitest run --coverage    # view full coverage report
```

**Coverage exclusions** (not measured):

- `*.test.ts`, `*.spec.ts`, `*.tsx` — test files and React components
- `bin.ts`, `cli.ts`, `index.ts`, `types.ts` — entry points and type-only files
- `commands/*.ts` — CLI command wrappers (thin shells around testable logic)
- `packages/web/src/app/**` — Next.js route handlers (thin wrappers)
- `packages/web/src/lib/auth.ts`, `packages/web/src/lib/d1.ts` — infra singletons

### Dual Test Runners

Pika uses two test runners due to runtime differences:

- **`bun test`** — Bun's native runner. Runs all tests including `bun:sqlite` migration tests. Used by git hooks.
- **`bunx vitest run`** — Vitest on Node. Cannot resolve `bun:sqlite`, so `migration.test.ts` is excluded. Used for coverage reports.

Both must pass. The test count difference (911 vs 901) is the `bun:sqlite`-only migration tests.

## Documentation

See [docs/README.md](./docs/README.md) for the full design documentation.
