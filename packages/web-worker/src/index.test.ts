import { describe, expect, it } from "vitest";
import app from "./index";

const stubDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => ({ probe: 1 }),
    }),
    first: async () => ({ probe: 1 }),
  }),
};

describe("web-worker", () => {
  it("GET /api/live → 200 with status ok when DB reachable", async () => {
    const res = await app.request(
      "/api/live",
      {},
      { DB: stubDb as unknown as D1Database },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /unknown → 404 (falls through to ASSETS in production)", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
  });
});
