import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["packages/web/tests/e2e/**/*.spec.ts"],
    globalSetup: ["packages/web/tests/e2e/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000, // Increased for D1 REST API cleanup calls
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
