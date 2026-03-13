import { describe, it, expect } from "vitest";
import {
  sourceLabel,
  formatDuration,
  relativeTime,
  formatDate,
  formatDateTime,
  buildHeatmapData,
} from "./format.js";

// ── sourceLabel ────────────────────────────────────────────────

describe("sourceLabel", () => {
  it("returns human-readable label for known sources", () => {
    expect(sourceLabel("claude-code")).toBe("Claude Code");
    expect(sourceLabel("codex")).toBe("Codex CLI");
    expect(sourceLabel("gemini-cli")).toBe("Gemini CLI");
    expect(sourceLabel("opencode")).toBe("OpenCode");
    expect(sourceLabel("vscode-copilot")).toBe("VS Code Copilot");
  });

  it("returns raw source for unknown source", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(sourceLabel("unknown-agent" as any)).toBe("unknown-agent");
  });
});

// ── formatDuration ─────────────────────────────────────────────

describe("formatDuration", () => {
  it("returns '0m' for negative seconds", () => {
    expect(formatDuration(-5)).toBe("0m");
  });

  it("returns '< 1m' for seconds under 60", () => {
    expect(formatDuration(0)).toBe("< 1m");
    expect(formatDuration(30)).toBe("< 1m");
    expect(formatDuration(59)).toBe("< 1m");
  });

  it("returns minutes for under an hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(300)).toBe("5m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("returns hours only when no remaining minutes", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(7200)).toBe("2h");
  });

  it("returns hours and minutes", () => {
    expect(formatDuration(5040)).toBe("1h 24m");
    expect(formatDuration(3660)).toBe("1h 1m");
  });
});

// ── relativeTime ───────────────────────────────────────────────

describe("relativeTime", () => {
  const now = new Date("2026-03-13T12:00:00Z");

  it("returns 'just now' for timestamps in the future", () => {
    expect(relativeTime("2026-03-13T13:00:00Z", now)).toBe("just now");
  });

  it("returns 'just now' for under a minute ago", () => {
    expect(relativeTime("2026-03-13T11:59:30Z", now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(relativeTime("2026-03-13T11:55:00Z", now)).toBe("5m ago");
    expect(relativeTime("2026-03-13T11:01:00Z", now)).toBe("59m ago");
  });

  it("returns hours ago", () => {
    expect(relativeTime("2026-03-13T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-03-12T13:00:00Z", now)).toBe("23h ago");
  });

  it("returns days ago for under 30 days", () => {
    expect(relativeTime("2026-03-12T10:00:00Z", now)).toBe("1d ago");
    expect(relativeTime("2026-02-12T10:00:00Z", now)).toBe("29d ago");
  });

  it("returns month + day for 30+ days ago", () => {
    const result = relativeTime("2026-01-15T10:00:00Z", now);
    expect(result).toMatch(/Jan\s+15/);
  });
});

// ── formatDate ─────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats ISO date to readable string", () => {
    const result = formatDate("2026-01-15T10:30:00Z");
    expect(result).toMatch(/Jan\s+15,\s+2026/);
  });
});

// ── formatDateTime ─────────────────────────────────────────────

describe("formatDateTime", () => {
  it("formats ISO timestamp with time", () => {
    const result = formatDateTime("2026-01-15T14:30:00Z");
    expect(result).toMatch(/Jan\s+15/);
  });
});

// ── buildHeatmapData ───────────────────────────────────────────

describe("buildHeatmapData", () => {
  const today = new Date("2026-03-13T00:00:00Z");

  it("returns correct number of days", () => {
    const result = buildHeatmapData([], 90, today);
    expect(result).toHaveLength(90);
  });

  it("fills missing days with count=0 and level=0", () => {
    const result = buildHeatmapData([], 7, today);
    expect(result).toHaveLength(7);
    for (const day of result) {
      expect(day.count).toBe(0);
      expect(day.level).toBe(0);
    }
  });

  it("maps sparse activity data to correct dates", () => {
    const activity = [
      { date: "2026-03-12", count: 5 },
      { date: "2026-03-13", count: 3 },
    ];
    const result = buildHeatmapData(activity, 3, today);
    expect(result[0]!.date).toBe("2026-03-11");
    expect(result[0]!.count).toBe(0);
    expect(result[1]!.date).toBe("2026-03-12");
    expect(result[1]!.count).toBe(5);
    expect(result[2]!.date).toBe("2026-03-13");
    expect(result[2]!.count).toBe(3);
  });

  it("assigns intensity levels based on max count", () => {
    const activity = [
      { date: "2026-03-10", count: 1 },
      { date: "2026-03-11", count: 3 },
      { date: "2026-03-12", count: 6 },
      { date: "2026-03-13", count: 8 },
    ];
    const result = buildHeatmapData(activity, 4, today);

    // max = 8
    // 1/8 = 0.125 -> level 1
    // 3/8 = 0.375 -> level 2
    // 6/8 = 0.75  -> level 3
    // 8/8 = 1.0   -> level 4
    expect(result[0]!.level).toBe(1);
    expect(result[1]!.level).toBe(2);
    expect(result[2]!.level).toBe(3);
    expect(result[3]!.level).toBe(4);
  });

  it("handles all-zero activity (no division by zero)", () => {
    const result = buildHeatmapData([], 3, today);
    for (const day of result) {
      expect(day.level).toBe(0);
    }
  });

  it("level boundaries: 0.25, 0.5, 0.75", () => {
    // max = 4
    const activity = [
      { date: "2026-03-10", count: 1 }, // 0.25 -> level 1
      { date: "2026-03-11", count: 2 }, // 0.50 -> level 2
      { date: "2026-03-12", count: 3 }, // 0.75 -> level 3
      { date: "2026-03-13", count: 4 }, // 1.00 -> level 4
    ];
    const result = buildHeatmapData(activity, 4, today);
    expect(result[0]!.level).toBe(1);
    expect(result[1]!.level).toBe(2);
    expect(result[2]!.level).toBe(3);
    expect(result[3]!.level).toBe(4);
  });

  it("dates are sorted ascending (oldest first)", () => {
    const result = buildHeatmapData([], 5, today);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.date > result[i - 1]!.date).toBe(true);
    }
  });
});
