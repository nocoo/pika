import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectRankingChart } from "./project-ranking-chart";

const make = (key: string, sessions: number) => ({
  project_key: key,
  project_name: `/Users/me/personal/${key}`,
  session_count: sessions,
  total_messages: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  last_activity: "2026-01-01T00:00:00Z",
});

describe("ProjectRankingChart", () => {
  it("returns null when no projects", () => {
    const { container } = render(<ProjectRankingChart projects={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders chart card for projects", () => {
    render(<ProjectRankingChart projects={[make("a", 10), make("b", 5)]} />);
    expect(screen.getByTestId("project-ranking-chart")).toBeTruthy();
    expect(screen.getByText("Top Projects by Sessions")).toBeTruthy();
  });

  it("limits to top 10 projects", () => {
    const many = Array.from({ length: 15 }, (_, i) => make(`p${i}`, 100 - i));
    render(<ProjectRankingChart projects={many} />);
    expect(screen.getByTestId("project-ranking-chart")).toBeTruthy();
  });

  it("applies custom className", () => {
    const { container } = render(
      <ProjectRankingChart projects={[make("a", 1)]} className="custom-cls" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "custom-cls",
    );
  });
});
