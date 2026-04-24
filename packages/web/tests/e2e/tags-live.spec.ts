/**
 * E2E tests for tags CRUD and live health check endpoints.
 *
 * Covers:
 * - GET /api/tags (list tags)
 * - POST /api/tags (create tag)
 * - PATCH /api/tags/[tagId] (update tag)
 * - DELETE /api/tags/[tagId] (delete tag)
 * - GET /api/live (health check)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  get,
  post,
  patch,
  del,
  cleanupTestData,
  ensureTestUser,
  rawRequest,
} from "./helpers";

describe("Tags CRUD API", () => {
  beforeAll(async () => {
    await ensureTestUser();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ── GET /api/tags ─────────────────────────────────────────

  describe("GET /api/tags", () => {
    it("returns empty list when no tags", async () => {
      const { status, data } = await get<{ tags: unknown[] }>("/api/tags");
      expect(status).toBe(200);
      expect(data.tags).toEqual([]);
    });

    it("returns created tags", async () => {
      await post("/api/tags", { name: "bug", color: "#ff0000" });
      await post("/api/tags", { name: "feature", color: "#00ff00" });

      const { status, data } = await get<{
        tags: Array<{ name: string; color: string }>;
      }>("/api/tags");
      expect(status).toBe(200);
      expect(data.tags).toHaveLength(2);
      expect(data.tags.map((t) => t.name).sort()).toEqual([
        "bug",
        "feature",
      ]);
    });
  });

  // ── POST /api/tags ────────────────────────────────────────

  describe("POST /api/tags", () => {
    it("creates a tag with name and color", async () => {
      const { status, data } = await post<{
        tag: { id: string; name: string; color: string };
      }>("/api/tags", { name: "urgent", color: "#ff6b6b" });
      expect(status).toBe(201);
      expect(data.tag.name).toBe("urgent");
      expect(data.tag.color).toBe("#ff6b6b");
      expect(data.tag.id).toBeTruthy();
    });

    it("creates a tag without color", async () => {
      const { status, data } = await post<{
        tag: { id: string; name: string; color: string | null };
      }>("/api/tags", { name: "no-color" });
      expect(status).toBe(201);
      expect(data.tag.name).toBe("no-color");
      expect(data.tag.color).toBeNull();
    });

    it("returns 400 for missing name", async () => {
      const { status, data } = await post<{ error: unknown }>(
        "/api/tags",
        { color: "#fff" },
      );
      expect(status).toBe(400);
      expect(data.error).toBeTruthy();
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await rawRequest(
        "POST",
        "/api/tags",
        "not json",
        { "Content-Type": "application/json" },
      );
      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate tag name", async () => {
      await post("/api/tags", { name: "duplicate" });
      const { status, data } = await post<{ error: string }>(
        "/api/tags",
        { name: "duplicate" },
      );
      expect(status).toBe(409);
      expect(data.error).toContain("duplicate");
    });
  });

  // ── PATCH /api/tags/[tagId] ───────────────────────────────

  describe("PATCH /api/tags/[tagId]", () => {
    it("updates tag name", async () => {
      const { data: created } = await post<{
        tag: { id: string };
      }>("/api/tags", { name: "old-name" });

      const { status, data } = await patch<{
        tag: { name: string };
      }>(`/api/tags/${created.tag.id}`, { name: "new-name" });
      expect(status).toBe(200);
      expect(data.tag.name).toBe("new-name");
    });

    it("updates tag color", async () => {
      const { data: created } = await post<{
        tag: { id: string };
      }>("/api/tags", { name: "color-test", color: "#000000" });

      const { status, data } = await patch<{
        tag: { color: string };
      }>(`/api/tags/${created.tag.id}`, { color: "#ffffff" });
      expect(status).toBe(200);
      expect(data.tag.color).toBe("#ffffff");
    });

    it("returns 404 for non-existent tag", async () => {
      const { status, data } = await patch<{ error: string }>(
        "/api/tags/non-existent",
        { name: "nope" },
      );
      expect(status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 409 for duplicate name on update", async () => {
      await post("/api/tags", { name: "existing" });
      const { data: second } = await post<{
        tag: { id: string };
      }>("/api/tags", { name: "will-rename" });

      const { status, data } = await patch<{ error: string }>(
        `/api/tags/${second.tag.id}`,
        { name: "existing" },
      );
      expect(status).toBe(409);
      expect(data.error).toContain("existing");
    });
  });

  // ── DELETE /api/tags/[tagId] ──────────────────────────────

  describe("DELETE /api/tags/[tagId]", () => {
    it("deletes an existing tag", async () => {
      const { data: created } = await post<{
        tag: { id: string };
      }>("/api/tags", { name: "to-delete" });

      const { status } = await del(`/api/tags/${created.tag.id}`);
      expect(status).toBe(204);

      // Verify it's gone
      const { data: listData } = await get<{ tags: unknown[] }>("/api/tags");
      expect(listData.tags).toEqual([]);
    });

    it("returns 404 for non-existent tag", async () => {
      const { status, data } = await del<{ error: string }>(
        "/api/tags/no-such-id",
      );
      expect(status).toBe(404);
      expect(data?.error).toContain("not found");
    });
  });
});

// ── GET /api/live ───────────────────────────────────────────

describe("Live Health Check API", () => {
  it("returns ok with version and D1 latency", async () => {
    const { status, data } = await get<{
      status: string;
      version: string;
      d1: { latencyMs: number };
    }>("/api/live");
    expect(status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.version).toBeTruthy();
    expect(data.d1.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
