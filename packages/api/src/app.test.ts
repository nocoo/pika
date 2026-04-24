import { describe, expect, it, vi } from "vitest";
import { createApp, createLiveRoute } from "./app";

describe("createApp", () => {
  it("returns a Hono app handling GET /live with injected route", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ database: { connected: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const liveRoute = createLiveRoute({
      getWorkerUrl: () => "https://worker.example.com",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const app = createApp({ liveRoute });
    const res = await app.request("/live");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.component).toBe("api");
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });

  it("returns 404 for unknown routes", async () => {
    const app = createApp();
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });

  it("default app falls back to env-driven live route", async () => {
    const original = process.env.WORKER_URL;
    delete process.env.WORKER_URL;
    try {
      const app = createApp();
      const res = await app.request("/live");
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.database as Record<string, unknown>).error).toBe(
        "WORKER_URL not configured",
      );
    } finally {
      if (original !== undefined) process.env.WORKER_URL = original;
    }
  });
});
