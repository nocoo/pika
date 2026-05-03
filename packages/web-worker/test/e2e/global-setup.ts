import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 17022;
const PERSIST_DIR = resolve(__dirname, "../../.wrangler/e2e");
const WORKER_ROOT = resolve(__dirname, "../..");
const MIGRATIONS_DIR = resolve(WORKER_ROOT, "../../scripts/migrations");
const DEV_VARS_PATH = resolve(WORKER_ROOT, ".dev.vars.e2e");

let wranglerProcess: ChildProcess | null = null;

export async function setup() {
  // Layer 1: env guard
  if (process.env.CI && process.env.SKIP_E2E === "true") {
    throw new Error("E2E tests skipped via SKIP_E2E=true");
  }

  // Layer 2: clean persist dir
  if (existsSync(PERSIST_DIR)) {
    rmSync(PERSIST_DIR, { recursive: true });
  }
  mkdirSync(PERSIST_DIR, { recursive: true });

  // Layer 3: apply migrations to local D1
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}-.+\.sql$/.test(f))
    .sort();

  for (const file of migrationFiles) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    execSync(
      `npx wrangler d1 execute pika-db --local --persist-to=${PERSIST_DIR} --command="${sql.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
      { cwd: WORKER_ROOT, stdio: "pipe" },
    );
  }

  // Layer 4: apply test marker
  const markerSql = readFileSync(
    resolve(__dirname, "fixtures/test_marker.sql"),
    "utf-8",
  );
  execSync(
    `npx wrangler d1 execute pika-db --local --persist-to=${PERSIST_DIR} --command="${markerSql.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
    { cwd: WORKER_ROOT, stdio: "pipe" },
  );

  // Layer 5: write .dev.vars for local wrangler
  writeFileSync(
    DEV_VARS_PATH,
    [
      "ENVIRONMENT=test",
      "E2E_SKIP_AUTH=true",
    ].join("\n"),
  );

  // Start wrangler dev in local mode
  wranglerProcess = spawn(
    "npx",
    [
      "wrangler", "dev",
      "--port", String(PORT),
      "--local",
      `--persist-to=${PERSIST_DIR}`,
      `--var=ENVIRONMENT:test`,
      `--var=E2E_SKIP_AUTH:true`,
    ],
    {
      cwd: WORKER_ROOT,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    },
  );

  // Wait for ready
  await waitForReady(wranglerProcess, PORT);
}

export async function teardown() {
  if (wranglerProcess) {
    wranglerProcess.kill("SIGTERM");
    wranglerProcess = null;
  }
  // Clean up .dev.vars.e2e
  if (existsSync(DEV_VARS_PATH)) {
    rmSync(DEV_VARS_PATH);
  }
}

async function waitForReady(proc: ChildProcess, port: number): Promise<void> {
  const timeoutMs = 30_000;
  const start = Date.now();

  return new Promise<void>((resolve, reject) => {
    let output = "";

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Ready on") || output.includes(`localhost:${port}`)) {
        cleanup();
        resolve();
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(new Error(`Wrangler failed to start: ${err.message}\n${output}`));
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Wrangler exited with code ${code}\n${output}`));
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", onError);
    proc.on("exit", onExit);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Wrangler did not become ready within ${timeoutMs}ms\n${output}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("error", onError);
      proc.off("exit", onExit);
    }

    // Also poll the port in case we miss the log line
    const poll = setInterval(async () => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        return;
      }
      try {
        const res = await fetch(`http://localhost:${port}/api/live`);
        if (res.ok) {
          clearInterval(poll);
          cleanup();
          resolve();
        }
      } catch {
        // not ready yet
      }
    }, 500);
  });
}
