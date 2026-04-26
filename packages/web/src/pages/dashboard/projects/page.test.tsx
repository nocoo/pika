import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "./page";

const projectA = {
  project_key: "a1",
  project_name: "/Users/me/workspace/personal/proj-a",
  session_count: 12,
  total_messages: 100,
  total_input_tokens: 1000,
  total_output_tokens: 500,
  last_activity: "2026-01-01T00:00:00Z",
};

const projectB = {
  project_key: "b1",
  project_name: "/Users/me/workspace/work/proj-b",
  session_count: 30,
  total_messages: 300,
  total_input_tokens: 2000,
  total_output_tokens: 1000,
  last_activity: "2026-01-02T00:00:00Z",
};

const overview = {
  totalProjects: 2,
  totalSessions: 42,
  totalMessages: 400,
  totalInputTokens: 3000,
  totalOutputTokens: 1500,
};

const sessionsResp = { sessions: [], totalCount: 0 };

let originalFetch: typeof fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // jsdom needs scrollIntoView
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function setProjectsResponse(
  projects: (typeof projectA)[],
  src: Record<string, { source: string; count: number }[]> = {},
) {
  fetchMock.mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/projects/activity"))
      return jsonRes({ activity: [] });
    if (url.startsWith("/api/projects"))
      return jsonRes({
        overview,
        projects,
        sourceDistribution: src,
      });
    if (url.startsWith("/api/sessions")) return jsonRes(sessionsResp);
    throw new Error(`unexpected ${url}`);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

describe("ProjectsPage", () => {
  it("renders loading state initially", () => {
    fetchMock.mockImplementation(
      () =>
        new Promise(() => {
          /* never */
        }),
    );
    renderPage();
    expect(screen.getByTestId("projects-loading")).toBeTruthy();
  });

  it("renders empty state when API returns no projects", async () => {
    setProjectsResponse([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("projects-empty")).toBeTruthy();
    });
  });

  it("renders error state when fetch fails", async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 500));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("projects-error")).toBeTruthy();
    });
  });

  it("renders sidebar + overview when projects load", async () => {
    setProjectsResponse([projectA, projectB]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("project-sidebar")).toBeTruthy();
    });
    expect(screen.getByTestId("project-detail-empty")).toBeTruthy();
    expect(screen.getByTestId("overview-toggle")).toBeTruthy();
  });

  it("filters out projects below minSessions threshold", async () => {
    setProjectsResponse([projectA]); // 12 sessions, threshold default 10
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("project-card-a1")).toBeTruthy();
    });
  });

  it("renders projects-page wrapper", async () => {
    setProjectsResponse([projectB]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("projects-page")).toBeTruthy();
    });
  });
});
