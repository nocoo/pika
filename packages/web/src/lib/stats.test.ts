import { describe, it, expect } from "vitest";
import {
  buildOverviewQuery,
  buildWeekCountQuery,
  buildSourceDistributionQuery,
  buildDailyActivityQuery,
  buildTopProjectsQuery,
  assembleOverviewStats,
} from "./stats";

// ── buildOverviewQuery ─────────────────────────────────────────

describe("buildOverviewQuery", () => {
  it("returns SQL with userId param", () => {
    const { sql, params } = buildOverviewQuery("u1");

    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("SUM(total_messages)");
    expect(sql).toContain("SUM(total_input_tokens)");
    expect(sql).toContain("SUM(total_output_tokens)");
    expect(sql).toContain("WHERE user_id = ?");
    expect(params).toEqual(["u1"]);
  });
});

// ── buildWeekCountQuery ────────────────────────────────────────

describe("buildWeekCountQuery", () => {
  it("queries sessions from last 7 days", () => {
    const { sql, params } = buildWeekCountQuery("u1");

    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("datetime('now', '-7 days')");
    expect(sql).toContain("user_id = ?");
    expect(params).toEqual(["u1"]);
  });
});

// ── buildSourceDistributionQuery ───────────────────────────────

describe("buildSourceDistributionQuery", () => {
  it("groups by source and orders by count", () => {
    const { sql, params } = buildSourceDistributionQuery("u1");

    expect(sql).toContain("GROUP BY source");
    expect(sql).toContain("ORDER BY count DESC");
    expect(sql).toContain("user_id = ?");
    expect(params).toEqual(["u1"]);
  });
});

// ── buildDailyActivityQuery ────────────────────────────────────

describe("buildDailyActivityQuery", () => {
  it("defaults to 90 days", () => {
    const { sql, params } = buildDailyActivityQuery("u1");

    expect(sql).toContain("date(started_at) AS date");
    expect(sql).toContain("GROUP BY date(started_at)");
    expect(sql).toContain("ORDER BY date ASC");
    expect(params).toEqual(["u1", "-90"]);
  });

  it("accepts custom day count", () => {
    const { params } = buildDailyActivityQuery("u1", 30);
    expect(params).toEqual(["u1", "-30"]);
  });
});

// ── buildTopProjectsQuery ──────────────────────────────────────

describe("buildTopProjectsQuery", () => {
  it("groups by project_ref and limits to 10", () => {
    const { sql, params } = buildTopProjectsQuery("u1");

    expect(sql).toContain("GROUP BY project_ref");
    expect(sql).toContain("ORDER BY count DESC");
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("project_ref IS NOT NULL");
    expect(params).toEqual(["u1"]);
  });
});

// ── assembleOverviewStats ──────────────────────────────────────

describe("assembleOverviewStats", () => {
  it("assembles stats from query results", () => {
    const result = assembleOverviewStats(
      {
        total_sessions: 100,
        total_messages: 5000,
        total_input_tokens: 1000000,
        total_output_tokens: 500000,
      },
      { count: 15 },
    );

    expect(result).toEqual({
      totalSessions: 100,
      totalMessages: 5000,
      totalInputTokens: 1000000,
      totalOutputTokens: 500000,
      sessionsThisWeek: 15,
    });
  });

  it("returns zeros for null results", () => {
    const result = assembleOverviewStats(null, null);

    expect(result).toEqual({
      totalSessions: 0,
      totalMessages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      sessionsThisWeek: 0,
    });
  });

  it("handles partial null fields", () => {
    const result = assembleOverviewStats(
      {
        total_sessions: 5,
        total_messages: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
      },
      { count: 0 },
    );

    expect(result.totalSessions).toBe(5);
    expect(result.sessionsThisWeek).toBe(0);
  });
});
