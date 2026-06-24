import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import { isLocalhost } from "./is-localhost";

function makeApp() {
  const app = new Hono<AppEnv>();
  app.all("/probe", (c) => c.json({ local: isLocalhost(c) }));
  return app;
}

async function probe(opts: {
  host?: string;
  cf?: boolean;
  env?: Partial<AppEnv["Bindings"]>;
}): Promise<{ local: boolean }> {
  const app = makeApp();
  const headers: Record<string, string> = {};
  if (opts.host) headers.host = opts.host;
  const req = new Request("http://localhost/probe", { headers });
  if (opts.cf) {
    Object.defineProperty(req, "cf", { value: { country: "US" } });
  }
  const res = await app.fetch(req, opts.env as Record<string, unknown>);
  return res.json();
}

describe("isLocalhost", () => {
  it("no cf, host=localhost → true", async () => {
    expect((await probe({ host: "localhost:7025" })).local).toBe(true);
  });

  it("no cf, host=127.0.0.1 → true", async () => {
    expect((await probe({ host: "127.0.0.1" })).local).toBe(true);
  });

  it("no cf, host=*.dev.hexly.ai → true", async () => {
    expect((await probe({ host: "pika.dev.hexly.ai" })).local).toBe(true);
  });

  it("no cf, host=pika.hexly.ai → false", async () => {
    expect((await probe({ host: "pika.hexly.ai" })).local).toBe(false);
  });

  it("on cf edge, host=localhost → false (spoof rejected)", async () => {
    expect((await probe({ host: "localhost", cf: true })).local).toBe(false);
  });

  it("on cf edge, host=*.dev.hexly.ai → true", async () => {
    expect((await probe({ host: "pika.dev.hexly.ai", cf: true })).local).toBe(
      true,
    );
  });

  it("non-local host (no cf) → false", async () => {
    const app = new Hono<AppEnv>();
    app.all("/probe", (c) => c.json({ local: isLocalhost(c) }));
    const req = new Request("http://example.com/probe");
    const res = await app.fetch(req);
    const json = (await res.json()) as { local: boolean };
    expect(json.local).toBe(false);
  });

  // wrangler dev resolves [[routes]] in local mode and rewrites Host to the
  // prod custom_domain — `pika.hexly.ai` is what the worker sees even for a
  // browser hitting `pika.dev.hexly.ai` through vite + caddy. The DEV_USER_EMAIL
  // fallback recognises that case; it's the same env var the dev-email
  // injection already depends on, set only in `.dev.vars`.
  it("on cf edge, host=pika.hexly.ai + DEV_USER_EMAIL → true (wrangler dev)", async () => {
    expect(
      (
        await probe({
          host: "pika.hexly.ai",
          cf: true,
          env: { DEV_USER_EMAIL: "dev@local" },
        })
      ).local,
    ).toBe(true);
  });

  it("on cf edge, host=pika.hexly.ai, no DEV_USER_EMAIL → false (prod)", async () => {
    expect((await probe({ host: "pika.hexly.ai", cf: true })).local).toBe(
      false,
    );
  });

  it("no cf, host=pika.hexly.ai + DEV_USER_EMAIL → true", async () => {
    expect(
      (
        await probe({
          host: "pika.hexly.ai",
          env: { DEV_USER_EMAIL: "dev@local" },
        })
      ).local,
    ).toBe(true);
  });
});
