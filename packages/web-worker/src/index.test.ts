import { describe, expect, it } from "vitest";
import app from "./index";

describe("web-worker", () => {
  it("GET /api/live → 200 { ok: true }", async () => {
    const res = await app.request("/api/live");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /unknown → 404 (falls through to ASSETS in production)", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
  });
});
