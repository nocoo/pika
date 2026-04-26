import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityHeatmap } from "./activity-heatmap";

describe("ActivityHeatmap", () => {
  it("renders the Less/More legend labels", () => {
    render(<ActivityHeatmap data={[]} />);
    expect(screen.getByText("Less")).toBeTruthy();
    expect(screen.getByText("More")).toBeTruthy();
  });

  it("renders an outer img role with aria-label", () => {
    render(<ActivityHeatmap data={[]} />);
    const grids = screen.getAllByRole("img", { name: "Activity heatmap" });
    expect(grids.length).toBe(1);
  });

  it("respects custom className on the scroll wrapper", () => {
    const { container } = render(
      <ActivityHeatmap data={[]} className="my-heatmap" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "my-heatmap",
    );
  });

  it("computes aria-labels from supplied data points", () => {
    const today = new Date().toISOString().slice(0, 10);
    render(<ActivityHeatmap data={[{ date: today, count: 3 }]} />);
    expect(
      screen.getByRole("img", { name: `3 sessions on ${today}` }),
    ).toBeTruthy();
  });

  it("uses singular 'session' for count = 1", () => {
    const today = new Date().toISOString().slice(0, 10);
    render(<ActivityHeatmap data={[{ date: today, count: 1 }]} />);
    expect(
      screen.getByRole("img", { name: `1 session on ${today}` }),
    ).toBeTruthy();
  });
});
