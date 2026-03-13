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
        "**/commands/*.ts",
        "**/node_modules/**",
        "packages/web/src/app/**",
        "packages/web/src/lib/auth.ts",
        "packages/web/src/lib/d1.ts",
        "packages/web/src/lib/version.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
