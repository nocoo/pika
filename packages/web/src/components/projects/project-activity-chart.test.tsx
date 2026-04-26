import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectActivityChart } from "./project-activity-chart";

const ACTIVITY = [
  { date: "2026-01-01", sessions: 5, messages: 10, tokens: 1000, duration: 60 },
  {
    date: "2026-01-02",
    sessions: 8,
    messages: 20,
    tokens: 2000,
    duration: 120,
  },
];

let originalFetch: typeof fetch;

function mockFetch(handler: (url: string) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ProjectActivityChart", () => {
  it("renders loading skeleton initially", () => {
    mockFetch(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const { container } = render(<ProjectActivityChart projectKey="k1" />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders error state when fetch fails", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-error")).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });

  it("renders empty state when activity is empty", async () => {
    mockFetch(() => new Response(JSON.stringify({ activity: [] })));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-empty")).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });

  it("renders chart when data arrives", async () => {
    mockFetch(() => new Response(JSON.stringify({ activity: ACTIVITY })));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-chart")).toBeTruthy();
      },
      { timeout: 2000 },
    );
    expect(screen.getByTestId("activity-metric-sessions")).toBeTruthy();
  });

  it("toggles secondary metric off when clicked", async () => {
    mockFetch(() => new Response(JSON.stringify({ activity: ACTIVITY })));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-chart")).toBeTruthy();
      },
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByTestId("activity-metric-messages"));
    expect(
      screen
        .getByTestId("activity-metric-messages")
        .getAttribute("data-secondary"),
    ).toBe("false");
  });

  it("swaps primary↔secondary when primary is clicked", async () => {
    mockFetch(() => new Response(JSON.stringify({ activity: ACTIVITY })));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-chart")).toBeTruthy();
      },
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByTestId("activity-metric-sessions"));
    expect(
      screen
        .getByTestId("activity-metric-messages")
        .getAttribute("data-selected"),
    ).toBe("true");
  });

  it("sets new secondary when none was set", async () => {
    mockFetch(() => new Response(JSON.stringify({ activity: ACTIVITY })));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-chart")).toBeTruthy();
      },
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByTestId("activity-metric-messages"));
    fireEvent.click(screen.getByTestId("activity-metric-tokens"));
    expect(
      screen
        .getByTestId("activity-metric-tokens")
        .getAttribute("data-secondary"),
    ).toBe("true");
  });

  it("shifts secondary→primary when a third metric is clicked", async () => {
    mockFetch(() => new Response(JSON.stringify({ activity: ACTIVITY })));
    render(<ProjectActivityChart projectKey="k1" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("activity-chart")).toBeTruthy();
      },
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByTestId("activity-metric-tokens"));
    expect(
      screen
        .getByTestId("activity-metric-messages")
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("activity-metric-tokens")
        .getAttribute("data-secondary"),
    ).toBe("true");
  });
});
