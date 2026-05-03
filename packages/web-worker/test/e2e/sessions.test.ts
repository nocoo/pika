import { describe, expect, it } from "vitest";
import { apiFetch } from "./helpers";

describe("GET /api/sessions", () => {
  it("returns 200 with sessions array", async () => {
    const res = await apiFetch("/api/sessions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("sessions");
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});
