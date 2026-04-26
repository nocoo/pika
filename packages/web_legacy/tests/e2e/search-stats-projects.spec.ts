/**
 * E2E tests for search, stats, and projects API endpoints.
 *
 * Covers:
 * - GET /api/search (FTS5 search, requires seeded message_chunks)
 * - GET /api/stats (overview, source distribution, daily activity, top projects)
 * - GET /api/projects (project list, overview, source distribution)
 * - GET /api/projects/activity (per-project daily activity)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  get,
  cleanupTestData,
  ensureTestUser,
  seedSession,
  seedSessions,
  d1Execute,
  testId,
  E2E_USER,
} from "./helpers";

describe("Search, Stats & Projects API", () => {
  beforeAll(async () => {
    await ensureTestUser();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ── GET /api/search ─────────────────────────────────────────

  describe("GET /api/search", () => {
    it("returns empty results when no data", async () => {
      const { status, data } = await get<{
        results: unknown[];
        total: number;
      }>("/api/search", { q: "anything" });
      expect(status).toBe(200);
      expect(data.results).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("returns 400 when no query provided", async () => {
      const { status, data } = await get<{ error: string }>("/api/search");
      expect(status).toBe(400);
      expect(data.error).toBeTruthy();
    });

    it("searches across message_chunks via FTS", async () => {
      const sessionId = testId("search");
      const messageId = testId("msg");
      const chunkId = testId("chunk");

      // Seed a session + message + chunk with searchable content
      await seedSession({
        id: sessionId,
        session_key: `claude:${sessionId}`,
        title: "Search Test Session",
      });

      // Insert a message
      await d1Execute(
        `INSERT INTO messages (id, session_id, user_id, role, ordinal, timestamp)
         VALUES (?1, ?2, ?3, 'assistant', 1, '2025-01-01T00:00:00Z')`,
        [messageId, sessionId, E2E_USER.userId],
      );

      // Insert a message_chunk (this triggers FTS indexing)
      await d1Execute(
        `INSERT INTO message_chunks (id, session_id, message_id, user_id, ordinal, chunk_index, content)
         VALUES (?1, ?2, ?3, ?4, 1, 0, ?5)`,
        [
          chunkId,
          sessionId,
          messageId,
          E2E_USER.userId,
          "The fibonacci sequence implementation uses memoization for performance",
        ],
      );

      const { status, data } = await get<{
        results: Array<{ session_id: string }>;
        total: number;
      }>("/api/search", { q: "fibonacci" });
      expect(status).toBe(200);
      expect(data.total).toBeGreaterThanOrEqual(1);
      expect(
        data.results.some((r) => r.session_id === sessionId),
      ).toBe(true);
    });
  });

  // ── GET /api/stats ──────────────────────────────────────────

  describe("GET /api/stats", () => {
    it("returns zero stats when no sessions", async () => {
      const { status, data } = await get<{
        overview: {
          totalSessions: number;
          totalMessages: number;
        };
        sourceDistribution: unknown[];
        dailyActivity: unknown[];
        topProjects: unknown[];
      }>("/api/stats");
      expect(status).toBe(200);
      expect(data.overview.totalSessions).toBe(0);
      expect(data.overview.totalMessages).toBe(0);
      expect(data.sourceDistribution).toEqual([]);
      expect(data.dailyActivity).toEqual([]);
      expect(data.topProjects).toEqual([]);
    });

    it("returns aggregated stats for seeded sessions", async () => {
      await seedSessions([
        {
          id: testId("st1"),
          session_key: `claude:${testId("k")}`,
          source: "claude-code",
          total_messages: 20,
          total_input_tokens: 5000,
          total_output_tokens: 2000,
          project_ref: "proj-alpha",
          project_name: "Alpha",
        },
        {
          id: testId("st2"),
          session_key: `codex:${testId("k")}`,
          source: "codex",
          total_messages: 10,
          total_input_tokens: 3000,
          total_output_tokens: 1000,
          project_ref: "proj-beta",
          project_name: "Beta",
        },
      ]);

      const { status, data } = await get<{
        overview: {
          totalSessions: number;
          totalMessages: number;
          totalInputTokens: number;
          totalOutputTokens: number;
        };
        sourceDistribution: Array<{ source: string; count: number }>;
        topProjects: Array<{ project_name: string }>;
      }>("/api/stats");
      expect(status).toBe(200);
      expect(data.overview.totalSessions).toBe(2);
      expect(data.overview.totalMessages).toBe(30);
      expect(data.overview.totalInputTokens).toBe(8000);
      expect(data.overview.totalOutputTokens).toBe(3000);
      expect(data.sourceDistribution.length).toBeGreaterThanOrEqual(1);
      expect(data.topProjects.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── GET /api/projects ───────────────────────────────────────

  describe("GET /api/projects", () => {
    it("returns empty when no sessions", async () => {
      const { status, data } = await get<{
        overview: { total_projects: number };
        projects: unknown[];
        sourceDistribution: unknown;
      }>("/api/projects");
      expect(status).toBe(200);
      expect(data.projects).toEqual([]);
    });

    it("returns project list with stats", async () => {
      await seedSessions([
        {
          id: testId("p1"),
          session_key: `claude:${testId("k")}`,
          project_ref: "my-project",
          project_name: "My Project",
          total_messages: 15,
          source: "claude-code",
        },
        {
          id: testId("p2"),
          session_key: `claude:${testId("k")}`,
          project_ref: "my-project",
          project_name: "My Project",
          total_messages: 25,
          source: "claude-code",
        },
        {
          id: testId("p3"),
          session_key: `codex:${testId("k")}`,
          project_ref: "other-project",
          project_name: "Other Project",
          total_messages: 5,
          source: "codex",
        },
      ]);

      const { status, data } = await get<{
        overview: {
          total_projects: number;
          total_sessions: number;
        };
        projects: Array<{
          project_key: string;
          project_name: string | null;
          session_count: number;
          total_messages: number;
        }>;
      }>("/api/projects");
      expect(status).toBe(200);
      expect(data.projects.length).toBe(2);

      const myProj = data.projects.find(
        (p) => p.project_key === "My Project",
      );
      expect(myProj).toBeDefined();
      expect(myProj!.session_count).toBe(2);
      expect(myProj!.total_messages).toBe(40);
    });
  });

  // ── GET /api/projects/activity ──────────────────────────────

  describe("GET /api/projects/activity", () => {
    it("returns 400 when project param missing", async () => {
      const { status, data } = await get<{ error: string }>(
        "/api/projects/activity",
      );
      expect(status).toBe(400);
      expect(data.error).toContain("project");
    });

    it("returns empty activity for non-existent project", async () => {
      const { status, data } = await get<{
        activity: unknown[];
      }>("/api/projects/activity", { project: "no-such-project" });
      expect(status).toBe(200);
      expect(data.activity).toEqual([]);
    });

    it("returns daily activity for a project", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await seedSessions([
        {
          id: testId("pa1"),
          session_key: `claude:${testId("k")}`,
          project_ref: "activity-proj",
          project_name: null as unknown as string,
          started_at: `${today}T10:00:00Z`,
          last_message_at: `${today}T11:00:00Z`,
          total_messages: 10,
        },
      ]);

      const { status, data } = await get<{
        activity: Array<{ date: string; count: number }>;
      }>("/api/projects/activity", { project: "activity-proj" });
      expect(status).toBe(200);
      expect(data.activity.length).toBeGreaterThanOrEqual(1);
    });
  });
});
