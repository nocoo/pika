# Pika

Coding-agent session collector and searchable web reader, served by one Cloudflare Worker.
Profile: ts-worker-web plus cli-library.
Direction: [architecture](docs/00-architecture.md), [development guide](docs/01-development.md).

## Scope and instruction sources

- This file is the only project handbook; nested files do not compete with it. Do not create a `CLAUDE.md` alias or copy.
- This handbook is the contract; hooks, CI and config enforce it. Raise weaker gates to match. Frameworks must not replace this file.
- Human docs: [README.md](README.md) and [docs/README.md](docs/README.md). Version: root/CLI package versions and `scripts/sync-versions.ts`; other packages may differ. Enforcement: `.husky/`, CI, root/package Vitest configs, `scripts/ensure-tools.sh`. Environment: Worker config; runner-owned ignored `.dev.vars.e2e`. Accidents: [Retrospective.md](Retrospective.md).

## Project invariants

- One Worker serves SPA and Hono `/api/*`; preserve `run_worker_first` and SPA fallback. Native D1 stores metadata/FTS/token hashes; R2 stores mutable canonical and content-addressed raw gzip blobs.
- Browser uses verified Cloudflare Access, CLI ingest uses `pk_*` API tokens with path-specific Access bypass. Exact issuer/team/AUD matter; bearer alone does not bypass Access on browser management APIs.
- Read source logs/SQLite without modification. Sync uploads metadata, canonical messages and raw content; failed content writes rewind related cursors. `sync --no-upload` still changes cursors and is not a side-effect-free preview.
- Upserts compare content/raw hashes, parser revision and schema version, not only snapshot time. Preserve timestamp normalization, decoded session-key URL segments and SQLite-compatible query syntax.
- Supported sources remain Claude Code, Codex, Gemini, OpenCode JSON/SQLite and VS Code Copilot; current default paths are mostly macOS. Do not invent configurable source flags or completed recycle-bin UI.
- Preserve CLI domain/cookie scope and legacy `pika-ingest.worker.hexly.ai` uploads. Use local Caddy `https://pika.dev.hexly.ai` for interactive dev; ordinary Worker config has production remote bindings.
- Keep MVVM, three strict type configs, published package/barrel exports and background/card/secondary luminance order. Do not use React reserved property names as chart fields.

## Setup and commands

Workspaces: `packages/core`, `packages/cli`, `packages/web`, `packages/web-worker`. Web/API: Vite/React 19, Router/Tailwind/Radix/Recharts, Hono/Worker. Data: D1 SQLite/FTS5 and R2 with `scripts/migrations/`. Tooling: Bun, Node 22.12+, TypeScript 7 strict, Biome, Vitest/Bun SQLite. Run from root; CI pins Bun 1.4.2. Build compiles core/CLI and writes Web assets into the Worker package.

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint:biome
bun run test:coverage
bun run --cwd packages/web test
bun test packages/core/test/migration.test.ts
bun run test:e2e
bun run lint:secrets
bun run lint:deps
```

The API runner owns Worker port 17022, fixed `.wrangler/e2e` and `.dev.vars.e2e`. It invokes Wrangler `--local`, seeds synthetic users and a marker, and needs `npx` in PATH. The pinned Wrangler 4.136.3 maps `--local` to remote bindings disabled; keep that behavior and ensure no other run owns those files. Do not start `dev:all` as a test: it connects the configured remote D1/R2.

## Testing and quality contract

6DQ keeps its name with unified L1, L2/L3, G2 and D1; the owner merged former G1 into L1 on 2026-09-21. Statuses: `enforced`, `planned`, `manual`, `N/A`. No `.skip`/`.only`; statements/branches/functions/lines each ≥95% required, with strict types and check-only zero-warning lint, installed hooks and failure rejection.

| Piece | Requirement and current reality | Status | Evidence |
| --- | --- | --- | --- |
| L1 | Four-metric ≥95% across core/CLI/Web/Worker logic plus strict types and zero-warning check-only lint | planned | Root gate 95/95/95/95, excludes core/commands/TSX; Web/migration lanes run separately; types and check-only zero-warning Biome enforced; index-snapshot checking remains planned |
| L2 | Real HTTP, every API endpoint/method with real SQLite | planned | Worker HTTP runner enforced by pre-push/CI; full surface/guard proof missing |
| L3 | Browser reading/search and real CLI login/sync workflows | planned | No browser system entrypoint; process workflow gate incomplete |
| G2 | Required OSV + gitleaks, missing scanners fail | enforced | `ensure-tools.sh`, pre-push and shared CI; secret scan currently working-tree rather than pushed refs |
| D1 | Per-run local state with guards/marker before reset/seed | planned | Fixed persistence reset occurs before marker validation; normal config includes remote bindings |
| Build | All shipped packages and SPA assets | enforced | Pre-push/CI build |
| Docs | Auth/source/version/migration reality kept current | manual | Numbered guide review |

Current pre-commit runs worktree coverage/types with lint-staged and staged secret scan; pre-push builds then runs HTTP/security in parallel. Target: check-only unified L1 on the index <30s and stdin pushed-ref L2/G2 <3min. No hook bypass, skip flags or weaker thresholds.

## Resources and isolation

| Purpose | Ports / state | Policy |
| --- | --- | --- |
| Interactive dev | Vite 7022 / Worker 8787, inspector 9229 | Remote D1/R2 in normal config; real data |
| API tests | Worker 17022; package `.wrangler/e2e` | Fixed local harness; per-run guards still required |
| Production | `pika.hexly.ai`, legacy ingest domain | Worker `pika`, D1 `pika-db`, R2 `pika` |

Required test design uses local Wrangler/Miniflare with fresh SQLite/R2, rejects remote bindings and credential fallback, validates test runtime and `_test_marker` before destructive operations. Never deploy remote `-test` resources or use production/daily-dev data. Preserve process-group teardown so Wrangler grandchildren cannot leak ports.

## Operations / release

Authorized Worker publishing uses `bun run deploy:web-worker`; the release workflow follows successful main CI. Apply production migrations separately before dependent code, with SQL files rather than mangled multi-statement command strings. Confirm `/api/live`, Access behavior and legacy CLI domain. CLI publishing/version synchronization is separate; follow [development guide](docs/01-development.md).

## Retrospective

Narratives live in [Retrospective.md](Retrospective.md). Keep recurring project rules brief; global lessons belong in nmem/rules and deterministic checks in tests/hooks.

- Use Bun's SQLite runner for migration tests; Vitest/Node cannot load `bun:sqlite`.
- Preserve process-group teardown and select task paths explicitly when staging.
