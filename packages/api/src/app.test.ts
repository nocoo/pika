import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("createApp", () => {
  it("returns a Hono app handling GET /live", async () => {
    const app = createApp();
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
});
