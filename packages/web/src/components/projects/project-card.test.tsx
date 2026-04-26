import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectCard } from "./project-card";

const baseProject = {
  project_key: "k1",
  project_name: "/Users/me/personal/proj",
  session_count: 12,
  total_messages: 100,
  total_input_tokens: 1000,
  total_output_tokens: 500,
  last_activity: "2026-01-01T00:00:00Z",
};

describe("ProjectCard", () => {
  it("renders project name + counts", () => {
    render(
      <ProjectCard
        project={baseProject}
        sources={[{ source: "claude-code", count: 5 }]}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId("project-card-k1")).toBeTruthy();
    expect(screen.getByText("12 sessions")).toBeTruthy();
    expect(screen.getByText("100 msgs")).toBeTruthy();
  });

  it("renders no donut when sources empty", () => {
    render(
      <ProjectCard
        project={baseProject}
        sources={[]}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByTestId("project-card-donut")).toBeNull();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(
      <ProjectCard
        project={baseProject}
        sources={[]}
        selected={false}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId("project-card-k1"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies selected styling", () => {
    render(
      <ProjectCard
        project={baseProject}
        sources={[]}
        selected
        onClick={() => {}}
      />,
    );
    const btn = screen.getByTestId("project-card-k1");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("ring-2");
  });

  it("renders without scope badge when project has no scope", () => {
    render(
      <ProjectCard
        project={{ ...baseProject, project_name: null }}
        sources={[]}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId("project-card-k1")).toBeTruthy();
  });
});
