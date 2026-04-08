import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/migration.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.tsx",
        "**/bin.ts",
        "**/cli.ts",
        "**/index.ts",
        "**/types.ts",
        // Exclude command files (they contain defineCommand run functions which are CLI entry points)
        "**/commands/*.ts",
        "**/commands/**/*.ts",
        "**/node_modules/**",
        "packages/web/src/app/**",
        "packages/web/src/lib/auth.ts",
        "packages/web/src/lib/d1.ts",
        "packages/web/src/lib/version.ts",
        // Exclude core package from CLI tests (covered by core tests)
        "packages/core/src/**",
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
