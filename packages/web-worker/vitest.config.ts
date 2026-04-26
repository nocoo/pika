import { defineConfig } from "vitest/config";

// Local vitest config so `bun run --cwd packages/web-worker test` works
// regardless of cwd. Root vitest.config.ts uses repo-relative globs that
// don't resolve from this directory.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
