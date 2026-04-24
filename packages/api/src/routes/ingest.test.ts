import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxyConfig, ProxyResult } from "../lib/ingest";
import type { AuthVariables } from "../middleware/auth";
import { createIngestRoute, ingestRoute, resetIngestR2Client } from "./ingest";

const cfg: ProxyConfig = { workerUrl: "https://w.example", workerSecret: "s" };

function makeApp(deps: Parameters<typeof createIngestRoute>[0] = {}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  app.route("/ingest", createIngestRoute(deps));
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── /presign ─────────────────────────────────────────────────

describe("POST /ingest/presign", () => {
  it("returns 400 on invalid JSON", async () => {
    const app = makeApp({ presignPut: vi.fn() });
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("returns 400 on validation failure", async () => {
    const app = makeApp({ presignPut: vi.fn() });
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("sessionKey");
  });

  it("returns presigned URL + key on success", async () => {
    const presignPut = vi.fn().mockResolvedValue("https://r2.example/up");
    const app = makeApp({ presignPut });
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "claude:abc", rawHash: "deadbeef" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://r2.example/up",
      key: "user-1/claude:abc/raw/deadbeef.json.gz",
    });
    expect(presignPut).toHaveBeenCalledWith(
      "user-1/claude:abc/raw/deadbeef.json.gz",
      "application/gzip",
    );
  });

  it("returns 500 when presigning throws", async () => {
    const app = makeApp({
      presignPut: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s", rawHash: "deadbeef" }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("boom");
  });

  it("stringifies non-Error presign rejection", async () => {
    const app = makeApp({
      presignPut: vi.fn().mockRejectedValue("nope"),
    });
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s", rawHash: "deadbeef" }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("nope");
  });
});

// ── /confirm-raw ──────────────────────────────────────────────

describe("POST /ingest/confirm-raw", () => {
  const validBody = '{"sessionKey":"s","rawHash":"deadbeef","rawSize":42}';

  it("returns 400 on invalid JSON", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(proxy).not.toHaveBeenCalled();
  });

  it("returns 400 on missing rawSize", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"sessionKey":"s","rawHash":"deadbeef"}',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("rawSize");
    expect(proxy).not.toHaveBeenCalled();
  });

  it("returns 400 on non-hex rawHash", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"sessionKey":"s","rawHash":"zzzzzzzz","rawSize":1}',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("hex");
  });

  it("forwards body to worker and returns its response", async () => {
    const proxy = vi.fn().mockResolvedValue<ProxyResult>({
      status: 200,
      body: '{"confirmed":true}',
    });
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: true });
    expect(proxy).toHaveBeenCalledWith(cfg, {
      method: "POST",
      path: "/ingest/confirm-raw",
      userId: "user-1",
      body: validBody,
      contentType: "application/json",
    });
  });

  it("returns 204 with no body when worker yields 204", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue<ProxyResult>({ status: 204, body: "" });
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody,
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns 500 when proxy config throws", async () => {
    const app = makeApp({
      getProxyConfig: () => {
        throw new Error("WORKER_URL is required");
      },
      proxy: vi.fn(),
    });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody,
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("WORKER_URL");
  });

  it("stringifies non-Error config errors", async () => {
    const app = makeApp({
      getProxyConfig: () => {
        throw "broken";
      },
      proxy: vi.fn(),
    });
    const res = await app.request("/ingest/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody,
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("config error");
  });
});

// ── /sessions ────────────────────────────────────────────────

describe("POST /ingest/sessions", () => {
  it("rejects missing Content-Length with 411", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/sessions", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(411);
    expect(proxy).not.toHaveBeenCalled();
  });

  it("rejects oversize payload with 413", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/sessions", {
      method: "POST",
      headers: { "Content-Length": "999999999" },
      body: "{}",
    });
    expect(res.status).toBe(413);
    expect(proxy).not.toHaveBeenCalled();
  });

  it("forwards body to worker on success", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue<ProxyResult>({ status: 201, body: '{"ok":1}' });
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const body = JSON.stringify({ sessions: [] });
    const res = await app.request("/ingest/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
      body,
    });
    expect(res.status).toBe(201);
    expect(proxy).toHaveBeenCalledWith(
      cfg,
      expect.objectContaining({
        method: "POST",
        path: "/ingest/sessions",
        userId: "user-1",
        contentType: "application/json",
      }),
    );
  });

  it("returns 500 when config throws", async () => {
    const app = makeApp({
      getProxyConfig: () => {
        throw new Error("WORKER_SECRET is required");
      },
      proxy: vi.fn(),
    });
    const res = await app.request("/ingest/sessions", {
      method: "POST",
      headers: { "Content-Length": "2" },
      body: "{}",
    });
    expect(res.status).toBe(500);
  });
});

// ── /content/* ───────────────────────────────────────────────

describe("PUT /ingest/content/*", () => {
  it("rejects missing Content-Length", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/content/sk/canonical", {
      method: "PUT",
      body: "x",
    });
    expect(res.status).toBe(411);
  });

  it("rejects oversize payload", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/content/sk/canonical", {
      method: "PUT",
      headers: { "Content-Length": "9999999999" },
      body: "x",
    });
    expect(res.status).toBe(413);
  });

  it("rejects bad path", async () => {
    const proxy = vi.fn();
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/content/sk/wrong-type", {
      method: "PUT",
      headers: { "Content-Length": "1" },
      body: "x",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid content type");
    expect(proxy).not.toHaveBeenCalled();
  });

  it("forwards body and X-* headers", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue<ProxyResult>({ status: 200, body: '{"ok":1}' });
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const body = "compressed-bytes";
    const res = await app.request("/ingest/content/claude:abc/raw", {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        "X-Content-Hash": "h1",
        "X-Parser-Revision": "2",
        "X-Schema-Version": "1",
        "Content-Encoding": "gzip",
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      cfg,
      expect.objectContaining({
        method: "PUT",
        path: "/ingest/content/claude:abc/raw",
        userId: "user-1",
        contentType: "application/octet-stream",
        extraHeaders: {
          "X-Content-Hash": "h1",
          "X-Parser-Revision": "2",
          "X-Schema-Version": "1",
          "Content-Encoding": "gzip",
        },
      }),
    );
  });

  it("returns 204 when worker yields 204", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue<ProxyResult>({ status: 204, body: "" });
    const app = makeApp({ proxy, getProxyConfig: () => cfg });
    const res = await app.request("/ingest/content/sk/canonical", {
      method: "PUT",
      headers: { "Content-Length": "1" },
      body: "x",
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns 500 when config throws", async () => {
    const app = makeApp({
      getProxyConfig: () => {
        throw new Error("WORKER_SECRET is required");
      },
      proxy: vi.fn(),
    });
    const res = await app.request("/ingest/content/sk/canonical", {
      method: "PUT",
      headers: { "Content-Length": "1" },
      body: "x",
    });
    expect(res.status).toBe(500);
  });
});

// ── default singleton path (no deps) ─────────────────────────

describe("default singletons", () => {
  it("ingestRoute (default-deps export) wires presign/validate path", async () => {
    // The default `ingestRoute` is exported wired with real env-bound defaults.
    // We exercise the validation branch (which doesn't touch R2) to cover the
    // default factory call path.
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("userId", "u");
      await next();
    });
    app.route("/ingest", ingestRoute);
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s" }), // missing rawHash
    });
    expect(res.status).toBe(400);
  });

  it("resetIngestR2Client clears cached client", () => {
    // Just exercise the reset helper; it's a one-liner with no observable
    // return, so we only confirm it doesn't throw.
    expect(() => resetIngestR2Client()).not.toThrow();
  });

  it("default presignPut path constructs an R2Client (covers defaultR2)", async () => {
    // Ensure no cached client.
    resetIngestR2Client();
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("userId", "u");
      await next();
    });
    // No deps → default presignPut → defaultR2() lazy init.
    app.route("/ingest", createIngestRoute());
    const res = await app.request("/ingest/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s", rawHash: "deadbeef" }),
    });
    // R2 env is empty in the test process, so presigning will throw → 500.
    // The point is to cover the lazy `new R2Client(...)` branch.
    expect(res.status).toBe(500);
    resetIngestR2Client();
  });
});
