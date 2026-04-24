/**
 * E2E global setup — verifies Worker health, starts Next.js + api dev servers.
 *
 * E2E tests run against the production Worker and D1 database, but all
 * test data is isolated by user_id = 'e2e-test-user-id'. This avoids the
 * complexity of maintaining a separate test infrastructure while ensuring
 * E2E data never mixes with real user data.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NEXT_PORT = 17022;
const API_PORT = 17023;
const WEB_DIR = resolve(__dirname, "../..");
const API_DIR = resolve(WEB_DIR, "../api");
const NEXT_BASE_URL = `http://localhost:${NEXT_PORT}`;
const API_BASE_URL = `http://localhost:${API_PORT}`;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

let nextProcess: ChildProcess | undefined;
let apiProcess: ChildProcess | undefined;

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

/** Check if Worker is reachable */
async function checkWorkerHealth(workerUrl: string): Promise<void> {
  const liveUrl = workerUrl.replace(/\/$/, "") + "/live";
  try {
    const res = await fetch(liveUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      throw new Error(`Worker returned ${res.status}`);
    }
    console.log(`[E2E] Worker health check passed: ${workerUrl}`);
  } catch (err) {
    throw new Error(
      `Worker not reachable at ${workerUrl}. ` +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Wait for server to respond */
async function waitForServer(url: string, name: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${name} did not start within ${MAX_WAIT_MS}ms`);
}

/** Check if port is already in use */
async function isPortInUse(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

export async function setup() {
  // Load test env
  const testEnv = loadEnvFile(resolve(WEB_DIR, ".env.test"));

  // Export test env vars so helpers.ts can access D1 directly
  for (const [key, value] of Object.entries(testEnv)) {
    process.env[key] = value;
  }

  // ── Verify Worker is running ─────────────────────────────────

  const workerUrl = testEnv.WORKER_URL;
  if (!workerUrl) {
    throw new Error("WORKER_URL not set in .env.test");
  }
  await checkWorkerHealth(workerUrl);

  // ── Start Next.js ─────────────────────────────────────────────

  const nextUrl = `${NEXT_BASE_URL}/api/live`;
  const nextRunning = await isPortInUse(nextUrl);

  if (nextRunning) {
    console.log(`[E2E] Next.js already running on port ${NEXT_PORT}, reusing.`);
  } else {
    console.log(`[E2E] Starting Next.js dev server on port ${NEXT_PORT}...`);

    const serverEnv = {
      ...process.env,
      ...testEnv,
      PORT: String(NEXT_PORT),
      NODE_ENV: "development" as const,
    };

    nextProcess = spawn("bun", ["run", "next", "dev", "-p", String(NEXT_PORT)], {
      cwd: WEB_DIR,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    nextProcess.stdout!.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[E2E next] ${msg}`);
    });
    nextProcess.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[E2E next] ${msg}`);
    });

    nextProcess.on("error", (err) => {
      console.error("[E2E] Failed to start Next.js:", err);
    });

    await waitForServer(nextUrl, "Next.js");
    console.log(`[E2E] Next.js ready on ${NEXT_BASE_URL}`);
  }

  // ── Start api (Hono on Bun) ──────────────────────────────────

  const apiUrl = `${API_BASE_URL}/live`;
  const apiRunning = await isPortInUse(apiUrl);

  if (apiRunning) {
    console.log(`[E2E] api already running on port ${API_PORT}, reusing.`);
  } else {
    console.log(`[E2E] Starting api dev server on port ${API_PORT}...`);

    const apiEnv = {
      ...process.env,
      ...testEnv,
      PORT: String(API_PORT),
      NODE_ENV: "development" as const,
      E2E_SKIP_AUTH: "true",
    };

    apiProcess = spawn("bun", ["run", "src/server.ts"], {
      cwd: API_DIR,
      env: apiEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    apiProcess.stdout!.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[E2E api] ${msg}`);
    });
    apiProcess.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[E2E api] ${msg}`);
    });

    apiProcess.on("error", (err) => {
      console.error("[E2E] Failed to start api:", err);
    });

    await waitForServer(apiUrl, "api");
    console.log(`[E2E] api ready on ${API_BASE_URL}`);
  }

  // Export for test files
  process.env.E2E_BASE_URL = NEXT_BASE_URL;
  process.env.E2E_WEB_BASE_URL = NEXT_BASE_URL;
  process.env.E2E_API_BASE_URL = API_BASE_URL;
}

export async function teardown() {
  if (nextProcess) {
    console.log("[E2E] Stopping Next.js dev server...");
    nextProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    if (!nextProcess.killed) nextProcess.kill("SIGKILL");
    nextProcess = undefined;
    console.log("[E2E] Next.js stopped.");
  }
  if (apiProcess) {
    console.log("[E2E] Stopping api dev server...");
    apiProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    if (!apiProcess.killed) apiProcess.kill("SIGKILL");
    apiProcess = undefined;
    console.log("[E2E] api stopped.");
  }
}
