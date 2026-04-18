#!/usr/bin/env bun
/**
 * L2 API E2E Test Runner
 *
 * Wraps `vitest run --config packages/web/vitest.e2e.config.ts` with a
 * graceful soft-gate so the same command works in both contexts:
 *
 *   - Local (developer machine):
 *       `packages/web/.env.test` is present and contains real credentials
 *       (WORKER_URL, CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN).
 *       The runner detects the file and runs the full E2E suite.
 *
 *   - CI (no secrets configured):
 *       Neither `packages/web/.env.test` nor the equivalent env vars are
 *       present. The runner prints a skip notice and exits 0 so the L2
 *       job stays green until the workspace owner wires up the secrets.
 *
 * This mirrors the soft-gate pattern used by sibling projects (otter, etc.)
 * and lets us flip `enable-l2: "true"` in `.github/workflows/ci.yml` today
 * without blocking PRs on missing CI secrets.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ENV_FILE = resolve(import.meta.dir, "..", "packages/web/.env.test");
const REQUIRED_ENV = [
  "WORKER_URL",
  "CF_ACCOUNT_ID",
  "CF_D1_DATABASE_ID",
  "CF_D1_API_TOKEN",
] as const;

function hasEnvFile(): boolean {
  return existsSync(ENV_FILE);
}

function hasInlineEnv(): boolean {
  return REQUIRED_ENV.every((k) => !!process.env[k]);
}

function main(): number {
  if (!hasEnvFile() && !hasInlineEnv()) {
    console.log(
      "⏭️  L2 API E2E skipped — no packages/web/.env.test and required env vars not set.",
    );
    console.log(`   Required: ${REQUIRED_ENV.join(", ")}`);
    return 0;
  }

  console.log("🧪 Running L2 API E2E tests…");
  const result = spawnSync(
    "bunx",
    ["vitest", "run", "--config", "packages/web/vitest.e2e.config.ts"],
    { stdio: "inherit" },
  );
  return result.status ?? 1;
}

process.exit(main());
