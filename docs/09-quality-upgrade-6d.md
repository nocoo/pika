# 09 - Quality Upgrade: Six-Dimension Quality Framework

## Background

Pika currently implements a partial quality stack:

| Dimension | Six-Dimension Spec | Pika Status | Gap |
|-----------|-------------------|-------------|-----|
| **L1 Unit** | ≥90% coverage, pre-commit <30s | ✅ 98.37%, 1,206 tests, 1.4s | None |
| **L2 Integration/API** | 100% API endpoints, real HTTP, pre-push <3min | ❌ Absent | Full build required |
| **L3 System/E2E** | Playwright, CI or on-demand | ❌ Absent (manual doc only) | Full build required |
| **G1 Static Analysis** | tsc strict + ESLint strict, 0 warnings, pre-commit | ⚠️ tsc only, no ESLint/Biome | Add linter |
| **G2 Security** | osv-scanner + gitleaks, pre-push | ❌ Absent | Full build required |
| **D1 Test Isolation** | Dedicated test resources, 4-layer verification | ❌ Absent | Design + implement |

**Current Tier: B** (L1 + G1-partial)
**Target Tier: A** (L1 + L2 + G1 + G2 + D1, with L3 optional/on-demand)

---

## Gap Analysis

### What's already solid (keep as-is)

1. **L1 Unit Tests** — 42 test files, 1,206 tests, 98.37% coverage, enforced via pre-commit
2. **tsc --noEmit** — Dual tsconfig check (root + web), zero errors
3. **Husky hooks** — Pre-commit and pre-push gates in place
4. **Dual test runner** — Vitest (Node) + bun test (Bun native) both pass
5. **Coverage thresholds** — 90% enforced on statements, branches, functions, lines

### What needs building

| Priority | Dimension | Effort | Dependencies |
|----------|-----------|--------|--------------|
| P0 | **G1 upgrade**: Add Biome (lint + format) | Small | None |
| P1 | **G2 Security**: Add osv-scanner + gitleaks | Small | None |
| P2 | **L2 API E2E**: All REST endpoints via real HTTP | Medium | D1 isolation |
| P3 | **D1 Test Isolation**: Dedicated D1-test database + R2-test bucket | Medium | CF account config |
| P4 | **L3 BDD E2E**: Playwright browser tests | Large | L2 + D1 done |
| P5 | **CI/CD**: GitHub Actions workflow | Medium | All above done |

---

## Design Decisions

### G1: Biome over ESLint

- **Why Biome**: Single binary, zero config, ~100x faster than ESLint, covers both lint + format
- **Migration path**: No existing ESLint to migrate from, clean start
- **Config**: `biome.json` at root, workspace-aware
- **Rules**: Start with `recommended` preset, suppress known false positives incrementally

### G2: osv-scanner over npm audit

- **Why osv-scanner**: Google's OSV database, supports Bun lockfile, JSON output for CI
- **gitleaks**: Pre-commit secret scanning, prevents accidental credential commits
- **Config**: `.gitleaks.toml` at root for custom allowlist patterns

### L2: API E2E Architecture

```
packages/web/tests/
├── e2e/
│   ├── setup.ts          # Start Next.js dev server on :17040, wait for ready
│   ├── teardown.ts        # Kill server, cleanup
│   ├── helpers.ts         # HTTP client, auth bypass, D1 seed/reset
│   ├── sessions.spec.ts   # GET /api/sessions — list, filter, pagination
│   ├── session-detail.spec.ts  # GET /api/sessions/{id}
│   ├── search.spec.ts     # GET /api/search — FTS queries
│   ├── stats.spec.ts      # GET /api/stats — aggregates
│   ├── ingest.spec.ts     # POST /api/ingest/sessions, PUT /api/ingest/content
│   ├── tags.spec.ts       # CRUD /api/tags, /api/sessions/{id}/tags
│   ├── stars.spec.ts      # POST/DELETE /api/sessions/{id}/star
│   └── cli-auth.spec.ts   # GET /api/auth/cli
├── vitest.e2e.config.ts   # Separate vitest config for E2E
```

- **Auth bypass**: `E2E_SKIP_AUTH=1` + `NODE_ENV=development` (already designed in doc 06)
- **Database**: Points to D1-test via `CF_D1_DATABASE_ID_TEST` env var
- **Isolation**: Each test file seeds its own data, teardown truncates tables

### D1: Test Isolation Strategy

```
Production:          D1 database "pika-prod"   + R2 bucket "pika-content"
Development:         D1 database "pika-dev"    + R2 bucket "pika-content-dev"
Test (E2E):          D1 database "pika-test"   + R2 bucket "pika-content-test"
```

**Four-layer verification** (from 6D spec):
1. **Binding verification**: Test setup asserts `CF_D1_DATABASE_ID` matches known test DB ID
2. **Environment override**: `E2E_DB=test` forces test connection string
3. **Runtime check**: D1 client queries `PRAGMA database_list` and asserts DB name contains "test"
4. **Marker table**: `_test_marker` table exists only in test DB, queried at startup

### L3: Playwright BDD (deferred to Phase 2)

Playwright tests cover core user flows:
- Login → dashboard → session list → session detail → replay
- Search → result click → jump to message
- Tag management → filter by tag

**Port**: 27040 (already reserved)

---

## Implementation Plan

### Phase 1: Gates + Security (G1 + G2)

**Goal**: Upgrade pre-commit to include Biome lint, add security scanning to pre-push.

#### Commit 9.1: `chore: add biome for lint and format`

**Files**:
- `biome.json` — Root config with recommended rules, workspace includes
- `package.json` — Add `@biomejs/biome` devDep, add `lint:biome` script
- `.vscode/settings.json` — (if exists) Add Biome as default formatter

**Config** (`biome.json`):
```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "files": {
    "include": ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"],
    "ignore": ["node_modules", ".next", "dist", "coverage"]
  }
}
```

**Verification**: `bunx biome check packages/` exits 0 (fix all existing violations first)

#### Commit 9.2: `fix: resolve biome lint violations`

**Files**: All `.ts`/`.tsx` files with violations (expected: unused imports, naming conventions, etc.)

**Approach**:
1. Run `bunx biome check --write packages/` for auto-fixable issues
2. Manually fix remaining violations
3. Add `// biome-ignore` comments ONLY for documented false positives

**Verification**: `bunx biome check packages/` exits 0, `bun test` still passes

#### Commit 9.3: `chore: add gitleaks for secret scanning`

**Files**:
- `.gitleaks.toml` — Config with custom allowlist (test fixtures, example URLs)
- `package.json` — Add `lint:secrets` script

**Script**: `"lint:secrets": "gitleaks detect --source . --no-git --config .gitleaks.toml"`

**Prerequisite**: `brew install gitleaks` (document in README or CLAUDE.md)

**Verification**: `bun run lint:secrets` exits 0

#### Commit 9.4: `chore: add osv-scanner for dependency audit`

**Files**:
- `package.json` — Add `lint:deps` script
- `.osv-scanner.toml` — (if needed) Ignore known acceptable vulnerabilities

**Script**: `"lint:deps": "osv-scanner --lockfile=bun.lock"`

**Prerequisite**: `brew install osv-scanner`

**Verification**: `bun run lint:deps` exits 0 (or documents known exceptions)

#### Commit 9.5: `chore: upgrade git hooks with G1+G2 gates`

**Files**:
- `.husky/pre-commit` — Add Biome check after test:coverage
- `.husky/pre-push` — Add gitleaks + osv-scanner after lint
- `package.json` — Add `lint:all` convenience script

**Updated hooks**:

```sh
# pre-commit: L1 + G1
bun run test:coverage          # L1: UT ≥90%
bunx biome check packages/     # G1: lint + format

# pre-push: L1 + G1 + G2
bun run test:coverage          # L1: UT ≥90%
bun run lint                   # G1: tsc --noEmit
bunx biome check packages/     # G1: lint + format
bun run lint:secrets           # G2: gitleaks
bun run lint:deps              # G2: osv-scanner
```

**Verification**: Commit and push both succeed with all gates passing

---

### Phase 2: Test Isolation (D1)

**Goal**: Dedicated test resources on Cloudflare, with four-layer verification.

#### Commit 9.6: `feat: create D1-test database and R2-test bucket`

**Files**:
- `scripts/setup-test-env.sh` — Wrangler commands to create test D1 + R2
- `scripts/migrations/` — Apply migrations to test DB
- `docs/09-quality-upgrade-6d.md` — Record test resource IDs

**Commands**:
```bash
wrangler d1 create pika-test
wrangler r2 bucket create pika-content-test
wrangler d1 execute pika-test --file scripts/migrations/001-init.sql
wrangler d1 execute pika-test --file scripts/migrations/002-tags.sql
```

**Verification**: `wrangler d1 execute pika-test --command "SELECT name FROM sqlite_master WHERE type='table'"` shows all expected tables

#### Commit 9.7: `feat: add test isolation verification to D1 client`

**Files**:
- `packages/web/src/lib/d1.ts` — Add `assertTestDatabase()` function
- `packages/web/src/lib/d1.test.ts` — Test isolation assertions

**Implementation**:
```typescript
export async function assertTestDatabase(): Promise<void> {
  // 1. Env binding check
  const dbId = process.env.CF_D1_DATABASE_ID;
  if (!dbId?.includes("test")) {
    throw new Error(`D1 isolation: DB ID ${dbId} does not contain "test"`);
  }

  // 2. Marker table check
  const result = await d1Query(
    "SELECT name FROM sqlite_master WHERE name = '_test_marker'"
  );
  if (result.length === 0) {
    throw new Error("D1 isolation: _test_marker table not found");
  }
}
```

**Verification**: Function passes against test DB, throws against prod DB

#### Commit 9.8: `feat: add _test_marker migration for D1-test`

**Files**:
- `scripts/migrations/099-test-marker.sql` — Creates `_test_marker` table (only applied to test DB)

**SQL**:
```sql
CREATE TABLE IF NOT EXISTS _test_marker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (id = 1)
);
INSERT OR IGNORE INTO _test_marker (id) VALUES (1);
```

**Verification**: Table exists in test DB, does NOT exist in prod/dev DB

---

### Phase 3: API E2E Tests (L2)

**Goal**: Real HTTP tests against all REST API endpoints using test D1/R2.

#### Commit 9.9: `feat: add vitest e2e config and test harness`

**Files**:
- `packages/web/vitest.e2e.config.ts` — Separate vitest config for E2E
- `packages/web/tests/e2e/setup.ts` — Global setup: start Next.js on :17040
- `packages/web/tests/e2e/teardown.ts` — Global teardown: kill server
- `packages/web/tests/e2e/helpers.ts` — HTTP client, seed helpers, auth mock
- `package.json` — Add `test:e2e` script

**Config** (`vitest.e2e.config.ts`):
```typescript
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.spec.ts"],
    globalSetup: ["tests/e2e/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      E2E_SKIP_AUTH: "1",
      NODE_ENV: "development",
      CF_D1_DATABASE_ID: "<pika-test-id>",
      CF_R2_BUCKET: "pika-content-test",
      PORT: "17040",
    },
  },
});
```

**Script**: `"test:e2e": "vitest run --config packages/web/vitest.e2e.config.ts"`

**Verification**: Setup starts server, teardown kills it cleanly, `bun run test:e2e` runs (0 tests initially)

#### Commit 9.10: `feat: add L2 API E2E tests for sessions endpoints`

**Files**:
- `packages/web/tests/e2e/sessions.spec.ts` — GET /api/sessions (list, filter, pagination)
- `packages/web/tests/e2e/session-detail.spec.ts` — GET /api/sessions/{id}

**Coverage**: List all sessions, filter by source, paginate, get detail with content URL

**Verification**: `bun run test:e2e` passes, both endpoints covered

#### Commit 9.11: `feat: add L2 API E2E tests for search + stats`

**Files**:
- `packages/web/tests/e2e/search.spec.ts` — GET /api/search (FTS queries, snippets)
- `packages/web/tests/e2e/stats.spec.ts` — GET /api/stats (aggregate values)

**Verification**: `bun run test:e2e` passes, search returns ranked results, stats return correct aggregates

#### Commit 9.12: `feat: add L2 API E2E tests for ingest + tags + stars`

**Files**:
- `packages/web/tests/e2e/ingest.spec.ts` — POST /api/ingest/sessions, PUT /api/ingest/content
- `packages/web/tests/e2e/tags.spec.ts` — CRUD tags, add/remove from sessions
- `packages/web/tests/e2e/stars.spec.ts` — Star/unstar sessions

**Verification**: `bun run test:e2e` passes, all write endpoints tested

#### Commit 9.13: `feat: add L2 API E2E test for cli-auth`

**Files**:
- `packages/web/tests/e2e/cli-auth.spec.ts` — GET /api/auth/cli

**Verification**: `bun run test:e2e` passes, 100% endpoint coverage achieved

#### Commit 9.14: `chore: add L2 to pre-push hook`

**Files**:
- `.husky/pre-push` — Add `bun run test:e2e` after unit tests
- `package.json` — Add `test:all` script combining L1 + L2

**Updated pre-push**:
```sh
# L1: UT
bun run test:coverage
# G1: Type check + Lint
bun run lint
bunx biome check packages/
# L2: API E2E
bun run test:e2e
# G2: Security
bun run lint:secrets
bun run lint:deps
```

**Verification**: `git push` triggers full L1+G1+L2+G2 gate, all pass

---

### Phase 4: CI/CD Pipeline (optional, post-local-gates)

**Goal**: GitHub Actions as safety net for contributors without Husky.

#### Commit 9.15: `chore: add github actions ci workflow`

**Files**:
- `.github/workflows/ci.yml` — Reusable workflow

**Workflow**:
```yaml
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run test:coverage     # L1
      - run: bun run lint              # G1: tsc
      - run: bunx biome check packages/ # G1: biome
      - run: bun run lint:deps         # G2: osv-scanner
      # L2 (API E2E) requires CF credentials — run in separate job or skip in CI
```

**Verification**: Push to branch triggers CI, all checks green

---

## Hook Summary (Final State)

| Hook | Gates | Max Time |
|------|-------|----------|
| **pre-commit** | L1 (UT ≥90%) + G1 (Biome) | <30s |
| **pre-push** | L1 + G1 (tsc + Biome) + L2 (API E2E) + G2 (gitleaks + osv-scanner) | <3min |
| **CI** | L1 + G1 + G2 | <5min |
| **On demand** | L3 (Playwright BDD) | <10min |

## Tier Progression

```
Current:  Tier B  — L1 + G1(partial)
After Phase 1:  Tier B+ — L1 + G1(full) + G2
After Phase 2:  Tier B+ — + D1 isolation
After Phase 3:  Tier A  — L1 + L2 + G1 + G2 + D1
After Phase 4:  Tier A  — + CI safety net
Future:         Tier S  — + L3 Playwright
```

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Biome has false positives on existing code | Run `biome check --write` first, suppress documented false positives |
| gitleaks flags test fixtures with mock secrets | Add allowlist patterns in `.gitleaks.toml` |
| osv-scanner flags transitive deps we can't fix | Document in `.osv-scanner.toml` with justification |
| API E2E needs real CF credentials | Use test-specific D1/R2, env vars in `.env.test` (gitignored) |
| Pre-push >3min with L2 added | Monitor timing; parallelize if needed |
| Biome version 2.0 breaking changes | Pin version in devDependencies |
