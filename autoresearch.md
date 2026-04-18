# Autoresearch: Speed up pre-commit / pre-push hooks

## Objective
Make `.husky/pre-commit` and `.husky/pre-push` faster end-to-end while keeping
the same correctness guarantees. The hooks currently run:

- **pre-commit**: `bun run test:coverage` + `bunx biome check packages/`
- **pre-push**: `bun run build` + `bun run test:coverage` + `bun run lint` (tsc) +
  `bunx biome check packages/` + `bun run lint:secrets` + `bun run lint:deps` +
  `bun run test:e2e`

The benchmark harness measures every phase except `test:e2e` (which needs
Cloudflare credentials + a live Worker, so cannot run in this loop). E2E perf
work, if any, must be reasoned about analytically and verified out-of-band.

## Metrics
- **Primary**: `total_ms` — pre-commit duration + pre-push duration (the cost
  a developer pays per commit-then-push). Lower is better.
- **Secondary**:
  - `precommit_ms`, `prepush_ms` — split totals
  - `test_coverage_ms`, `biome_ms`, `build_ms`, `tsc_ms`, `secrets_ms`, `deps_ms`
    — per-phase wall time

`total_ms` deliberately double-counts the shared phases (test:coverage, biome)
because both hooks really do run them sequentially in real life.

## How to Run
`./autoresearch.sh` — outputs `METRIC name=value` lines and exits non-zero if
any phase fails. Each phase's stdout/stderr is captured to a tmp file and only
shown when it fails.

## Files in Scope
- `.husky/pre-commit`, `.husky/pre-push` — hook scripts (can be reorganised, but
  must keep the same set of guarantees).
- `package.json` — root scripts (`test:coverage`, `lint`, `lint:biome`,
  `lint:secrets`, `lint:deps`, `build`).
- `vitest.config.ts` — unit-test config (pool, isolate, coverage provider, etc.).
- `packages/web/vitest.e2e.config.ts` — e2e config (out of bench scope).
- `packages/*/tsconfig.json`, root `tsconfig.json` — for tsc speedups
  (incremental, project references, etc.).
- `packages/*/package.json` build scripts.
- `biome.json` (if present) — biome configuration.
- `.gitleaks.toml`, `.osv-scanner.toml` — scanner configs.
- `autoresearch.sh`, `autoresearch.md`, `autoresearch.ideas.md` — bench harness
  and notes.

## Off Limits
- `packages/web/tests/e2e/**` and `packages/web/vitest.e2e.config.ts`
  (cannot validate locally without Cloudflare creds).
- Removing test files / lowering coverage thresholds / disabling lint rules /
  excluding source files from biome/tsc/scanners just to win the benchmark.
- Skipping any of the existing hook checks. We can reorder, parallelise,
  cache, or speed up tooling, but the guarantees must hold.

## Constraints
- All existing tests must continue to pass with the same coverage thresholds
  (`statements 95 / branches 90 / functions 95 / lines 95`).
- `bun run lint` (tsc), `bunx biome check packages/`, `lint:secrets`, and
  `lint:deps` must continue to pass with the same scope.
- `bun run build` must continue to produce the same outputs.
- No new heavyweight dependencies. Tightening dev-dep versions is fine.
- Atomic commits per change. Do **not** push.

## What's Been Tried
_(Update as experiments accumulate.)_

## Ideas Backlog
See `autoresearch.ideas.md`.
