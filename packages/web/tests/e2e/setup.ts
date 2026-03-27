/**
 * E2E global setup — start Next.js dev server on port 17040 with test env.
 *
 * Loads .env.test (test D1/R2 credentials + E2E_SKIP_AUTH=true),
 * verifies DB isolation, then boots the dev server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 17040;
const WEB_DIR = resolve(__dirname, "../..");
const BASE_URL = `http://localhost:${PORT}`;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

let serverProcess: ChildProcess | undefined;

/** Parse .env.test and return as Record */
function loadEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return env;
}

/** Wait for server to respond on /api/live */
async function waitForServer(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/api/live`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`E2E server did not start within ${MAX_WAIT_MS}ms`);
}

export async function setup() {
  // Load test env
  const testEnv = loadEnvFile(resolve(WEB_DIR, ".env.test"));

  // Verify isolation: DB ID must be the test database
  const TEST_DB_ID = "f52931ad-9c96-4d04-9d0a-3098a800ce5e";
  if (testEnv.CF_D1_DATABASE_ID !== TEST_DB_ID) {
    throw new Error(
      `E2E setup: .env.test CF_D1_DATABASE_ID="${testEnv.CF_D1_DATABASE_ID}" does not match test DB "${TEST_DB_ID}"`,
    );
  }

  // Export test env vars so helpers.ts can access D1 directly
  for (const [key, value] of Object.entries(testEnv)) {
    process.env[key] = value;
  }

  // Check if port is already in use
  try {
    const res = await fetch(`${BASE_URL}/api/live`);
    if (res.ok) {
      console.log(`[E2E] Server already running on port ${PORT}, reusing.`);
      process.env.E2E_BASE_URL = BASE_URL;
      return;
    }
  } catch {
    // Port free, proceed to start
  }

  console.log(`[E2E] Starting Next.js dev server on port ${PORT}...`);

  // Merge test env into server process env
  const serverEnv = {
    ...process.env,
    ...testEnv,
    PORT: String(PORT),
    NODE_ENV: "development" as const,
  };

  const proc = spawn("bun", ["run", "next", "dev", "-p", String(PORT)], {
    cwd: WEB_DIR,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = proc;

  // Forward server output for debugging
  proc.stdout!.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[E2E server] ${msg}`);
  });
  proc.stderr!.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[E2E server] ${msg}`);
  });

  proc.on("error", (err) => {
    console.error("[E2E] Failed to start server:", err);
  });

  await waitForServer();
  console.log(`[E2E] Server ready on ${BASE_URL}`);

  // Export for test files
  process.env.E2E_BASE_URL = BASE_URL;
}

export async function teardown() {
  if (serverProcess) {
    console.log("[E2E] Stopping dev server...");
    serverProcess.kill("SIGTERM");

    // Wait briefly for graceful shutdown
    await new Promise((r) => setTimeout(r, 1000));

    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }

    serverProcess = undefined;
    console.log("[E2E] Server stopped.");
  }
}
