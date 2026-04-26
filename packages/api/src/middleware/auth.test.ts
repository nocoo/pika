import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AuthEnv,
  type AuthMiddlewareDeps,
  E2E_TEST_USER_ID,
  requireUser,
  resolveUser,
} from "./auth";

function appWith(deps: AuthMiddlewareDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", requireUser(deps));
  app.get("/me", (c) => c.json({ userId: c.var.userId }));
  return app;
}

function envEnv(env: AuthEnv): AuthMiddlewareDeps {
  return { getEnv: () => env };
}

describe("resolveUser — X-Pika-User-Id", () => {
  it("returns userId from X-Pika-User-Id header", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "production" }));
    const res = await app.request("/me", {
      headers: { "X-Pika-User-Id": "u-1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u-1" });
  });

  it("returns 401 when header is missing", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "production" }));
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when header is empty string", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "production" }));
    const res = await app.request("/me", {
      headers: { "X-Pika-User-Id": "" },
    });
    expect(res.status).toBe(401);
  });

  it("ignores cookies and Authorization (trust only X-Pika-User-Id)", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "production" }));
    const res = await app.request("/me", {
      headers: {
        cookie: "authjs.session-token=anything",
        Authorization: "Bearer pk_should_be_ignored",
      },
    });
    expect(res.status).toBe(401);
  });
});

describe("resolveUser — E2E bypass", () => {
  it("returns header X-E2E-User when E2E_SKIP_AUTH=true && ENVIRONMENT != production", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "test", E2E_SKIP_AUTH: "true" }));
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "alice" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "alice" });
  });

  it("falls back to E2E_TEST_USER_ID when header omitted", async () => {
    const app = appWith(
      envEnv({ ENVIRONMENT: "development", E2E_SKIP_AUTH: "true" }),
    );
    const res = await app.request("/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: E2E_TEST_USER_ID });
  });

  it("ignores E2E bypass when ENVIRONMENT=production (even with flag set)", async () => {
    const app = appWith(
      envEnv({ ENVIRONMENT: "production", E2E_SKIP_AUTH: "true" }),
    );
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "alice" },
    });
    expect(res.status).toBe(401);
  });

  it("ignores E2E bypass when flag not set", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "test" }));
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "alice" },
    });
    expect(res.status).toBe(401);
  });

  it("E2E bypass takes priority over X-Pika-User-Id when both present", async () => {
    const app = appWith(envEnv({ ENVIRONMENT: "test", E2E_SKIP_AUTH: "true" }));
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "e2e-user", "X-Pika-User-Id": "real-user" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "e2e-user" });
  });
});

describe("requireUser — defaults", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, ORIGINAL);
  });

  it("defaults read ENVIRONMENT / E2E_SKIP_AUTH from process.env", async () => {
    process.env.ENVIRONMENT = "test";
    process.env.E2E_SKIP_AUTH = "true";
    const app = new Hono<{ Variables: { userId: string } }>();
    app.use("*", requireUser());
    app.get("/me", (c) => c.json({ userId: c.var.userId }));
    const res = await app.request("/me", {
      headers: { "X-E2E-User": "default-e2e" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "default-e2e" });
  });

  it("defaults reject when no auth context present in process.env", async () => {
    process.env.ENVIRONMENT = "production";
    const app = new Hono<{ Variables: { userId: string } }>();
    app.use("*", requireUser());
    app.get("/me", (c) => c.json({ userId: c.var.userId }));
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });
});

describe("resolveUser — direct (no middleware wrapper)", () => {
  it("returns null when nothing present", async () => {
    const app = new Hono();
    app.get("/_probe", (c) => {
      const u = resolveUser(c, envEnv({ ENVIRONMENT: "production" }));
      return c.json({ u });
    });
    const res = await app.request("/_probe");
    expect(await res.json()).toEqual({ u: null });
  });
});
