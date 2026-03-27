/**
 * Smoke test — verify the E2E harness is working.
 *
 * Tests:
 * 1. Server health check (/api/live)
 * 2. D1 test isolation (assertTestDatabase via direct query)
 * 3. Auth bypass (protected endpoint returns 200, not 401)
 * 4. Seed/cleanup cycle works
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  get,
  cleanupTestData,
  ensureTestUser,
  seedSession,
  d1Query,
  testId,
} from "./helpers";

describe("E2E Smoke Test", () => {
  beforeAll(async () => {
    await ensureTestUser();
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("GET /api/live returns ok", async () => {
    const { status, data } = await get<{ status: string }>("/api/live");
    expect(status).toBe(200);
    expect(data.status).toBe("ok");
  });

  it("D1 test isolation — _test_marker table exists", async () => {
    const rows = await d1Query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_test_marker'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("_test_marker");
  });

  it("auth bypass works — protected endpoint returns 200", async () => {
    const { status } = await get("/api/sessions");
    expect(status).toBe(200);
  });

  it("seed and cleanup cycle works", async () => {
    const id = testId("smoke");

    // Seed a session
    await seedSession({
      id,
      session_key: `claude:${id}`,
      title: "Smoke Test Session",
    });

    // Verify it exists via API
    const { status, data } = await get<{
      sessions: Array<{ id: string }>;
    }>("/api/sessions");
    expect(status).toBe(200);
    expect(data.sessions.some((s) => s.id === id)).toBe(true);

    // Cleanup
    await cleanupTestData();

    // Verify it's gone
    const after = await get<{ sessions: Array<{ id: string }> }>(
      "/api/sessions",
    );
    expect(after.data.sessions.some((s) => s.id === id)).toBe(false);
  });
});
