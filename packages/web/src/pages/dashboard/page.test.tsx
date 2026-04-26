import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionListResponse } from "@/lib/sessions-types";
import type { StatsResponse } from "@/lib/stats-types";
import { DashboardPage } from "./page";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>{children}</MemoryRouter>
    </SWRConfig>
  );
}

const baseStats: StatsResponse = {
  overview: {
    totalSessions: 42,
    totalMessages: 1500,
    totalInputTokens: 100000,
    totalOutputTokens: 50000,
    sessionsThisWeek: 7,
  },
  sourceDistribution: [{ source: "claude-code", count: 30 }],
  dailyActivity: [{ date: "2026-04-01", count: 3 }],
  topProjects: [{ project_key: "k1", project_name: "Alpha", count: 10 }],
};

const baseSessions: SessionListResponse = { sessions: [] };

function setupHandlers(stats: unknown, sessions: unknown) {
  fetchMock.mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/stats"))
      return stats instanceof Response ? stats : jsonRes(stats);
    if (url.includes("/api/sessions"))
      return sessions instanceof Response ? sessions : jsonRes(sessions);
    throw new Error(`unexpected: ${url}`);
  });
}

describe("DashboardPage", () => {
  it("shows skeleton header while loading", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(
      screen.getByText("Overview of your coding agent sessions."),
    ).toBeTruthy();
  });

  it("renders error state when stats fetch fails", async () => {
    setupHandlers(jsonRes({ error: "boom" }, 500), baseSessions);
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("boom")).toBeTruthy();
    });
  });

  it("renders empty state when totalSessions=0", async () => {
    setupHandlers(
      { ...baseStats, overview: { ...baseStats.overview, totalSessions: 0 } },
      baseSessions,
    );
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("No sessions yet")).toBeTruthy();
    });
  });

  it("renders the full dashboard with overview + breakdown sections", async () => {
    setupHandlers(baseStats, baseSessions);
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Total Sessions")).toBeTruthy();
    });
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Breakdown")).toBeTruthy();
    expect(screen.getByText("Recent Sessions")).toBeTruthy();
    expect(screen.getByText("Top Projects")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("falls back to generic error message when error has no message", async () => {
    fetchMock.mockImplementation(async () => {
      throw "weird";
    });
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Failed to load data")).toBeTruthy();
    });
  });
});
