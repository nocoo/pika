import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../lib/env";
import { buildUpstreamRequest, proxyHandler } from "./proxy";

describe("buildUpstreamRequest", () => {
  it("strips /api prefix from pathname", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api/stats?range=7d"),
      "u-1",
    );
    const u = new URL(upstream.url);
    expect(u.pathname).toBe("/stats");
    expect(u.search).toBe("?range=7d");
  });

  it("rewrites bare /api to /", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api"),
      "u-1",
    );
    expect(new URL(upstream.url).pathname).toBe("/");
  });

  it("injects X-Pika-User-Id header", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api/stats"),
      "user-42",
    );
    expect(upstream.headers.get("X-Pika-User-Id")).toBe("user-42");
  });

  it("injects X-Pika-User-Email when email provided", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api/stats"),
      "u-1",
      "alice@example.com",
    );
    expect(upstream.headers.get("X-Pika-User-Email")).toBe("alice@example.com");
  });

  it("omits X-Pika-User-Email when no email", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api/stats"),
      "u-1",
    );
    expect(upstream.headers.get("X-Pika-User-Email")).toBeNull();
  });

  it("strips cookie + Authorization (web-worker is the trust root)", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api/stats", {
        headers: {
          cookie: "session=secret",
          Authorization: "Bearer pk_should_not_pass",
        },
      }),
      "u-1",
    );
    expect(upstream.headers.get("cookie")).toBeNull();
    expect(upstream.headers.get("authorization")).toBeNull();
  });

  it("preserves method on POST", () => {
    const upstream = buildUpstreamRequest(
      new Request("https://pika.example/api/sessions", {
        method: "POST",
        body: JSON.stringify({ x: 1 }),
        headers: { "content-type": "application/json" },
      }),
      "u-1",
    );
    expect(upstream.method).toBe("POST");
  });
});

describe("proxyHandler", () => {
  function appWith(apiFetch: (req: Request) => Response | Promise<Response>) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("userId", "u-1");
      c.set("accessEmail", "alice@example.com");
      await next();
    });
    app.all("/api/*", proxyHandler);
    return {
      app,
      env: { API: { fetch: vi.fn(apiFetch) } } as unknown as AppEnv["Bindings"],
    };
  }

  it("forwards request to API service binding and returns its response", async () => {
    const { app, env } = appWith(() =>
      Response.json({ ok: true }, { status: 200 }),
    );
    const res = await app.request("/api/stats?range=7d", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(env.API.fetch).toHaveBeenCalledOnce();
    const upstream = (env.API.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Request;
    expect(new URL(upstream.url).pathname).toBe("/stats");
    expect(upstream.headers.get("X-Pika-User-Id")).toBe("u-1");
    expect(upstream.headers.get("X-Pika-User-Email")).toBe("alice@example.com");
  });

  it("returns 401 when userId is not on context", async () => {
    const app = new Hono<AppEnv>();
    app.all("/api/*", proxyHandler);
    const env = {
      API: { fetch: vi.fn() },
    } as unknown as AppEnv["Bindings"];
    const res = await app.request("/api/stats", {}, env);
    expect(res.status).toBe(401);
    expect(env.API.fetch).not.toHaveBeenCalled();
  });
});
