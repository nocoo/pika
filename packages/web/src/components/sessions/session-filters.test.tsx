import type { Source } from "@pika/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionFilters } from "./session-filters";

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
      {children}
    </SWRConfig>
  );
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    source: "" as Source | "",
    sort: "last_message_at" as const,
    model: "",
    starred: false,
    includeDeleted: false,
    messageRange: "" as "",
    onSourceChange: vi.fn(),
    onSortChange: vi.fn(),
    onModelChange: vi.fn(),
    onStarredChange: vi.fn(),
    onIncludeDeletedChange: vi.fn(),
    onMessageRangeChange: vi.fn(),
    ...overrides,
  };
}

describe("SessionFilters", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonRes({ models: [], projects: [] }));
  });

  it("renders source/messageRange/sort selects + 2 checkboxes by default", () => {
    render(
      <Wrapper>
        <SessionFilters {...defaultProps()} />
      </Wrapper>,
    );
    expect(screen.getByTestId("filter-source")).toBeTruthy();
    expect(screen.getByTestId("filter-message-range")).toBeTruthy();
    expect(screen.getByTestId("filter-sort")).toBeTruthy();
    expect(screen.getByTestId("filter-starred")).toBeTruthy();
    expect(screen.getByTestId("filter-include-deleted")).toBeTruthy();
  });

  it("hides sort when hideSort=true", () => {
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ hideSort: true })} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("filter-sort")).toBeNull();
  });

  it("renders model select once filter options arrive", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ models: ["sonnet-4.6", "opus-4.7"], projects: [] }),
    );
    render(
      <Wrapper>
        <SessionFilters {...defaultProps()} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("filter-model")).toBeTruthy();
    });
    expect(screen.getByText("sonnet-4.6")).toBeTruthy();
  });

  it("calls onSourceChange when source select changes", () => {
    const onSourceChange = vi.fn();
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ onSourceChange })} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId("filter-source"), {
      target: { value: "codex" },
    });
    expect(onSourceChange).toHaveBeenCalledWith("codex");
  });

  it("calls onSortChange when sort select changes", () => {
    const onSortChange = vi.fn();
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ onSortChange })} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId("filter-sort"), {
      target: { value: "started_at" },
    });
    expect(onSortChange).toHaveBeenCalledWith("started_at");
  });

  it("calls onMessageRangeChange when range changes", () => {
    const onMessageRangeChange = vi.fn();
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ onMessageRangeChange })} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId("filter-message-range"), {
      target: { value: "11-50" },
    });
    expect(onMessageRangeChange).toHaveBeenCalledWith("11-50");
  });

  it("calls onStarredChange when starred toggled", () => {
    const onStarredChange = vi.fn();
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ onStarredChange })} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("filter-starred"));
    expect(onStarredChange).toHaveBeenCalledWith(true);
  });

  it("calls onIncludeDeletedChange when include-deleted toggled", () => {
    const onIncludeDeletedChange = vi.fn();
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ onIncludeDeletedChange })} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("filter-include-deleted"));
    expect(onIncludeDeletedChange).toHaveBeenCalledWith(true);
  });

  it("calls onModelChange when model select changes", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ models: ["m-a", "m-b"], projects: [] }),
    );
    const onModelChange = vi.fn();
    render(
      <Wrapper>
        <SessionFilters {...defaultProps({ onModelChange })} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("filter-model")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("filter-model"), {
      target: { value: "m-b" },
    });
    expect(onModelChange).toHaveBeenCalledWith("m-b");
  });
});
