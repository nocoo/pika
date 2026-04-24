import { describe, expect, it, vi } from "vitest";
import { createLiveRoute, liveRoute } from "./live";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

describe("GET /live (default route)", () => {
  it("issues a fresh timestamp on each request", async () => {
    const a = (await (await liveRoute.request("/")).json()) as {
      timestamp: string;
    };
    await new Promise((r) => setTimeout(r, 5));
    const b = (await (await liveRoute.request("/")).json()) as {
      timestamp: string;
    };
    expect(a.timestamp).not.toBe(b.timestamp);
  });
});

describe("createLiveRoute", () => {
  it("returns 503 when WORKER_URL is missing", async () => {
    const route = createLiveRoute({ getWorkerUrl: () => undefined });
    const res = await route.request("/");

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    expect(body.component).toBe("api");
    expect(typeof body.version).toBe("string");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof body.uptime).toBe("number");
    expect((body.database as Record<string, unknown>).connected).toBe(false);
    expect((body.database as Record<string, unknown>).error).toBe(
      "WORKER_URL not configured",
    );
  });

  it("returns 200 + ok when Worker reports database.connected=true", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ database: { connected: true } }));

    const route = createLiveRoute({
      getWorkerUrl: () => "https://worker.example.com",
      fetch: fetchSpy as unknown as typeof fetch,
      getUptime: () => 12.7,
      now: () => new Date("2026-04-24T00:00:00.000Z"),
    });

    const res = await route.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [URL, RequestInit];
    expect(url.toString()).toBe("https://worker.example.com/live");
    expect((init.headers as Record<string, string>)["Cache-Control"]).toBe(
      "no-cache",
    );

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.component).toBe("api");
    expect(body.timestamp).toBe("2026-04-24T00:00:00.000Z");
    expect(body.uptime).toBe(12);
    expect(body.database).toEqual({ connected: true });
  });

  it("returns 503 + error when Worker reports database.connected=false", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        database: { connected: false, error: "D1 connection refused" },
      }),
    );

    const route = createLiveRoute({
      getWorkerUrl: () => "https://worker.example.com",
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const res = await route.request("/");
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    expect(body.database).toEqual({
      connected: false,
      error: "D1 connection refused",
    });
  });

  it("falls back to 'Unknown' when Worker omits database object", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}));

    const route = createLiveRoute({
      getWorkerUrl: () => "https://worker.example.com",
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const res = await route.request("/");
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.database).toEqual({ connected: false, error: "Unknown" });
  });

  it("returns 503 and sanitises 'ok' from Worker fetch errors", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new Error("lookup ok-host failed"));

    const route = createLiveRoute({
      getWorkerUrl: () => "https://worker.example.com",
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const res = await route.request("/");
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    const db = body.database as Record<string, unknown>;
    expect(db.connected).toBe(false);
    expect(db.error).toBe("Worker unreachable: lookup ***-host failed");
    expect(db.error).not.toMatch(/\bok\b/i);
  });

  it("stringifies non-Error rejections from fetch", async () => {
    const fetchSpy = vi.fn().mockRejectedValue("boom");

    const route = createLiveRoute({
      getWorkerUrl: () => "https://worker.example.com",
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const res = await route.request("/");
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    const db = body.database as Record<string, unknown>;
    expect(db.error).toBe("Worker unreachable: boom");
  });

  it("uses defaults from process.env / process.uptime when no deps given", async () => {
    const original = process.env.WORKER_URL;
    delete process.env.WORKER_URL;
    try {
      const route = createLiveRoute();
      const res = await route.request("/");
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.database as Record<string, unknown>).error).toBe(
        "WORKER_URL not configured",
      );
      expect(typeof body.uptime).toBe("number");
    } finally {
      if (original !== undefined) process.env.WORKER_URL = original;
    }
  });
});
