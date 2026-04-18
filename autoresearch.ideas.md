# Ideas backlog — pre-commit/pre-push perf

- Use `vitest run --coverage --pool=threads --isolate=false` to share workers.
- Switch coverage provider to `v8` already in use — try `--coverage.reporter=text-summary` only (skip HTML/json) to save IO.
- Use TypeScript project references + `tsc -b --incremental` to make `bun run lint` near-instant on warm cache.
- Run `lint:secrets`, `lint:deps`, `tsc`, `biome` in parallel inside the pre-push hook (independent, all fail-fast via `wait -n`).
- Inside pre-push, skip `test:coverage` if pre-commit already ran in the same git index state (use a sha cache file under `.git/`).
- `bun run build` runs `next build` which is the dominant cost — investigate `next build --turbopack` or skip the web build at pre-push (rely on CI for the canonical build) — but spec says pre-push must mirror CI; keep build but try faster modes.
- Use Biome's incremental cache; ensure `--reporter=summary`.
- Replace `bunx biome` with the local binary path to avoid bunx resolution (~50ms).
- Replace `bunx vitest` cold-start by running vitest via the local node_modules entrypoint.
- gitleaks: `--no-banner --redact` and tighter path filters; or stage-only mode at pre-commit.
- osv-scanner: cache results keyed on bun.lock hash; only re-scan on lock change.
