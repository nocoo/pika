#!/usr/bin/env bun
//
// sync-versions.ts — Sync all sub-package versions from root package.json.
//
// Usage:
//   bun run sync-versions          # dry-run (shows diff)
//   bun run sync-versions --write  # apply changes
//
// Reads the root package.json "version" field (single source of truth)
// and updates every packages/*/package.json to match.
//

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname!, "..");
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const version: string = rootPkg.version;
const write = process.argv.includes("--write");

const packagesDir = join(ROOT, "packages");
const dirs = readdirSync(packagesDir).filter((d) =>
  statSync(join(packagesDir, d)).isDirectory(),
);

let changed = 0;

for (const dir of dirs) {
  const pkgPath = join(packagesDir, dir, "package.json");
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf-8");
  } catch {
    continue; // no package.json in this directory
  }

  const pkg = JSON.parse(raw);
  if (pkg.version === version) {
    console.log(`  ✓ packages/${dir} already ${version}`);
    continue;
  }

  changed++;
  console.log(`  → packages/${dir}: ${pkg.version} → ${version}`);

  if (write) {
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

if (changed === 0) {
  console.log(`\nAll packages already at v${version}`);
} else if (write) {
  console.log(`\nUpdated ${changed} package(s) to v${version}`);
} else {
  console.log(`\n${changed} package(s) need updating. Run with --write to apply.`);
}
