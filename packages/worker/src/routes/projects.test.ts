/**
 * Worker projects route handlers tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { Env } from "../index";
import { handleListProjects, handleProjectActivity } from "./projects";

// ── Mock helpers ───────────────────────────────────────────────

function mockD1(opts?: {
  results?: unknown[];
  firstResult?: unknown;
  batchResults?: unknown[][];
}): D1Database {
  const {
    results = [],
    firstResult = null,
    batchResults = [[firstResult], results],
  } = opts ?? {};

  const preparedStmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
    first: vi.fn().mockResolvedValue(firstResult),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  };

  return {
    prepare: vi.fn().mockReturnValue(preparedStmt),
    batch: vi.fn().mockResolvedValue(
      batchResults.map((r) => ({
        results: Array.isArray(r) ? r : [r],
      })),
    ),
  } as unknown as D1Database;
}

function mockEnv(dbOpts?: Parameters<typeof mockD1>[0]): Env {
  return {
    DB: mockD1(dbOpts),
    BUCKET: {} as R2Bucket,
    WORKER_SECRET: "test-secret",
  };
}

// ── handleListProjects tests ───────────────────────────────────

describe("handleListProjects", () => {
  it("returns projects with overview and source distribution", async () => {
    const projects = [
      {
        project_key: "pika",
        project_name: "pika",
        session_count: 10,
        total_messages: 100,
      },
    ];
    const overview = {
      total_projects: 1,
      total_sessions: 10,
      total_messages: 100,
    };
    const sources = [{ project_key: "pika", source: "claude-code", count: 10 }];

    const env = mockEnv({
      batchResults: [projects, [overview], sources],
    });

    const params = new URLSearchParams();
    const res = await handleListProjects("user-1", params, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.projects).toBeDefined();
    expect(body.overview).toBeDefined();
    expect(body.sourceDistribution).toBeDefined();
  });

  it("returns empty data when no projects", async () => {
    const env = mockEnv({
      batchResults: [[], [null], []],
    });

    const params = new URLSearchParams();
    const res = await handleListProjects("user-1", params, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.projects).toEqual([]);
    expect(body.overview.totalProjects).toBe(0);
  });
});

// ── handleProjectActivity tests ────────────────────────────────

describe("handleProjectActivity", () => {
  it("returns daily activity for a project", async () => {
    const activity = [
      {
        date: "2026-01-01",
        sessions: 5,
        messages: 50,
        tokens: 10000,
        duration: 3600,
      },
      {
        date: "2026-01-02",
        sessions: 3,
        messages: 30,
        tokens: 6000,
        duration: 1800,
      },
    ];
    const env = mockEnv({ results: activity });

    const params = new URLSearchParams({ projectKey: "pika" });
    const res = await handleProjectActivity("user-1", params, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.activity).toEqual(activity);
  });

  it("returns 400 when projectKey is missing", async () => {
    const env = mockEnv();

    const params = new URLSearchParams();
    const res = await handleProjectActivity("user-1", params, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("projectKey or project is required");
  });

  it("handles multiple project keys", async () => {
    const activity = [
      {
        date: "2026-01-01",
        sessions: 8,
        messages: 80,
        tokens: 16000,
        duration: 7200,
      },
    ];
    const env = mockEnv({ results: activity });

    const params = new URLSearchParams({ projectKey: "pika,claude" });
    const res = await handleProjectActivity("user-1", params, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.activity).toEqual(activity);
  });

  it("respects days parameter", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ projectKey: "pika", days: "30" });
    await handleProjectActivity("user-1", params, env);

    // Verify the SQL binding includes the days parameter
    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    expect(bindArgs).toContain("-30");
  });

  it("enforces maximum days", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ projectKey: "pika", days: "999" });
    await handleProjectActivity("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    expect(bindArgs).toContain("-365");
  });

  it("defaults to 90 days for invalid input", async () => {
    const env = mockEnv({ results: [] });

    const params = new URLSearchParams({ projectKey: "pika", days: "invalid" });
    await handleProjectActivity("user-1", params, env);

    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    expect(bindArgs).toContain("-90");
  });
});
