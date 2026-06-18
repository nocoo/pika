import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../lib/env";
import { __resetAccessAuthCacheForTests, accessAuth } from "./access-auth";

const verifyMock = vi.fn();
const createJWKSMock = vi.fn();

vi.mock("jose", () => ({
  createRemoteJWKSet: (url: URL) => {
    createJWKSMock(url.toString());
    // return a sentinel object the verify mock will receive
    return { kind: "jwks-mock" } as const;
  },
  jwtVerify: (...args: unknown[]) => verifyMock(...args),
}));

function makeApp(env: Partial<AppEnv["Bindings"]> = {}) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", accessAuth);
  app.get("/api/live", (c) => c.json({ ok: true }));
  app.get("/api/me", (c) =>
    c.json({
      authed: c.get("accessAuthenticated") ?? false,
      email: c.get("accessEmail") ?? null,
    }),
  );
  return {
    fetch: (req: Request) =>
      app.fetch(req, env as unknown as Record<string, unknown>),
  };
}

describe("accessAuth", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    createJWKSMock.mockReset();
    __resetAccessAuthCacheForTests();
  });

  it("/api/live is public — never authenticates", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/live"));
    expect(res.status).toBe(200);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("localhost without bearer marks accessAuthenticated", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request("http://localhost:7025/api/me", {
        headers: { host: "localhost:7025" },
      }),
    );
    const body = (await res.json()) as { authed: boolean; email: null };
    expect(body.authed).toBe(true);
    expect(body.email).toBeNull();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("localhost without bearer + DEV_USER_EMAIL injects accessEmail", async () => {
    const app = makeApp({ DEV_USER_EMAIL: "architie@gmail.com" });
    const res = await app.fetch(
      new Request("http://localhost:7025/api/me", {
        headers: { host: "localhost:7025" },
      }),
    );
    const body = (await res.json()) as { authed: boolean; email: string };
    expect(body.authed).toBe(true);
    expect(body.email).toBe("architie@gmail.com");
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("localhost with bearer ignores DEV_USER_EMAIL (apiKeyAuth owns email)", async () => {
    const app = makeApp({ DEV_USER_EMAIL: "architie@gmail.com" });
    const res = await app.fetch(
      new Request("http://localhost:7025/api/me", {
        headers: {
          host: "localhost:7025",
          Authorization: "Bearer pk_test",
        },
      }),
    );
    const body = (await res.json()) as { authed: boolean; email: null };
    expect(body.authed).toBe(false);
    expect(body.email).toBeNull();
  });

  it("localhost with bearer skips dev-auth so apiKeyAuth handles it", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request("http://localhost:7025/api/me", {
        headers: {
          host: "localhost:7025",
          Authorization: "Bearer pk_test",
        },
      }),
    );
    const body = (await res.json()) as { authed: boolean };
    expect(body.authed).toBe(false);
  });

  it("non-local CLI request with Bearer defers to apiKeyAuth (no 401 here)", async () => {
    // CLI hits /api/ingest/* through the CF Access path-level bypass policy
    // (docs/00-architecture.md §4). The bypass strips Cf-Access-Jwt-Assertion
    // but the request still carries a Bearer pk_* — accessAuth must let it
    // through unauthenticated so apiKeyAuth can verify the token.
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/ingest/sessions", {
        headers: { Authorization: "Bearer pk_test" },
      }),
    );
    // Falls through to the next middleware; our test app has no handler for
    // /api/ingest, but the important thing is accessAuth did not 401/500.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("non-local without CF Access env vars → 500 (fail-closed)", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/me"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error:
        "Access authentication not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.",
    });
  });

  it("non-local without JWT header → 401 (fail-closed)", async () => {
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/me"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Missing Access JWT" });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("valid JWT → sets accessAuthenticated + email", async () => {
    verifyMock.mockResolvedValueOnce({
      payload: { email: "user@example.com" },
    });
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "valid.jwt.here" },
      }),
    );
    const body = (await res.json()) as { authed: boolean; email: string };
    expect(body.authed).toBe(true);
    expect(body.email).toBe("user@example.com");
    expect(createJWKSMock).toHaveBeenCalledWith(
      "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
    );
  });

  it("JWKS cache reused across same teamDomain", async () => {
    verifyMock.mockResolvedValue({ payload: { email: "u@x.com" } });
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "j" },
      }),
    );
    await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "j" },
      }),
    );
    expect(createJWKSMock).toHaveBeenCalledTimes(1);
  });

  it("invalid JWT → 403 (fail-closed)", async () => {
    verifyMock.mockRejectedValueOnce(new Error("bad sig"));
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "bad.jwt" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid Access JWT" });
  });

  it("payload without string email leaves accessEmail unset", async () => {
    verifyMock.mockResolvedValueOnce({ payload: { email: 42 } });
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "j" },
      }),
    );
    const body = (await res.json()) as { authed: boolean; email: null };
    expect(body.authed).toBe(true);
    expect(body.email).toBeNull();
  });
});
