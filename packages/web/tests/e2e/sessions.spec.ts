/**
 * E2E tests for sessions API endpoints.
 *
 * Covers:
 * - GET /api/sessions (list, pagination, sorting)
 * - GET /api/sessions/[id] (detail)
 * - PATCH /api/sessions/[id]/star (toggle star)
 * - PATCH /api/sessions/[id]/trash (soft delete/restore)
 * - GET /api/sessions/[id]/tags (session tags)
 * - PUT /api/sessions/[id]/tags (add tag to session)
 * - DELETE /api/sessions/[id]/tags (remove tag from session)
 * - POST /api/sessions/batch (batch operations)
 * - GET /api/sessions/filters (filter options)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  get,
  post,
  patch,
  put,
  del,
  cleanupTestData,
  ensureTestUser,
  seedSession,
  seedSessions,
  d1Execute,
  d1Query,
  testId,
} from "./helpers";

describe("Sessions API", () => {
  beforeAll(async () => {
    await ensureTestUser();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ── GET /api/sessions ───────────────────────────────────────

  describe("GET /api/sessions", () => {
    it("returns empty list when no sessions", async () => {
      const { status, data } = await get<{
        sessions: unknown[];
        hasMore: boolean;
      }>("/api/sessions");
      expect(status).toBe(200);
      expect(data.sessions).toEqual([]);
      expect(data.hasMore).toBe(false);
    });

    it("returns seeded sessions", async () => {
      await seedSessions([
        { id: testId("s"), session_key: `claude:${testId("k")}`, title: "First" },
        { id: testId("s"), session_key: `claude:${testId("k")}`, title: "Second" },
      ]);

      const { status, data } = await get<{
        sessions: Array<{ title: string }>;
      }>("/api/sessions");
      expect(status).toBe(200);
      expect(data.sessions).toHaveLength(2);
    });

    it("supports limit parameter", async () => {
      await seedSessions([
        { id: testId("s"), session_key: `claude:${testId("k")}` },
        { id: testId("s"), session_key: `claude:${testId("k")}` },
        { id: testId("s"), session_key: `claude:${testId("k")}` },
      ]);

      const { status, data } = await get<{
        sessions: unknown[];
        hasMore: boolean;
      }>("/api/sessions", { limit: "2" });
      expect(status).toBe(200);
      expect(data.sessions).toHaveLength(2);
      expect(data.hasMore).toBe(true);
    });

    it("supports offset pagination with page param", async () => {
      await seedSessions([
        { id: testId("s"), session_key: `claude:${testId("k")}` },
        { id: testId("s"), session_key: `claude:${testId("k")}` },
        { id: testId("s"), session_key: `claude:${testId("k")}` },
      ]);

      const { status, data } = await get<{
        sessions: unknown[];
        totalCount: number;
        page: number;
      }>("/api/sessions", { page: "1", limit: "2" });
      expect(status).toBe(200);
      expect(data.sessions).toHaveLength(2);
      expect(data.totalCount).toBe(3);
      expect(data.page).toBe(1);
    });

    it("excludes soft-deleted sessions by default", async () => {
      const activeId = testId("active");
      const deletedId = testId("deleted");

      await seedSessions([
        { id: activeId, session_key: `claude:${activeId}`, title: "Active" },
        {
          id: deletedId,
          session_key: `claude:${deletedId}`,
          title: "Deleted",
          deleted_at: "2025-01-01T00:00:00Z",
        },
      ]);

      const { data } = await get<{
        sessions: Array<{ id: string }>;
      }>("/api/sessions");
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe(activeId);
    });

    it("filters by source", async () => {
      await seedSessions([
        {
          id: testId("s"),
          session_key: `claude:${testId("k")}`,
          source: "claude-code",
        },
        {
          id: testId("s"),
          session_key: `codex:${testId("k")}`,
          source: "codex",
        },
      ]);

      const { data } = await get<{
        sessions: Array<{ source: string }>;
      }>("/api/sessions", { source: "codex" });
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].source).toBe("codex");
    });

    it("filters by starred", async () => {
      await seedSessions([
        {
          id: testId("s"),
          session_key: `claude:${testId("k")}`,
          is_starred: 1,
          title: "Starred",
        },
        {
          id: testId("s"),
          session_key: `claude:${testId("k")}`,
          is_starred: 0,
          title: "Not Starred",
        },
      ]);

      const { data } = await get<{
        sessions: Array<{ title: string }>;
      }>("/api/sessions", { starred: "true" });
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].title).toBe("Starred");
    });
  });

  // ── GET /api/sessions/[id] ─────────────────────────────────

  describe("GET /api/sessions/[id]", () => {
    it("returns session detail", async () => {
      const id = testId("detail");
      await seedSession({
        id,
        session_key: `claude:${id}`,
        title: "Detail Test",
        model: "claude-sonnet-4-20250514",
      });

      const { status, data } = await get<{
        session: { id: string; title: string; model: string };
      }>(`/api/sessions/${id}`);
      expect(status).toBe(200);
      expect(data.session.id).toBe(id);
      expect(data.session.title).toBe("Detail Test");
      expect(data.session.model).toBe("claude-sonnet-4-20250514");
    });

    it("returns 404 for non-existent session", async () => {
      const { status, data } = await get<{ error: string }>(
        "/api/sessions/non-existent-id",
      );
      expect(status).toBe(404);
      expect(data.error).toBe("Session not found");
    });
  });

  // ── PATCH /api/sessions/[id]/star ──────────────────────────

  describe("PATCH /api/sessions/[id]/star", () => {
    it("stars a session", async () => {
      const id = testId("star");
      await seedSession({ id, session_key: `claude:${id}` });

      const { status, data } = await patch<{ starred: boolean }>(
        `/api/sessions/${id}/star`,
        { starred: true },
      );
      expect(status).toBe(200);
      expect(data.starred).toBe(true);

      // Verify via list
      const { data: listData } = await get<{
        sessions: Array<{ id: string; is_starred: number }>;
      }>("/api/sessions", { starred: "true" });
      expect(listData.sessions.some((s) => s.id === id)).toBe(true);
    });

    it("unstars a session", async () => {
      const id = testId("unstar");
      await seedSession({ id, session_key: `claude:${id}`, is_starred: 1 });

      const { status, data } = await patch<{ starred: boolean }>(
        `/api/sessions/${id}/star`,
        { starred: false },
      );
      expect(status).toBe(200);
      expect(data.starred).toBe(false);
    });

    it("returns 400 for invalid body", async () => {
      const id = testId("star-bad");
      await seedSession({ id, session_key: `claude:${id}` });

      const { status, data } = await patch<{ error: string }>(
        `/api/sessions/${id}/star`,
        { starred: "not-boolean" },
      );
      expect(status).toBe(400);
      expect(data.error).toContain("starred");
    });
  });

  // ── PATCH /api/sessions/[id]/trash ─────────────────────────

  describe("PATCH /api/sessions/[id]/trash", () => {
    it("soft-deletes a session", async () => {
      const id = testId("trash");
      await seedSession({ id, session_key: `claude:${id}` });

      const { status, data } = await patch<{
        deleted: boolean;
        deleted_at: string | null;
      }>(`/api/sessions/${id}/trash`, { deleted: true });
      expect(status).toBe(200);
      expect(data.deleted).toBe(true);
      expect(data.deleted_at).toBeTruthy();

      // Verify it's excluded from default list
      const { data: listData } = await get<{
        sessions: Array<{ id: string }>;
      }>("/api/sessions");
      expect(listData.sessions.some((s) => s.id === id)).toBe(false);
    });

    it("restores a soft-deleted session", async () => {
      const id = testId("restore");
      await seedSession({
        id,
        session_key: `claude:${id}`,
        deleted_at: "2025-01-01T00:00:00Z",
      });

      const { status, data } = await patch<{
        deleted: boolean;
        deleted_at: string | null;
      }>(`/api/sessions/${id}/trash`, { deleted: false });
      expect(status).toBe(200);
      expect(data.deleted).toBe(false);
      expect(data.deleted_at).toBeNull();
    });

    it("returns 400 for invalid body", async () => {
      const id = testId("trash-bad");
      await seedSession({ id, session_key: `claude:${id}` });

      const { status, data } = await patch<{ error: string }>(
        `/api/sessions/${id}/trash`,
        { deleted: 42 },
      );
      expect(status).toBe(400);
      expect(data.error).toContain("deleted");
    });
  });

  // ── Session Tags ───────────────────────────────────────────

  describe("Session Tags (GET/PUT/DELETE /api/sessions/[id]/tags)", () => {
    it("returns empty tags for a session", async () => {
      const id = testId("tags-empty");
      await seedSession({ id, session_key: `claude:${id}` });

      const { status, data } = await get<{ tags: unknown[] }>(
        `/api/sessions/${id}/tags`,
      );
      expect(status).toBe(200);
      expect(data.tags).toEqual([]);
    });

    it("adds and lists a tag on a session", async () => {
      const sessionId = testId("tags-add");
      await seedSession({ id: sessionId, session_key: `claude:${sessionId}` });

      // Create a tag first
      const { data: tagData } = await post<{
        tag: { id: string; name: string };
      }>("/api/tags", { name: "e2e-tag", color: "#ff0000" });
      const tagId = tagData.tag.id;

      // Add tag to session
      const { status } = await put(`/api/sessions/${sessionId}/tags`, {
        tagId,
      });
      expect(status).toBe(200);

      // Verify tag is listed on session
      const { data: sessionTags } = await get<{
        tags: Array<{ id: string; name: string }>;
      }>(`/api/sessions/${sessionId}/tags`);
      expect(sessionTags.tags).toHaveLength(1);
      expect(sessionTags.tags[0].name).toBe("e2e-tag");
    });

    it("removes a tag from a session", async () => {
      const sessionId = testId("tags-rm");
      await seedSession({ id: sessionId, session_key: `claude:${sessionId}` });

      // Create and add a tag
      const { data: tagData } = await post<{
        tag: { id: string };
      }>("/api/tags", { name: "e2e-rm-tag" });
      const tagId = tagData.tag.id;
      await put(`/api/sessions/${sessionId}/tags`, { tagId });

      // Remove it
      const { status } = await del(`/api/sessions/${sessionId}/tags`, {
        tagId,
      });
      expect(status).toBe(204);

      // Verify removed
      const { data } = await get<{ tags: unknown[] }>(
        `/api/sessions/${sessionId}/tags`,
      );
      expect(data.tags).toHaveLength(0);
    });

    it("returns 404 for non-existent session", async () => {
      const { status } = await get("/api/sessions/no-such-id/tags");
      expect(status).toBe(404);
    });

    it("returns 404 for non-existent tag on PUT", async () => {
      const sessionId = testId("tags-404");
      await seedSession({ id: sessionId, session_key: `claude:${sessionId}` });

      const { status } = await put(`/api/sessions/${sessionId}/tags`, {
        tagId: "no-such-tag",
      });
      expect(status).toBe(404);
    });
  });

  // ── POST /api/sessions/batch ───────────────────────────────

  describe("POST /api/sessions/batch", () => {
    it("batch-stars sessions by IDs", async () => {
      const ids = [testId("b1"), testId("b2"), testId("b3")];
      await seedSessions(
        ids.map((id) => ({ id, session_key: `claude:${id}` })),
      );

      const { status, data } = await post<{ affected: number }>(
        "/api/sessions/batch",
        { action: "star", ids },
      );
      expect(status).toBe(200);
      expect(data.affected).toBe(3);

      // Verify they're starred
      const { data: listData } = await get<{
        sessions: Array<{ id: string }>;
      }>("/api/sessions", { starred: "true" });
      expect(listData.sessions).toHaveLength(3);
    });

    it("batch-deletes sessions by IDs", async () => {
      const ids = [testId("bd1"), testId("bd2")];
      await seedSessions(
        ids.map((id) => ({ id, session_key: `claude:${id}` })),
      );

      const { status, data } = await post<{ affected: number }>(
        "/api/sessions/batch",
        { action: "delete", ids },
      );
      expect(status).toBe(200);
      expect(data.affected).toBe(2);

      // Verify they're excluded from default list
      const { data: listData } = await get<{
        sessions: Array<{ id: string }>;
      }>("/api/sessions");
      expect(listData.sessions.filter((s) => ids.includes(s.id))).toHaveLength(
        0,
      );
    });

    it("batch-restores soft-deleted sessions", async () => {
      const ids = [testId("br1"), testId("br2")];
      await seedSessions(
        ids.map((id) => ({
          id,
          session_key: `claude:${id}`,
          deleted_at: "2025-01-01T00:00:00Z",
        })),
      );

      const { status, data } = await post<{ affected: number }>(
        "/api/sessions/batch",
        { action: "restore", ids },
      );
      expect(status).toBe(200);
      expect(data.affected).toBe(2);
    });

    it("returns 400 for invalid action", async () => {
      const { status, data } = await post<{ error: string }>(
        "/api/sessions/batch",
        { action: "invalid", ids: ["x"] },
      );
      expect(status).toBe(400);
      expect(data.error).toContain("Invalid action");
    });

    it("returns 400 when neither ids nor filter provided", async () => {
      const { status, data } = await post<{ error: string }>(
        "/api/sessions/batch",
        { action: "star" },
      );
      expect(status).toBe(400);
      expect(data.error).toContain("ids or filter");
    });

    it("returns 400 when both ids and filter provided", async () => {
      const { status, data } = await post<{ error: string }>(
        "/api/sessions/batch",
        { action: "star", ids: ["x"], filter: { source: "codex" } },
      );
      expect(status).toBe(400);
      expect(data.error).toContain("not both");
    });

    it("batch by filter — star all codex sessions", async () => {
      await seedSessions([
        {
          id: testId("bf1"),
          session_key: `claude:${testId("k")}`,
          source: "claude-code",
        },
        {
          id: testId("bf2"),
          session_key: `codex:${testId("k")}`,
          source: "codex",
        },
        {
          id: testId("bf3"),
          session_key: `codex:${testId("k")}`,
          source: "codex",
        },
      ]);

      const { status, data } = await post<{ affected: number }>(
        "/api/sessions/batch",
        { action: "star", filter: { source: "codex" } },
      );
      expect(status).toBe(200);
      expect(data.affected).toBe(2);
    });
  });

  // ── GET /api/sessions/filters ──────────────────────────────

  describe("GET /api/sessions/filters", () => {
    it("returns filter options", async () => {
      await seedSessions([
        {
          id: testId("f1"),
          session_key: `claude:${testId("k")}`,
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          project_ref: "proj-a",
          project_name: "Project A",
        },
        {
          id: testId("f2"),
          session_key: `codex:${testId("k")}`,
          source: "codex",
          model: "gpt-4o",
          project_ref: "proj-b",
          project_name: "Project B",
        },
      ]);

      const { status, data } = await get<{
        models: string[];
        projects: Array<{ ref: string; name: string | null }>;
      }>("/api/sessions/filters");
      expect(status).toBe(200);
      expect(data.models).toContain("claude-sonnet-4-20250514");
      expect(data.models).toContain("gpt-4o");
      expect(data.projects.some((p) => p.ref === "proj-a")).toBe(true);
      expect(data.projects.some((p) => p.ref === "proj-b")).toBe(true);
    });

    it("returns empty arrays when no sessions", async () => {
      const { status, data } = await get<{
        models: string[];
        projects: unknown[];
      }>("/api/sessions/filters");
      expect(status).toBe(200);
      expect(data.models).toEqual([]);
      expect(data.projects).toEqual([]);
    });
  });
});
