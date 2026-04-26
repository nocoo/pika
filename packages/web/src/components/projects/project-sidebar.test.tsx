import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./project-sidebar";

const personal = {
  project_key: "p1",
  project_name: "/Users/me/workspace/personal/proj1",
  session_count: 5,
  total_messages: 10,
  total_input_tokens: 0,
  total_output_tokens: 0,
  last_activity: "2026-01-01T00:00:00Z",
};

const work = {
  project_key: "w1",
  project_name: "/Users/me/workspace/work/proj2",
  session_count: 8,
  total_messages: 20,
  total_input_tokens: 0,
  total_output_tokens: 0,
  last_activity: "2026-01-02T00:00:00Z",
};

const other = {
  project_key: "o1",
  project_name: "/random/path",
  session_count: 1,
  total_messages: 2,
  total_input_tokens: 0,
  total_output_tokens: 0,
  last_activity: "2026-01-03T00:00:00Z",
};

describe("ProjectSidebar", () => {
  it("shows empty state when no projects", () => {
    render(
      <ProjectSidebar
        projects={[]}
        sourceDistribution={{}}
        selectedKey={null}
        onProjectClick={() => {}}
      />,
    );
    expect(screen.getByTestId("project-sidebar-empty")).toBeTruthy();
  });

  it("groups projects by scope", () => {
    render(
      <ProjectSidebar
        projects={[personal, work, other]}
        sourceDistribution={{}}
        selectedKey={null}
        onProjectClick={() => {}}
      />,
    );
    expect(screen.getAllByText("Personal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Work").length).toBeGreaterThan(0);
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("hides empty groups", () => {
    render(
      <ProjectSidebar
        projects={[personal]}
        sourceDistribution={{}}
        selectedKey={null}
        onProjectClick={() => {}}
      />,
    );
    expect(screen.getAllByText("Personal").length).toBeGreaterThan(0);
    expect(screen.queryByText("Work")).toBeNull();
    expect(screen.queryByText("Other")).toBeNull();
  });

  it("forwards click with project key", () => {
    const onProjectClick = vi.fn();
    render(
      <ProjectSidebar
        projects={[personal]}
        sourceDistribution={{ p1: [{ source: "claude-code", count: 1 }] }}
        selectedKey={null}
        onProjectClick={onProjectClick}
      />,
    );
    fireEvent.click(screen.getByTestId("project-card-p1"));
    expect(onProjectClick).toHaveBeenCalledWith("p1");
  });

  it("propagates selectedKey", () => {
    render(
      <ProjectSidebar
        projects={[personal]}
        sourceDistribution={{}}
        selectedKey="p1"
        onProjectClick={() => {}}
      />,
    );
    expect(
      screen.getByTestId("project-card-p1").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
