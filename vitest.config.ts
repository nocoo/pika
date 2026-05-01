import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/migration.test.ts"],
    coverage: {
      provider: "v8",
      // experimentalAstAwareRemapping reduces variance and slightly improves
      // wall-clock by avoiding the legacy source-map-based remap path.
      experimentalAstAwareRemapping: true,
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        // Test files — themselves not subject to coverage.
        "**/*.test.ts",
        "**/*.spec.ts",
        // TSX files — already outside `include` (which only matches *.ts);
        // listed here defensively in case the include pattern is widened.
        "**/*.tsx",
        // ---------------------------------------------------------------------------
        // CLI entry points — bin.ts / cli.ts wire up process.argv and exit codes.
        // Bootstrap glue with system calls; not meaningfully unit-testable.
        // ---------------------------------------------------------------------------
        "**/bin.ts",
        "**/cli.ts",
        // Barrel re-exports — no executable logic.
        "**/index.ts",
        // ---------------------------------------------------------------------------
        // Server bootstrap — long-lived process with side effects (listen, signal
        // handlers). Not meaningfully unit-testable.
        // ---------------------------------------------------------------------------
        "**/server.ts",
        // Pure type declarations — no runtime code to cover.
        "**/types.ts",
        // ---------------------------------------------------------------------------
        // Command modules — defineCommand `run` functions are CLI orchestrators
        // that shell out to child processes / file system / network. Core logic
        // is extracted to testable modules; the command handlers themselves
        // are integration glue and not unit-testable in isolation.
        // ---------------------------------------------------------------------------
        "**/commands/*.ts",
        "**/commands/**/*.ts",
        // Vendored dependencies — not our code.
        "**/node_modules/**",
        // ---------------------------------------------------------------------------
        // Core package — when running CLI-package coverage, core sources are
        // imported but their behavior is verified by the core package's own
        // test suite. Excluding here avoids double-counting and false dips.
        // ---------------------------------------------------------------------------
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
