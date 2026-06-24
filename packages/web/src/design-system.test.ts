import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// B05 retrospective:
// L0 bg < L1 card < L2 secondary < L3 input/accent. A clickable row that
// already sits on bg-secondary (L2 inner panel) must hover toward a
// LIGHTER token, not a darker one — otherwise "press to dim" feels wrong.
// We saw this regress in commit 6735167 ("unify card hover hover:bg-accent/50
// -> hover:bg-background/50"), which lost the L2 context and inverted
// hierarchy on 5 cards. This test pins the rule across the web package.

const ROOT = resolve(__dirname, "..");
const SKIP = new Set([
  "node_modules",
  "dist",
  "coverage",
  "__snapshots__",
  ".vite",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("design-system: hover token on L2 containers", () => {
  it("no `bg-secondary` element is paired with `hover:bg-background` on the same className", () => {
    const files = walk(ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Match a string literal that contains BOTH `bg-secondary` and
      // `hover:bg-background`. Tailwind classNames live in template strings,
      // cn() args, and clsx() args — all are JS string literals.
      const matches = src.match(
        /["'`][^"'`]*\bbg-secondary\b[^"'`]*\bhover:bg-background\b[^"'`]*["'`]/g,
      );
      const reverseMatches = src.match(
        /["'`][^"'`]*\bhover:bg-background\b[^"'`]*\bbg-secondary\b[^"'`]*["'`]/g,
      );
      if (matches || reverseMatches) {
        offenders.push(file.replace(`${ROOT}/`, ""));
      }
    }

    expect(
      offenders,
      `L2-on-darker-hover regression in: ${offenders.join(", ")}\n` +
        "Use hover:bg-accent/50 instead — bg-accent is L3 (lighter than L2),\n" +
        "matching the 4-tier luminance scale defined in CLAUDE.md retrospective.",
    ).toEqual([]);
  });
});
