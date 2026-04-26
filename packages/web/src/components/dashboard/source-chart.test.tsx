import type { Source } from "@pika/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceChart } from "./source-chart";

describe("SourceChart", () => {
  it("renders empty state when data is empty", () => {
    render(<SourceChart data={[]} />);
    expect(screen.getByText("No usage data yet")).toBeTruthy();
  });

  it("renders legend rows for each source", () => {
    render(
      <SourceChart
        data={[
          { source: "claude-code" as Source, count: 12 },
          { source: "codex" as Source, count: 4 },
        ]}
      />,
    );
    expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);
    expect(screen.getByText("By Agent")).toBeTruthy();
  });

  it("formats counts with formatTokens helper", () => {
    render(
      <SourceChart data={[{ source: "claude-code" as Source, count: 1500 }]} />,
    );
    expect(screen.getByText("1.5K")).toBeTruthy();
  });

  it("applies custom className to wrapper", () => {
    const { container } = render(
      <SourceChart
        data={[{ source: "claude-code" as Source, count: 1 }]}
        className="custom-cls"
      />,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "custom-cls",
    );
  });
});
