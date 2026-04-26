import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchDialog } from "./search-dialog";

const originalFetch = globalThis.fetch;

function wrap(node: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>{node}</MemoryRouter>
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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const sampleResult = {
  session_id: "s1",
  message_id: "m1",
  ordinal: 0,
  chunk_index: 0,
  content_snippet: "<mark>foo</mark>",
  tool_snippet: null,
  session_key: "k",
  source: "claude-code",
  project_name: null,
  title: "T1",
  started_at: "2026-01-01T00:00:00Z",
};

const WAIT = { timeout: 2000 };

describe("SearchDialog", () => {
  it("renders nothing when closed", () => {
    render(wrap(<SearchDialog open={false} onOpenChange={() => {}} />));
    expect(screen.queryByTestId("search-dialog-content")).toBeNull();
  });

  it("renders initial empty state when open with no query", () => {
    mockFetch(async () => jsonRes({ models: [], projects: [] }));
    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    expect(screen.getByTestId("search-initial")).toBeTruthy();
  });

  it("performs search after debounce and shows results", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [sampleResult], total: 1 });
      }
      return jsonRes({ models: [], projects: [] });
    });

    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "foo" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-results")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getAllByTestId("search-result").length).toBe(1);
  });

  it("shows empty state when search returns 0 results", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [], total: 0 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "nope" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-empty")).toBeTruthy(),
      WAIT,
    );
  });

  it("shows error state when fetch fails", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return new Response("boom", { status: 500 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "x" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-error")).toBeTruthy(),
      WAIT,
    );
  });

  it("clicking a result calls onOpenChange(false)", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [sampleResult], total: 1 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    const onOpenChange = vi.fn();
    render(wrap(<SearchDialog open={true} onOpenChange={onOpenChange} />));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "foo" },
    });
    await waitFor(
      () => expect(screen.queryByTestId("search-result")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("search-result"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ArrowDown moves selection then Enter triggers click", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({
          results: [sampleResult, { ...sampleResult, ordinal: 1 }],
          total: 2,
        });
      }
      return jsonRes({ models: [], projects: [] });
    });
    const onOpenChange = vi.fn();
    render(wrap(<SearchDialog open={true} onOpenChange={onOpenChange} />));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "foo" },
    });
    await waitFor(
      () => expect(screen.getAllByTestId("search-result").length).toBe(2),
      WAIT,
    );
    const container = screen.getByTestId("search-dialog-content");
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "ArrowUp" });
    fireEvent.keyDown(container, { key: "Enter" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keyboard handlers no-op when no results", () => {
    mockFetch(async () => jsonRes({ models: [], projects: [] }));
    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    const container = screen.getByTestId("search-dialog-content");
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "Enter" });
    expect(screen.getByTestId("search-initial")).toBeTruthy();
  });

  it("ArrowUp from -1 selects last result", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({
          results: [sampleResult, { ...sampleResult, ordinal: 1 }],
          total: 2,
        });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "f" },
    });
    await waitFor(
      () => expect(screen.getAllByTestId("search-result").length).toBe(2),
      WAIT,
    );
    fireEvent.keyDown(screen.getByTestId("search-dialog-content"), {
      key: "ArrowUp",
    });
    const cards = screen.getAllByTestId("search-result");
    expect(cards.some((c) => c.className.includes("ring-2"))).toBe(true);
  });

  it("clearing query resets results", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("/api/search?")) {
        return jsonRes({ results: [sampleResult], total: 1 });
      }
      return jsonRes({ models: [], projects: [] });
    });
    render(wrap(<SearchDialog open={true} onOpenChange={() => {}} />));
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "foo" } });
    await waitFor(
      () => expect(screen.queryByTestId("search-results")).toBeTruthy(),
      WAIT,
    );
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(
      () => expect(screen.queryByTestId("search-initial")).toBeTruthy(),
      WAIT,
    );
  });
});
