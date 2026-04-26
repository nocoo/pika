#!/usr/bin/env bun
/**
 * Boot web (port 7022) + api (port 7023) concurrently for local dev.
 *
 * Used by `bun run dev:all`. Streams both children's stdout/stderr with a
 * coloured prefix and forwards SIGINT/SIGTERM so Ctrl-C cleanly tears down
 * both processes.
 *
 * For production reverse proxy / cutover plans see docs/16-api-extraction.md
 * §P4 (currently caddy-only for local dev; prod will move to Vite + CF Workers).
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
    cwd: resolve(ROOT, "packages/web_legacy"),
    cmd: ["bun", "run", "dev"],
    colour: "\x1b[36m", // cyan
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

function shutdown(signal: NodeJS.Signals, exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

for (const child of CHILDREN) {
  const proc = spawn(child.cmd[0], child.cmd.slice(1), {
    cwd: child.cwd,
    env: { ...process.env, ...(child.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
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
