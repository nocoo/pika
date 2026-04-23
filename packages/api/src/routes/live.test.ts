import { describe, expect, it } from "vitest";
import { liveRoute } from "./live";

describe("GET /live", () => {
  it("returns ok status with component=api and required fields", async () => {
    const res = await liveRoute.request("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.component).toBe("api");
    expect(body.version).toBeDefined();
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

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
