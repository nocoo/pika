import { render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StatCard, StatGrid } from "./stat-card";

describe("StatCard", () => {
  it("renders title, formatted numeric value, and subtitle", () => {
    render(<StatCard title="Sessions" value={1234} subtitle="last 7 days" />);
    expect(screen.getByText("Sessions").textContent).toBe("Sessions");
    expect(screen.getByTestId("stat-value").textContent).toBe("1,234");
    expect(screen.getByText("last 7 days").textContent).toBe("last 7 days");
  });

  it("passes string values through unchanged", () => {
    render(<StatCard title="X" value="3.2K" />);
    expect(screen.getByTestId("stat-value").textContent).toBe("3.2K");
  });

  it("renders the icon when provided", () => {
    const { container } = render(
      <StatCard title="X" value={1} icon={Activity} />,
    );
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("uses primary variant spacing + gradient accent when variant=primary", () => {
    const { container } = render(
      <StatCard title="X" value={1} variant="primary" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain("p-5");
    expect(container.querySelector("div.h-0\\.5")).not.toBeNull();
  });

  it("renders custom accentColor stripe", () => {
    const { container } = render(
      <StatCard title="X" value={1} accentColor="bg-chart-3" />,
    );
    expect(container.querySelector(".bg-chart-3")).not.toBeNull();
  });

  it("renders single trend with + prefix and success color when positive", () => {
    render(
      <StatCard title="X" value={1} trend={{ value: 12, label: "wow" }} />,
    );
    const span = screen.getByText("+12%");
    expect(span.className).toContain("text-success");
    expect(screen.getByText("wow")).toBeTruthy();
  });

  it("renders negative trend without + and with destructive color", () => {
    render(<StatCard title="X" value={1} trend={{ value: -3 }} />);
    const span = screen.getByText("-3%");
    expect(span.className).toContain("text-destructive");
  });

  it("renders zero trend in muted color", () => {
    render(<StatCard title="X" value={1} trend={{ value: 0 }} />);
    expect(screen.getByText("0%").className).toContain("text-muted-foreground");
  });

  it("prefers trends array over single trend", () => {
    render(
      <StatCard
        title="X"
        value={1}
        trend={{ value: 5 }}
        trends={[{ value: 7 }, { value: -2 }]}
      />,
    );
    expect(screen.queryByText("+5%")).toBeNull();
    expect(screen.getByText("+7%")).toBeTruthy();
    expect(screen.getByText("-2%")).toBeTruthy();
  });
});

describe("StatGrid", () => {
  it("defaults to 4 columns", () => {
    const { container } = render(
      <StatGrid>
        <div />
      </StatGrid>,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "lg:grid-cols-4",
    );
  });

  it.each([2, 3, 4] as const)("supports columns=%i", (cols) => {
    const { container } = render(
      <StatGrid columns={cols}>
        <div />
      </StatGrid>,
    );
    const expectedCls =
      cols === 2
        ? "sm:grid-cols-2"
        : cols === 3
          ? "lg:grid-cols-3"
          : "lg:grid-cols-4";
    expect((container.firstChild as HTMLElement).className).toContain(
      expectedCls,
    );
  });
});
