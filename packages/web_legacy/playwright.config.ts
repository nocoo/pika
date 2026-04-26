import { defineConfig, devices } from "@playwright/test";

const PORT = 27022;

export default defineConfig({
  testDir: "./e2e/bdd",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `E2E_SKIP_AUTH=true PORT=${PORT} bun run next dev -p ${PORT}`,
    port: PORT,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
    env: {
      ...process.env,
      E2E_SKIP_AUTH: "true",
      NODE_ENV: "development",
    },
  },
});
