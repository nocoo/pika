import type { Source } from "@pika/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionListResponse } from "@/lib/sessions-types";
import { messageRangeToParams, SessionsPage } from "./page";

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

function Wrapper({
  children,
  initial = "/dashboard/sessions",
}: {
  children: ReactNode;
  initial?: string;
}) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </SWRConfig>
  );
}

function row(id: string, title: string, isStarred = 0) {
  return {
    id,
    session_key: `k-${id}`,
    source: "claude-code" as Source,
    started_at: "2024-01-01T00:00:00Z",
    last_message_at: "2024-01-01T01:00:00Z",
    duration_seconds: 90,
    user_messages: 1,
    assistant_messages: 2,
    total_messages: 3,
    total_input_tokens: 1500,
    total_output_tokens: 500,
    total_cached_tokens: 0,
    project_ref: null,
    project_name: null,
    model: "sonnet-4.6",
    title,
    is_starred: isStarred,
    deleted_at: null,
  };
}

function setupHandlers(
  sessions: SessionListResponse,
  filters: { models: string[]; projects: unknown[] } = {
    models: [],
    projects: [],
  },
) {
  fetchMock.mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sessions/filters")) return jsonRes(filters);
    if (url.includes("/api/sessions/batch")) return jsonRes({ ok: true });
    if (url.includes("/star")) return jsonRes({ ok: true });
    if (url.includes("/api/sessions")) return jsonRes(sessions);
    throw new Error(`unexpected: ${url}`);
  });
}

describe("messageRangeToParams", () => {
  it.each([
    ["0-10", { minMessages: "0", maxMessages: "10" }],
    ["11-50", { minMessages: "11", maxMessages: "50" }],
    ["51-200", { minMessages: "51", maxMessages: "200" }],
    ["201+", { minMessages: "201" }],
    ["", {}],
  ] as const)("%s → %j", (range, expected) => {
    expect(messageRangeToParams(range)).toEqual(expected);
  });
});

describe("SessionsPage", () => {
  it("renders header and empty state", async () => {
    setupHandlers({ sessions: [], totalCount: 0 });
    render(
      <Wrapper>
        <SessionsPage />
      </Wrapper>,
    );
    expect(screen.getByText("Sessions")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByText("No sessions found. Try adjusting your filters."),
      ).toBeTruthy();
    });
  });

  it("renders session rows from API", async () => {
    setupHandlers({
      sessions: [row("s1", "Alpha"), row("s2", "Beta")],
      totalCount: 2,
    });
    render(
      <Wrapper>
        <SessionsPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeTruthy();
    });
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("requests with URL params from initial location", async () => {
    setupHandlers({ sessions: [], totalCount: 0 });
    render(
      <Wrapper initial="/dashboard/sessions?source=codex&starred=true&page=2">
        <SessionsPage />
      </Wrapper>,
    );
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      const sessionCall = calls.find(
        (u) => u.includes("/api/sessions?") && !u.includes("/filters"),
      );
      expect(sessionCall).toBeTruthy();
      expect(sessionCall).toContain("source=codex");
      expect(sessionCall).toContain("starred=true");
      expect(sessionCall).toContain("page=2");
    });
  });

  it("shows error message when API rejects", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/sessions/filters"))
        return jsonRes({ models: [], projects: [] });
      return new Response("nope", { status: 500 });
    });
    render(
      <Wrapper>
        <SessionsPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("error")).toBeTruthy();
    });
  });

  it("changing source filter triggers refetch with new param", async () => {
    setupHandlers({ sessions: [], totalCount: 0 });
    render(
      <Wrapper>
        <SessionsPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("filter-source")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("filter-source"), {
      target: { value: "codex" },
    });
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("source=codex"))).toBe(true);
    });
  });

  it("renders pagination Page 1 of N text", async () => {
    setupHandlers({ sessions: [], totalCount: 250 });
    render(
      <Wrapper>
        <SessionsPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 5")).toBeTruthy();
    });
  });
});
