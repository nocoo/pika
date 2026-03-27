import type { Source } from "@pika/core";
import { describe, expect, it } from "vitest";
import {
  assembleProjectOverview,
  buildProjectDailyActivityQuery,
  buildProjectListQuery,
  buildProjectOverviewQuery,
  buildProjectSourceDistributionQuery,
  groupSourceDistribution,
} from "./projects";

// ── buildProjectListQuery ─────────────────────────────────────

describe("buildProjectListQuery", () => {
  it("returns SQL with userId param", () => {
    const { sql, params } = buildProjectListQuery("u1");

    expect(sql).toContain("COALESCE(project_name, project_ref) AS project_key");
    expect(sql).toContain("GROUP_CONCAT(DISTINCT project_ref) AS project_refs");
    expect(sql).toContain("COUNT(*) AS session_count");
    expect(sql).toContain("SUM(total_messages)");
    expect(sql).toContain("SUM(total_input_tokens)");
    expect(sql).toContain("SUM(total_output_tokens)");
    expect(sql).toContain("MAX(last_message_at) AS last_activity");
    expect(sql).toContain("GROUP BY COALESCE(project_name, project_ref)");
    expect(sql).toContain("ORDER BY session_count DESC");
    expect(params).toEqual(["u1"]);
  });

  it("excludes deleted sessions", () => {
    const { sql } = buildProjectListQuery("u1");
    expect(sql).toContain("deleted_at IS NULL");
  });

  it("excludes sessions without project_ref", () => {
    const { sql } = buildProjectListQuery("u1");
    expect(sql).toContain("project_ref IS NOT NULL");
  });
});

// ── buildProjectOverviewQuery ─────────────────────────────────

describe("buildProjectOverviewQuery", () => {
  it("returns SQL with aggregate totals", () => {
    const { sql, params } = buildProjectOverviewQuery("u1");

    expect(sql).toContain(
      "COUNT(DISTINCT COALESCE(project_name, project_ref)) AS total_projects",
    );
    expect(sql).toContain("COUNT(*) AS total_sessions");
    expect(sql).toContain("SUM(total_messages)");
    expect(sql).toContain("SUM(total_input_tokens)");
    expect(sql).toContain("SUM(total_output_tokens)");
    expect(params).toEqual(["u1"]);
  });

  it("excludes deleted sessions", () => {
    const { sql } = buildProjectOverviewQuery("u1");
    expect(sql).toContain("deleted_at IS NULL");
  });

  it("excludes sessions without project_ref", () => {
    const { sql } = buildProjectOverviewQuery("u1");
    expect(sql).toContain("project_ref IS NOT NULL");
  });
});

// ── buildProjectSourceDistributionQuery ───────────────────────

describe("buildProjectSourceDistributionQuery", () => {
  it("groups by project_key and source", () => {
    const { sql, params } = buildProjectSourceDistributionQuery("u1");

    expect(sql).toContain("COALESCE(project_name, project_ref) AS project_key");
    expect(sql).toContain(
      "GROUP BY COALESCE(project_name, project_ref), source",
    );
    expect(sql).toContain("ORDER BY project_key, count DESC");
    expect(params).toEqual(["u1"]);
  });

  it("excludes deleted sessions", () => {
    const { sql } = buildProjectSourceDistributionQuery("u1");
    expect(sql).toContain("deleted_at IS NULL");
  });

  it("excludes sessions without project_ref", () => {
    const { sql } = buildProjectSourceDistributionQuery("u1");
    expect(sql).toContain("project_ref IS NOT NULL");
  });
});

// ── buildProjectDailyActivityQuery ────────────────────────────

describe("buildProjectDailyActivityQuery", () => {
  it("defaults to 90 days", () => {
    const { sql, params } = buildProjectDailyActivityQuery("u1", "abc123");

    expect(sql).toContain("date(started_at) AS date");
    expect(sql).toContain("GROUP BY date(started_at)");
    expect(sql).toContain("ORDER BY date ASC");
    expect(sql).toContain("COALESCE(project_name, project_ref) = ?");
    expect(params).toEqual(["u1", "abc123", "-90"]);
  });

  it("accepts custom day count", () => {
    const { params } = buildProjectDailyActivityQuery("u1", "abc123", 30);
    expect(params).toEqual(["u1", "abc123", "-30"]);
  });

  it("excludes deleted sessions", () => {
    const { sql } = buildProjectDailyActivityQuery("u1", "abc123");
    expect(sql).toContain("deleted_at IS NULL");
  });

  it("supports comma-separated multi-key for merged projects", () => {
    const { sql, params } = buildProjectDailyActivityQuery(
      "u1",
      "/path/a,/path/b",
    );

    expect(sql).toContain("COALESCE(project_name, project_ref) IN (?, ?)");
    expect(sql).not.toContain("project_ref) = ?");
    expect(params).toEqual(["u1", "/path/a", "/path/b", "-90"]);
  });
});

// ── assembleProjectOverview ───────────────────────────────────

describe("assembleProjectOverview", () => {
  it("assembles stats from query row", () => {
    const result = assembleProjectOverview({
      total_projects: 5,
      total_sessions: 100,
      total_messages: 5000,
      total_input_tokens: 1000000,
      total_output_tokens: 500000,
    });

    expect(result).toEqual({
      totalProjects: 5,
      totalSessions: 100,
      totalMessages: 5000,
      totalInputTokens: 1000000,
      totalOutputTokens: 500000,
    });
  });

  it("returns zeros for null row", () => {
    const result = assembleProjectOverview(null);

    expect(result).toEqual({
      totalProjects: 0,
      totalSessions: 0,
      totalMessages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  });
});

// ── groupSourceDistribution ───────────────────────────────────

describe("groupSourceDistribution", () => {
  it("groups rows by project_key", () => {
    const rows = [
      { project_key: "pika", source: "claude-code" as Source, count: 10 },
      { project_key: "pika", source: "codex" as Source, count: 3 },
      { project_key: "other", source: "claude-code" as Source, count: 7 },
    ];

    const result = groupSourceDistribution(rows);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result.pika).toEqual([
      { source: "claude-code", count: 10 },
      { source: "codex", count: 3 },
    ]);
    expect(result.other).toEqual([{ source: "claude-code", count: 7 }]);
  });

  it("returns empty object for empty input", () => {
    const result = groupSourceDistribution([]);
    expect(result).toEqual({});
  });
});
