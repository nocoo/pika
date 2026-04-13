/**
 * Worker stats route handler tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { Env } from "../index";
import { handleStats } from "./stats";

// ── Mock helpers ───────────────────────────────────────────────

function mockEnv(opts?: {
  overview?: unknown;
  weekCount?: unknown;
  sources?: unknown[];
  daily?: unknown[];
  topProjects?: unknown[];
}): Env {
  const {
    overview = null,
    weekCount = null,
    sources = [],
    daily = [],
    topProjects = [],
  } = opts ?? {};

  // Track call index for sequential first/all responses
  let firstCallIndex = 0;
  let allCallIndex = 0;

  const preparedStmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockImplementation(() => {
      const results = [overview, weekCount];
      return Promise.resolve(results[firstCallIndex++] ?? null);
    }),
    all: vi.fn().mockImplementation(() => {
      const results = [
        { results: sources },
        { results: daily },
        { results: topProjects },
      ];
      return Promise.resolve(results[allCallIndex++] ?? { results: [] });
    }),
  };

  return {
    DB: {
      prepare: vi.fn().mockReturnValue(preparedStmt),
    } as unknown as D1Database,
    BUCKET: {} as R2Bucket,
    WORKER_SECRET: "test-secret",
  };
}

// ── handleStats tests ──────────────────────────────────────────

describe("handleStats", () => {
  it("returns dashboard statistics", async () => {
    const env = mockEnv({
      overview: {
        total_sessions: 100,
        total_messages: 500,
        total_input_tokens: 10000,
        total_output_tokens: 20000,
      },
      weekCount: { count: 15 },
      sources: [
        { source: "claude-code", count: 80 },
        { source: "codex", count: 20 },
      ],
      daily: [
        { date: "2026-01-01", count: 5 },
        { date: "2026-01-02", count: 10 },
      ],
      topProjects: [{ project_key: "pika", project_name: "pika", count: 50 }],
    });

    const res = await handleStats("user-1", env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.overview).toBeDefined();
    expect(body.overview.totalSessions).toBe(100);
    expect(body.overview.totalMessages).toBe(500);
    expect(body.overview.sessionsThisWeek).toBe(15);
    expect(body.sourceDistribution).toBeDefined();
    expect(body.dailyActivity).toBeDefined();
    expect(body.topProjects).toBeDefined();
  });

  it("handles empty data gracefully", async () => {
    const env = mockEnv({});

    const res = await handleStats("user-1", env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.overview.totalSessions).toBe(0);
    expect(body.overview.totalMessages).toBe(0);
    expect(body.overview.sessionsThisWeek).toBe(0);
    expect(body.sourceDistribution).toEqual([]);
    expect(body.dailyActivity).toEqual([]);
    expect(body.topProjects).toEqual([]);
  });
});
