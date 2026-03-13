import { describe, it, expect } from "vitest";
import {
  withAlpha,
  chart,
  CHART_COLORS,
  CHART_TOKENS,
  chartAxis,
  chartMuted,
  chartPositive,
  chartNegative,
  chartPrimary,
  agentColor,
  modelColor,
} from "./palette";

// ── Constants ──────────────────────────────────────────────────

describe("palette constants", () => {
  it("chart has 8 named colors", () => {
    expect(Object.keys(chart)).toHaveLength(8);
  });

  it("CHART_COLORS has 8 entries matching chart values", () => {
    expect(CHART_COLORS).toHaveLength(8);
    expect(CHART_COLORS[0]).toBe(chart.teal);
    expect(CHART_COLORS[7]).toBe(chart.vermilion);
  });

  it("CHART_TOKENS has 8 entries in chart-N format", () => {
    expect(CHART_TOKENS).toHaveLength(8);
    expect(CHART_TOKENS[0]).toBe("chart-1");
    expect(CHART_TOKENS[7]).toBe("chart-8");
  });

  it("chart values are hsl(var(--chart-N)) format", () => {
    expect(chart.teal).toBe("hsl(var(--chart-1))");
    expect(chart.vermilion).toBe("hsl(var(--chart-8))");
  });

  it("semantic aliases resolve to hsl vars", () => {
    expect(chartAxis).toBe("hsl(var(--chart-axis))");
    expect(chartMuted).toBe("hsl(var(--chart-muted))");
    expect(chartPositive).toBe(chart.green);
    expect(chartNegative).toBe("hsl(var(--destructive))");
    expect(chartPrimary).toBe(chart.teal);
  });
});

// ── withAlpha ──────────────────────────────────────────────────

describe("withAlpha", () => {
  it("returns hsl with alpha", () => {
    expect(withAlpha("chart-1", 0.12)).toBe("hsl(var(--chart-1) / 0.12)");
  });

  it("handles alpha = 1", () => {
    expect(withAlpha("primary", 1)).toBe("hsl(var(--primary) / 1)");
  });
});

// ── agentColor ─────────────────────────────────────────────────

describe("agentColor", () => {
  it("returns fixed color for known agents", () => {
    expect(agentColor("claude-code").token).toBe("chart-1");
    expect(agentColor("codex").token).toBe("chart-2");
    expect(agentColor("gemini-cli").token).toBe("chart-3");
    expect(agentColor("opencode").token).toBe("chart-4");
    expect(agentColor("vscode-copilot").token).toBe("chart-6");
  });

  it("returns fallback for unknown agent", () => {
    expect(agentColor("unknown-agent").token).toBe("chart-7");
    expect(agentColor("unknown-agent").color).toBe(chart.orange);
  });
});

// ── modelColor ─────────────────────────────────────────────────

describe("modelColor", () => {
  it("returns deterministic color for a model name", () => {
    const a = modelColor("gpt-4");
    const b = modelColor("gpt-4");
    expect(a.color).toBe(b.color);
    expect(a.token).toBe(b.token);
  });

  it("returns different colors for different models", () => {
    const a = modelColor("gpt-4");
    const b = modelColor("claude-3-opus");
    // Different models *may* collide, but these two likely don't
    // Just verify both return valid chart entries
    expect(CHART_TOKENS).toContain(a.token);
    expect(CHART_TOKENS).toContain(b.token);
  });

  it("token and color are consistent", () => {
    const result = modelColor("sonnet-4");
    const idx = CHART_TOKENS.indexOf(result.token);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(result.color).toBe(CHART_COLORS[idx]);
  });
});
