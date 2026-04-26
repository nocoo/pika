import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardSegment } from "./dashboard-segment";

describe("DashboardSegment", () => {
  it("renders title and children", () => {
    render(
      <DashboardSegment title="Overview">
        <span data-testid="child">content</span>
      </DashboardSegment>,
    );
    expect(screen.getByText("Overview").textContent).toBe("Overview");
    expect(screen.getByTestId("child").textContent).toBe("content");
  });

  it("renders action slot when provided", () => {
    render(
      <DashboardSegment
        title="Overview"
        action={<button type="button">Act</button>}
      >
        c
      </DashboardSegment>,
    );
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy();
  });

  it("omits action wrapper when not provided", () => {
    const { container } = render(
      <DashboardSegment title="Overview">c</DashboardSegment>,
    );
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("applies custom className", () => {
    const { container } = render(
      <DashboardSegment title="T" className="my-segment">
        x
      </DashboardSegment>,
    );
    expect(
      (container.firstChild as HTMLElement).classList.contains("my-segment"),
    ).toBe(true);
  });
});
