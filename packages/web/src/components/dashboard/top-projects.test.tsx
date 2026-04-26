import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TopProjects } from "./top-projects";

describe("TopProjects", () => {
  it("renders empty state when no projects", () => {
    render(<TopProjects projects={[]} />);
    expect(screen.getByText("No projects found")).toBeTruthy();
  });

  it("renders one row per project with name + count", () => {
    render(
      <MemoryRouter>
        <TopProjects
          projects={[
            { project_key: "k1", project_name: "Alpha", count: 10 },
            { project_key: "k2", project_name: "Beta", count: 4 },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("links each project to sessions page with encoded projectKey", () => {
    render(
      <MemoryRouter>
        <TopProjects
          projects={[
            { project_key: "key with spaces", project_name: "X", count: 1 },
          ]}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/dashboard/sessions?projectKey=key%20with%20spaces",
    );
  });

  it("scales bar width relative to maxCount", () => {
    const { container } = render(
      <MemoryRouter>
        <TopProjects
          projects={[
            { project_key: "k1", project_name: "Big", count: 100 },
            { project_key: "k2", project_name: "Small", count: 25 },
          ]}
        />
      </MemoryRouter>,
    );
    const bars = container.querySelectorAll("div.h-full.rounded-full");
    expect(bars.length).toBe(2);
    expect((bars[0] as HTMLElement).style.width).toBe("100%");
    expect((bars[1] as HTMLElement).style.width).toBe("25%");
  });
});
