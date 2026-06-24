# CLAUDE.md

## Project Overview

**Pika** is a SaaS for replaying and searching coding agent sessions. Single Cloudflare Worker serves SPA + `/api/*`. 4-package Bun monorepo:

| Package | Purpose |
|---------|---------|
| `packages/core` | Shared types, constants, validators |
| `packages/cli` | `@nocoo/pika` — parses + uploads sessions |
| `packages/web` | Vite + React 19 SPA (builds to `../web-worker/dist`) |
| `packages/web-worker` | Cloudflare Worker — `[assets]` SPA + Hono `/api/*` |

Full architecture: [docs/00-architecture.md](./docs/00-architecture.md).

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **CLI**: citty + consola
- **Web**: Vite + React 19 + React Router, Tailwind v4, shadcn/ui, Recharts
- **Edge**: Cloudflare Workers + Hono
- **Auth**: Cloudflare Access SSO (browser) + `pk_*` API token (CLI)
- **DB**: Cloudflare D1 (SQLite + FTS5) — native binding, no HTTP REST
- **Storage**: Cloudflare R2 — canonical (mutable) + raw (content-addressed) gzip blobs
- **Testing**: Vitest (90% coverage)
- **CI/CD**: GitHub Actions (`nocoo/base-ci@aec4adc1a817c56790d1698329ef9398a15a754a` — v2026.5, SHA-pinned) → `wrangler deploy`

## Quality Framework

| Dim | What | When | Threshold |
|-----|------|------|-----------|
| L1: UT | Business logic, parsers, validators | pre-commit | 90% coverage |
| L2: E2E | Worker API endpoints via local wrangler dev | pre-push / CI | All pass |
| G1: Static | tsc --noEmit (root + web + web-worker) + lint-staged (Biome) + gitleaks staged | pre-commit | Zero errors |
| G2: Security | gitleaks + osv-scanner | pre-push | Zero findings |
| Build | `bun run build` (vite SPA → web-worker dist) | pre-push | Success |
| CD | `wrangler deploy` + `/api/live` smoke | push to main | 200 or 401 |

## Key Commands

```bash
bun install                    # install + husky setup
bun run dev:all                # vite :7022 + wrangler dev :8787
bun test                       # bun native (incl. bun:sqlite migration tests)
bunx vitest run --coverage     # node runner + coverage report
bun run test:e2e               # L2 worker E2E (local wrangler :17022)
bun run build                  # SPA → packages/web-worker/dist
bun run lint                   # tsc --noEmit (3 tsconfigs)
bun run lint:biome             # biome lint + format check
bun run lint:secrets           # gitleaks
bun run lint:deps              # osv-scanner
```

## Deploy

```bash
cd packages/web-worker
CLOUDFLARE_ACCOUNT_ID=d51a8fde361e4be31db17d8c56737c1f bunx wrangler deploy
```

CI auto-deploys on push to `main` (`.github/workflows/ci.yml` → `Deploy Worker (production)`). Repo secret: `CLOUDFLARE_API_TOKEN`.

| Env | Worker | Domain |
|-----|--------|--------|
| prod | `pika` | `pika.hexly.ai` + `pika-ingest.worker.hexly.ai` (legacy CLI) |

## Supported Sources

- Claude Code (`~/.claude/projects/**/*.jsonl`)
- Codex CLI (`~/.codex/sessions/**/*.jsonl`)
- Gemini CLI (`~/.gemini/tmp/*/chats/*.json`)
- OpenCode (`~/.local/share/opencode/` — JSON + SQLite)
- VSCode Copilot (`~/Library/Application Support/Code/User/` — CRDT JSONL)

## Retrospective

Patterns that re-bit us; check before re-introducing.

- **better-sqlite3 → bun:sqlite**: Bun 1.3.9 dropped `better-sqlite3`. Migration tests now use `bun:sqlite` (Bun built-in). API nearly identical (`prepare/all/run/exec/close`), but pragmas use `db.run("PRAGMA ...")` instead of `db.pragma("...")`. Excluded from vitest (Node can't resolve `bun:sqlite`).
- **git add -A atomicity trap**: Stages everything when multiple logical changes coexist. Always stage selectively.
- **Three independent tsconfigs**: root + `packages/web` + `packages/web-worker`. Each has its own `lib`/`types` (DOM vs Workers). Lint script must run all three.
- **Bun built-in imports need variable indirection for tsc**: `import("bun:sqlite")` literal causes TS2307 without bun-types. Use `const modId = "bun:sqlite"; await import(modId)`.
- **vi.stubEnv is vitest-only**: Doesn't exist in Bun's runner. For dual-runner compatibility, use direct `process.env` assignment with manual save/restore. Cast via `(process.env as Record<string, string>)[key]` for `NODE_ENV`.
- **Worker upsert WHERE must check all version fields**: `content_hash`, `raw_hash`, `parser_revision`, `schema_version` — not just `snapshot_at`. Otherwise stale parser output can overwrite newer canonical data.
- **VSCode Copilot completedAt can be numeric epoch**: CRDT `modelState.completedAt` is sometimes ms epoch, not ISO string. Always normalize external timestamps.
- **Barrel export omissions cause silent `undefined`**: Add a constant to `packages/core/src/constants.ts` but forget to re-export from `index.ts` → import resolves to `undefined` at runtime, no TS error. Default param `concurrency = CONST_NAME` becomes `undefined` → `Array.from({ length: NaN })` → empty work. Verify barrel exports.
- **SQLite UPDATE does not support table aliases**: `UPDATE sessions s SET …` is PG/MySQL syntax; SQLite errors `near "s"`. When `buildWhereClause` generates `s.column` conditions, wrap in subquery: `UPDATE sessions SET … WHERE id IN (SELECT s.id FROM sessions s WHERE …)`. SELECT supports aliases.
- **Recharts spreads data props onto React elements**: `<Cell>` receives every data prop. Using `ref`/`key`/`children` as data field name collides with React reserved props → `Expected ref to be a function`. Avoid reserved names in chart data.
- **3-layer luminance: bg < card < secondary**: Dark mode 7% < 10.6% < 12.2%. Content island = L1 `bg-card`; inner panels = L2 `bg-secondary` (brightest). Inverting destroys contrast — panels blend into container.
- **Pre-push must mirror CI**: CI runs `bun run build` to catch issues `tsc --noEmit` misses. Pre-push hook does Build → parallel L2 (E2E) + G2 (gitleaks + osv).
- **CF Access bypass is path-level, not bearer-aware**: `/api/ingest/*` MUST have a CF Access bypass policy or CLI gets 302 HTML and `response.json()` crashes. Bearer token in header doesn't make CF Access let traffic through.
- **CF_ACCESS_TEAM_DOMAIN must be exact**: jose's `jwtVerify` silently catches errors in `accessAuth` middleware → falls through to `apiKeyAuth` → terminal 401 → SPA reloads → infinite redirect loop. Wrong team domain = wrong issuer claim. Set in `wrangler.toml` top-level `[vars]` (only env after the remote test env was removed; E2E reads from `.dev.vars.e2e`).
- **URL-encode the colon in sessionKey**: CLI builds `claude:abc → claude%3Aabc` for the upload URL. Worker route `PUT /content/*` must `decodeURIComponent` each segment before hitting D1, otherwise lookup is `claude%3Aabc` → 404.
- **wrangler `--env=""`**: Without it, scoped CF API tokens missing `Memberships:Read` fail when wrangler calls `/memberships` to auto-pick an account. `--env=""` explicitly targets the top-level config.
- **Killing wrangler dev needs process group**: workerd is a grandchild; SIGTERM to wrangler doesn't reap it before timeout → next `dev:all` hits EADDRINUSE on 8787 + inspector. `dev-all.ts` uses `detached: true` + `process.kill(-pid, signal)`.
- **D1 prod migrations are manual**: `wrangler d1 execute pika-db --remote --file=scripts/migrations/00X.sql`. New table = silent 500 in prod until applied. The `api_tokens` HTTP 500 incident burned us once.
- **`run_worker_first` for `[assets]`**: `wrangler.toml` `[assets]` needs `run_worker_first = ["/api/*"]` so Hono handlers preempt the static file matcher; `not_found_handling = "single-page-application"` makes deep links resolve to `index.html`.
- **CLI domain must match cookie scope**: Browser CF Access cookie is bound to `pika.hexly.ai`. CLI must hit `https://pika.hexly.ai`, not `localhost:7022` (in dev: real `https://pika.dev.hexly.ai` via reverse proxy + mkcert TLS).
- **wrangler dev --local still sets `cf` on requests**: `isLocalhost()` checks `c.req.raw.cf` — present in local mode, making it think requests are on CF edge. E2E bypass must not rely on localhost detection; `apiKeyAuth` E2E_SKIP_AUTH path injects `accessEmail` directly from `DEV_USER_EMAIL`.
- **wrangler d1 --command fails on multi-statement SQL**: Comments and semicolons get mangled. Always use `--file` for migration scripts.
