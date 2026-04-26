import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PERIOD_OPTIONS,
  type Period,
  PeriodSelector,
  periodLabel,
} from "./period-selector";

describe("periodLabel", () => {
  it("maps every period to its label", () => {
    const expected: Record<Period, string> = {
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      "90d": "Last 90 days",
      "365d": "Last 365 days",
      month: "This month",
      all: "All time",
    };
    for (const opt of PERIOD_OPTIONS) {
      expect(periodLabel(opt.value)).toBe(expected[opt.value]);
    }
  });
});

describe("PeriodSelector", () => {
  it("renders all six options", () => {
    render(<PeriodSelector value="7d" onChange={() => {}} />);
    expect(screen.getAllByRole("button").length).toBe(PERIOD_OPTIONS.length);
  });

  it("highlights the selected option", () => {
    render(<PeriodSelector value="30d" onChange={() => {}} />);
    const selected = screen.getByRole("button", { name: "30d" });
    const unselected = screen.getByRole("button", { name: "7d" });
    expect(selected.className).toContain("text-foreground");
    expect(unselected.className).toContain("text-muted-foreground");
  });

  it("calls onChange with the clicked option's value", () => {
    const onChange = vi.fn();
    render(<PeriodSelector value="7d" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
