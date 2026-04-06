#!/usr/bin/env bun
/**
 * release.ts — Bump CLI version and sync across the monorepo.
 *
 * Usage:
 *   bun scripts/release.ts patch     # 0.6.3 → 0.6.4
 *   bun scripts/release.ts minor     # 0.6.3 → 0.7.0
 *   bun scripts/release.ts major     # 0.6.3 → 1.0.0
 *   bun scripts/release.ts 0.7.0     # explicit version
 *
 * What it does:
 *   1. Read current version from packages/cli/package.json
 *   2. Compute new version (bump or explicit)
 *   3. Update packages/cli/package.json
 *   4. Update root package.json (PIKA_VERSION reads from here)
 *   5. Run `bun install` to update bun.lock
 *   6. Print next steps (commit, push, npm publish)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = join(import.meta.dirname!, "..");
const CLI_PKG_PATH = join(ROOT, "packages/cli/package.json");
const ROOT_PKG_PATH = join(ROOT, "package.json");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function parseVersion(v: string): [number, number, number] {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: ${v}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function bumpVersion(
  current: string,
  type: "patch" | "minor" | "major"
): string {
  const [major, minor, patch] = parseVersion(current);
  switch (type) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
  }
}

// --- Main ---

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun scripts/release.ts <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

const cliPkg = readJson(CLI_PKG_PATH);
const rootPkg = readJson(ROOT_PKG_PATH);
const currentVersion = cliPkg.version as string;

let newVersion: string;
if (arg === "patch" || arg === "minor" || arg === "major") {
  newVersion = bumpVersion(currentVersion, arg);
} else if (/^\d+\.\d+\.\d+$/.test(arg)) {
  newVersion = arg;
} else {
  console.error(`Invalid argument: ${arg}`);
  console.error("Usage: bun scripts/release.ts <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

console.log(`\n📦 Releasing @nocoo/pika`);
console.log(`   ${currentVersion} → ${newVersion}\n`);

// Update packages/cli/package.json
cliPkg.version = newVersion;
writeJson(CLI_PKG_PATH, cliPkg);
console.log(`   ✓ packages/cli/package.json`);

// Update root package.json (PIKA_VERSION source)
rootPkg.version = newVersion;
writeJson(ROOT_PKG_PATH, rootPkg);
console.log(`   ✓ package.json (root)`);

// Run bun install to update lockfile
console.log(`   ⏳ Updating bun.lock...`);
execSync("bun install", { cwd: ROOT, stdio: "inherit" });
console.log(`   ✓ bun.lock`);

console.log(`
✅ Version bumped to ${newVersion}

Next steps:
  1. git add -A && git commit -m "chore: release v${newVersion}"
  2. git push
  3. cd packages/cli && npm publish
`);
