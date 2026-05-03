import { type ChildProcess, execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const PORT = 17022;
const PERSIST_DIR = resolve(__dirname, "../../.wrangler/e2e");
const WORKER_ROOT = resolve(__dirname, "../..");
const MIGRATIONS_DIR = resolve(WORKER_ROOT, "../../scripts/migrations");
const DEV_VARS_PATH = resolve(WORKER_ROOT, ".dev.vars.e2e");

const TEST_USER_ID = "e2e-test-user-001";
const TEST_USER_EMAIL = "e2e@test.local";

let wranglerProcess: ChildProcess | null = null;

export async function setup() {
  if (process.env.CI && process.env.SKIP_E2E === "true") {
    throw new Error("E2E tests skipped via SKIP_E2E=true");
  }

  // Clean persist dir
  if (existsSync(PERSIST_DIR)) {
    rmSync(PERSIST_DIR, { recursive: true });
  }
  mkdirSync(PERSIST_DIR, { recursive: true });

  // Apply migrations using --file (supports multi-statement SQL)
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}-.+\.sql$/.test(f))
    .sort();

  for (const file of migrationFiles) {
    const filePath = resolve(MIGRATIONS_DIR, file);
    execSync(
      `npx wrangler d1 execute pika-db --local --persist-to=${PERSIST_DIR} --file=${filePath}`,
      { cwd: WORKER_ROOT, stdio: "pipe" },
    );
  }

  // Apply test marker
  const markerPath = resolve(__dirname, "fixtures/test_marker.sql");
  execSync(
    `npx wrangler d1 execute pika-db --local --persist-to=${PERSIST_DIR} --file=${markerPath}`,
    { cwd: WORKER_ROOT, stdio: "pipe" },
  );

  // Seed test user
  const seedSql = `INSERT OR REPLACE INTO users (id, email, name) VALUES ('${TEST_USER_ID}', '${TEST_USER_EMAIL}', 'E2E Test User');`;
  execSync(
    `npx wrangler d1 execute pika-db --local --persist-to=${PERSIST_DIR} --command="${seedSql}"`,
    { cwd: WORKER_ROOT, stdio: "pipe" },
  );

  // Write .dev.vars for local wrangler
  writeFileSync(
    DEV_VARS_PATH,
    [
      "ENVIRONMENT=test",
      "E2E_SKIP_AUTH=true",
      `DEV_USER_EMAIL=${TEST_USER_EMAIL}`,
    ].join("\n"),
  );

  // Start wrangler dev in local mode
  wranglerProcess = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      String(PORT),
      "--local",
      `--persist-to=${PERSIST_DIR}`,
      "--var=ENVIRONMENT:test",
      "--var=E2E_SKIP_AUTH:true",
      `--var=DEV_USER_EMAIL:${TEST_USER_EMAIL}`,
    ],
    {
      cwd: WORKER_ROOT,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    },
  );

  await waitForReady(wranglerProcess, PORT);
}

export async function teardown() {
  if (wranglerProcess) {
    wranglerProcess.kill("SIGTERM");
    wranglerProcess = null;
  }
  if (existsSync(DEV_VARS_PATH)) {
    rmSync(DEV_VARS_PATH);
  }
}

async function waitForReady(proc: ChildProcess, port: number): Promise<void> {
  const timeoutMs = 30_000;
  const start = Date.now();

  return new Promise<void>((resolvePromise, reject) => {
    let output = "";
    let settled = false;

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (
        !settled &&
        (output.includes("Ready on") || output.includes(`localhost:${port}`))
      ) {
        settled = true;
        cleanup();
        resolvePromise();
      }
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(`Wrangler failed to start: ${err.message}\n${output}`),
      );
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Wrangler exited with code ${code}\n${output}`));
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", onError);
    proc.on("exit", onExit);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Wrangler did not become ready within ${timeoutMs}ms\n${output}`,
        ),
      );
    }, timeoutMs);

    const poll = setInterval(async () => {
      if (settled) {
        clearInterval(poll);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        return;
      }
      try {
        const res = await fetch(`http://localhost:${port}/api/live`);
        if (res.ok) {
          if (settled) return;
          settled = true;
          clearInterval(poll);
          cleanup();
          resolvePromise();
        }
      } catch {
        // not ready yet
      }
    }, 500);

    function cleanup() {
      clearTimeout(timer);
      clearInterval(poll);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("error", onError);
      proc.off("exit", onExit);
    }
  });
}
