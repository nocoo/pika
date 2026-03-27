/**
 * E2E global setup — start Next.js dev server on port 17040 with test env.
 *
 * Loads .env.test (test D1/R2 credentials + E2E_SKIP_AUTH=true),
 * verifies D1 + R2 isolation, then boots the dev server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 17040;
const WEB_DIR = resolve(__dirname, "../..");
const BASE_URL = `http://localhost:${PORT}`;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

/** Known test resource IDs — hard-coded to prevent misconfiguration. */
const TEST_DB_ID = "f52931ad-9c96-4d04-9d0a-3098a800ce5e";
const TEST_BUCKET_NAME = "pika-test";

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

/**
 * D1 + R2 isolation verification — 3 layers.
 *
 * Layer 1: CF_D1_DATABASE_ID must match the known test DB ID.
 * Layer 2: _test_marker table must exist in the database.
 * Layer 3: CF_R2_BUCKET must match the known test bucket name.
 *
 * If any check fails, the entire E2E suite is aborted to prevent
 * accidental reads/writes to production resources.
 */
async function verifyTestIsolation(
  testEnv: Record<string, string>,
): Promise<void> {
  // Layer 1: D1 env binding check
  if (testEnv.CF_D1_DATABASE_ID !== TEST_DB_ID) {
    throw new Error(
      `D1 isolation FAILED: CF_D1_DATABASE_ID="${testEnv.CF_D1_DATABASE_ID}" does not match test DB "${TEST_DB_ID}"`,
    );
  }

  // Layer 2: D1 marker table check (query the actual database)
  const url = `https://api.cloudflare.com/client/v4/accounts/${testEnv.CF_ACCOUNT_ID}/d1/database/${testEnv.CF_D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${testEnv.CF_D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='_test_marker'",
      params: [],
    }),
  });

  const data = (await res.json()) as {
    success: boolean;
    result?: Array<{ results?: Array<{ name: string }> }>;
  };

  if (
    !data.success ||
    !data.result?.[0]?.results?.length
  ) {
    throw new Error(
      "D1 isolation FAILED: _test_marker table not found — this may not be the test database",
    );
  }

  // Layer 3: R2 bucket name check
  if (testEnv.CF_R2_BUCKET !== TEST_BUCKET_NAME) {
    throw new Error(
      `R2 isolation FAILED: CF_R2_BUCKET="${testEnv.CF_R2_BUCKET}" does not match test bucket "${TEST_BUCKET_NAME}"`,
    );
  }

  console.log(
    `[E2E] Isolation verified: D1=${TEST_DB_ID.slice(0, 8)}… R2=${TEST_BUCKET_NAME}`,
  );
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

  // Verify D1 + R2 isolation BEFORE starting anything
  await verifyTestIsolation(testEnv);

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
