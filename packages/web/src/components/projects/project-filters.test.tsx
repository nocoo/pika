import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectFilters } from "./project-filters";

describe("ProjectFilters", () => {
  it("renders both selects", () => {
    render(
      <ProjectFilters
        minSessions={10}
        scope=""
        onMinSessionsChange={() => {}}
        onScopeChange={() => {}}
      />,
    );
    expect(screen.getByTestId("project-filters")).toBeTruthy();
    expect(screen.getByTestId("filter-min-sessions")).toBeTruthy();
    expect(screen.getByTestId("filter-scope")).toBeTruthy();
  });

  it("calls onMinSessionsChange with numeric value", () => {
    const onChange = vi.fn();
    render(
      <ProjectFilters
        minSessions={10}
        scope=""
        onMinSessionsChange={onChange}
        onScopeChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("filter-min-sessions"), {
      target: { value: "20" },
    });
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it("calls onScopeChange with scope string", () => {
    const onChange = vi.fn();
    render(
      <ProjectFilters
        minSessions={10}
        scope=""
        onMinSessionsChange={() => {}}
        onScopeChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("filter-scope"), {
      target: { value: "work" },
    });
    expect(onChange).toHaveBeenCalledWith("work");
  });

  it("reflects current minSessions value", () => {
    render(
      <ProjectFilters
        minSessions={50}
        scope=""
        onMinSessionsChange={() => {}}
        onScopeChange={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("filter-min-sessions") as HTMLSelectElement).value,
    ).toBe("50");
  });

  it("reflects current scope value", () => {
    render(
      <ProjectFilters
        minSessions={10}
        scope="personal"
        onMinSessionsChange={() => {}}
        onScopeChange={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("filter-scope") as HTMLSelectElement).value,
    ).toBe("personal");
  });
});
