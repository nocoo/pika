import { encode } from "@auth/core/jwt";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuthMiddlewareDeps,
  E2E_TEST_USER_ID,
  requireUser,
  resolveUser,
} from "./auth";

const SECRET = "test-secret-32-bytes-test-secret-32-bytes";
const SECURE = "__Secure-authjs.session-token";
const INSECURE = "authjs.session-token";

async function makeJwe(opts: { userId: string; salt: string; expIn?: number }) {
  return encode({
    token: { userId: opts.userId },
    salt: opts.salt,
    secret: SECRET,
    maxAge: opts.expIn ?? 60,
  });
}

function appWith(deps: AuthMiddlewareDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", requireUser(deps));
  app.get("/me", (c) => c.json({ userId: c.var.userId }));
  return app;
}

function envEnv(env: Partial<NodeJS.ProcessEnv>): AuthMiddlewareDeps {
  return {
    getSecret: () => SECRET,
    getWorkerUrl: () => "https://worker.test",
    getEnv: () => env as NodeJS.ProcessEnv,
    fetch: () =>
      Promise.resolve(new Response(null, { status: 500 })) as Promise<Response>,
  };
}

describe("resolveUser — cookie auth", () => {
  it("decodes a valid insecure session-token cookie", async () => {
    const token = await makeJwe({ userId: "u-1", salt: INSECURE });
    const app = appWith(envEnv({ NODE_ENV: "development" }));
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u-1" });
  });

  it("decodes a valid __Secure- session-token cookie", async () => {
    const token = await makeJwe({ userId: "u-2", salt: SECURE });
    const app = appWith(envEnv({ NODE_ENV: "production" }));
    const res = await app.request("/me", {
      headers: { cookie: `${SECURE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u-2" });
  });

  it("rejects a malformed cookie with 401 (decode throws)", async () => {
    const app = appWith(envEnv({ NODE_ENV: "development" }));
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=not-a-real-jwe-token` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a missing cookie with 401", async () => {
    const app = appWith(envEnv({ NODE_ENV: "development" }));
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  it("rejects when payload has no userId", async () => {
    const token = await encode({
      token: { foo: "bar" },
      salt: INSECURE,
      secret: SECRET,
      maxAge: 60,
    });
    const app = appWith(envEnv({ NODE_ENV: "development" }));
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("ignores cookie with mismatched salt (junk token)", async () => {
    // Token encoded with the secure salt but cookie name is the insecure one
    const token = await makeJwe({ userId: "u-mismatch", salt: SECURE });
    const app = appWith(envEnv({ NODE_ENV: "development" }));
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when secret is unset", async () => {
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      getSecret: () => undefined,
    });
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=anything` },
    });
    expect(res.status).toBe(401);
  });
});

describe("resolveUser — bearer pk_*", () => {
  it("returns userId from Worker /auth/me on 200", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ userId: "pk-user" }), { status: 200 }),
      ),
    );
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer pk_abc123" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "pk-user" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect((url as URL).toString()).toBe("https://worker.test/auth/me");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer pk_abc123",
    });
  });

  it("returns 401 when Worker returns 404", async () => {
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      fetch: (() =>
        Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch,
    });
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer pk_abc" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when fetch throws", async () => {
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      fetch: (() => Promise.reject(new Error("netfail"))) as typeof fetch,
    });
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer pk_abc" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when response body has no userId", async () => {
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        )) as typeof fetch,
    });
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer pk_abc" },
    });
    expect(res.status).toBe(401);
  });

  it("does not call Worker when WORKER_URL is missing", async () => {
    const fetchSpy = vi.fn();
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      getWorkerUrl: () => undefined,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer pk_abc" },
    });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores non-pk_ bearer tokens", async () => {
    const fetchSpy = vi.fn();
    const app = appWith({
      ...envEnv({ NODE_ENV: "development" }),
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer xyz" },
    });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveUser — E2E bypass", () => {
  it("returns header X-E2E-User when E2E_SKIP_AUTH=true && NODE_ENV=development", async () => {
    const app = appWith(
      envEnv({ NODE_ENV: "development", E2E_SKIP_AUTH: "true" }),
    );
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "alice" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "alice" });
  });

  it("falls back to E2E_TEST_USER_ID when header omitted", async () => {
    const app = appWith(
      envEnv({ NODE_ENV: "development", E2E_SKIP_AUTH: "true" }),
    );
    const res = await app.request("/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: E2E_TEST_USER_ID });
  });

  it("ignores E2E bypass when NODE_ENV != development", async () => {
    const app = appWith(
      envEnv({ NODE_ENV: "production", E2E_SKIP_AUTH: "true" }),
    );
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "alice" },
    });
    expect(res.status).toBe(401);
  });

  it("ignores E2E bypass when flag not set", async () => {
    const app = appWith(envEnv({ NODE_ENV: "development" }));
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "alice" },
    });
    expect(res.status).toBe(401);
  });
});

describe("requireUser — defaults", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = SECRET;
    process.env.WORKER_URL = "https://worker.test";
    (process.env as Record<string, string>).NODE_ENV = "development";
    delete (process.env as Record<string, string | undefined>).E2E_SKIP_AUTH;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, ORIGINAL);
  });

  it("defaults pull NEXTAUTH_SECRET / WORKER_URL / NODE_ENV from process.env", async () => {
    const token = await makeJwe({ userId: "u-default", salt: INSECURE });
    const app = new Hono<{ Variables: { userId: string } }>();
    app.use("*", requireUser());
    app.get("/me", (c) => c.json({ userId: c.var.userId }));
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("defaults call WORKER_URL from process.env for bearer pk_*", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ userId: "default-pk" }), {
          status: 200,
        }),
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const app = new Hono<{ Variables: { userId: string } }>();
      app.use("*", requireUser());
      app.get("/me", (c) => c.json({ userId: c.var.userId }));
      const res = await app.request("/me", {
        headers: { Authorization: "Bearer pk_default" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ userId: "default-pk" });
      const [url] = fetchSpy.mock.calls[0];
      expect((url as URL).toString()).toBe("https://worker.test/auth/me");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to AUTH_SECRET when NEXTAUTH_SECRET unset", async () => {
    delete (process.env as Record<string, string | undefined>).NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    const token = await makeJwe({ userId: "u-auth-secret", salt: INSECURE });
    const app = new Hono<{ Variables: { userId: string } }>();
    app.use("*", requireUser());
    app.get("/me", (c) => c.json({ userId: c.var.userId }));
    const res = await app.request("/me", {
      headers: { cookie: `${INSECURE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u-auth-secret" });
  });
});

describe("resolveUser — direct (no middleware wrapper)", () => {
  it("returns null when nothing present", async () => {
    // exercise resolveUser directly so we cover the early returns
    const app = new Hono();
    app.get("/_probe", async (c) => {
      const u = await resolveUser(c, envEnv({ NODE_ENV: "development" }));
      return c.json({ u });
    });
    const res = await app.request("/_probe");
    expect(await res.json()).toEqual({ u: null });
  });
});
