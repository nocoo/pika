import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPage } from "./page";

const originalFetch = globalThis.fetch;

function LocationProbe() {
  const loc = useLocation();
  return (
    <div data-testid="location">
      {loc.pathname}
      {loc.search}
    </div>
  );
}

function wrap(initialPath = "/dashboard/search") {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/dashboard/search"
            element={
              <>
                <SearchPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/dashboard/sessions/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) =>
    handler(String(url)),
  ) as typeof fetch;
}

const sampleResult = {
  session_id: "abc",
  message_id: "m1",
  ordinal: 2,
  chunk_index: 0,
  content_snippet: "<mark>hi</mark>",
  tool_snippet: null,
  session_key: "k",
  source: "claude-code",
  project_name: null,
  title: "T",
  started_at: "2026-01-01T00:00:00Z",
};

const WAIT = { timeout: 2000 };

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("SearchPage", () => {
  it("renders header and initial empty state", () => {
    mockFetch(async () => jsonRes({ models: [], projects: [] }));
    render(wrap());
    expect(screen.getByTestId("search-page")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByTestId("search-initial")).toBeTruthy();
  });

  it("hydrates state from URL params", () => {
    mockFetch(async () => jsonRes({ models: [], projects: [] }));
    render(wrap("/dashboard/search?q=hello&source=codex&includeDeleted=true"));
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    expect(input.value).toBe("hello");
  });

  it("debounced search shows results and updates URL", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [sampleResult], total: 1 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "hi" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-results")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getByTestId("search-status").textContent).toContain(
      "1 result",
    );
    expect(screen.getByTestId("location").textContent).toContain("q=hi");
  });

  it("renders 0 results message", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [], total: 0 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "z" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-empty")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getByTestId("search-status").textContent).toContain(
      "No results",
    );
  });

  it("renders error on HTTP failure", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return new Response("nope", { status: 500 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "z" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-error")).toBeTruthy(),
      WAIT,
    );
  });

  it("clicking a result navigates to session detail with hash", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [sampleResult], total: 1 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "hi" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-result")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("search-result"));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain(
        "/dashboard/sessions/abc",
      );
    }, WAIT);
  });

  it("URL clears when query is cleared", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [sampleResult], total: 1 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap("/dashboard/search?q=foo"));
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(
      () => expect(screen.queryByTestId("search-initial")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getByTestId("location").textContent).not.toContain("q=");
  });
});
