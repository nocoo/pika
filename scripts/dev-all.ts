#!/usr/bin/env bun
/**
 * Boot the web stack (Vite :7022 + web-worker :8787 + api :8788)
 * concurrently for local dev.
 *
 * Used by `bun run dev:all`. Streams every child's stdout/stderr with a
 * coloured prefix and forwards SIGINT/SIGTERM so Ctrl-C cleanly tears
 * down all processes.
 *
 * For production deployment see docs/17 §端口与部署 + P6 cutover.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

interface Child {
  name: string;
  cwd: string;
  cmd: string[];
  env?: Record<string, string>;
  colour: string;
}

const ROOT = resolve(import.meta.dir, "..");

const CHILDREN: Child[] = [
  {
    name: "web",
    cwd: resolve(ROOT, "packages/web"),
    cmd: ["bun", "run", "dev"],
    colour: "\x1b[36m", // cyan
  },
  {
    name: "wkr",
    cwd: resolve(ROOT, "packages/web-worker"),
    cmd: ["bun", "run", "dev"],
    // CLOUDFLARE_ACCOUNT_ID skips wrangler's interactive account picker so
    // remote D1 binding (wrangler.toml `remote = true`) works under
    // dev-all's piped stdio. Without it wrangler hits /memberships and dies.
    env: { CLOUDFLARE_ACCOUNT_ID: "d51a8fde361e4be31db17d8c56737c1f" },
    colour: "\x1b[33m", // yellow
  },
  {
    name: "api",
    cwd: resolve(ROOT, "packages/api"),
    cmd: ["bun", "run", "dev"],
    colour: "\x1b[35m", // magenta
  },
];

const RESET = "\x1b[0m";

function prefix(colour: string, name: string): string {
  return `${colour}[${name.padEnd(3)}]${RESET}`;
}

function pipeStream(
  stream: NodeJS.ReadableStream | null,
  colour: string,
  name: string,
  out: NodeJS.WritableStream,
): void {
  if (!stream) return;
  let buf = "";
  stream.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      out.write(`${prefix(colour, name)} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buf) out.write(`${prefix(colour, name)} ${buf}\n`);
  });
}

const procs: ChildProcess[] = [];
let shuttingDown = false;

// wrangler spawns workerd as a grandchild process. SIGTERM to the wrangler
// node process doesn't always reap workerd before our 1.5s timeout, so the
// next `dev:all` run hits EADDRINUSE on inspector + 8787/8788 ports.
// Killing the whole process group (PGID = -pid, only valid for detached
// children) takes workerd down with the parent.
function killGroup(p: ChildProcess, signal: NodeJS.Signals): void {
  if (p.killed || p.pid == null) return;
  try {
    process.kill(-p.pid, signal);
  } catch {
    p.kill(signal);
  }
}

function shutdown(signal: NodeJS.Signals, exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    killGroup(p, signal);
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

for (const child of CHILDREN) {
  const proc = spawn(child.cmd[0], child.cmd.slice(1), {
    cwd: child.cwd,
    env: { ...process.env, ...(child.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    // own process group so killGroup can reap workerd grandchildren
    detached: true,
  });
  procs.push(proc);

  pipeStream(proc.stdout, child.colour, child.name, process.stdout);
  pipeStream(proc.stderr, child.colour, child.name, process.stderr);

  proc.on("exit", (code, signal) => {
    process.stdout.write(
      `${prefix(child.colour, child.name)} exited (code=${code} signal=${signal})\n`,
    );
    shutdown("SIGTERM", code ?? 1);
  });
}

process.on("SIGINT", () => shutdown("SIGINT", 130));
process.on("SIGTERM", () => shutdown("SIGTERM", 143));
