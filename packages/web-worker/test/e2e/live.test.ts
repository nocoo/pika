import { describe, expect, it } from "vitest";
import { apiFetch } from "./helpers";

describe("GET /api/live", () => {
  it("returns 200 with ok status", async () => {
    const res = await apiFetch("/api/live");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
  });
});
