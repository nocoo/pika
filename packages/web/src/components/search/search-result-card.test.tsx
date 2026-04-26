import type { Source } from "@pika/core";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SearchResultCard, type SearchResultData } from "./search-result-card";

function wrap(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

function makeResult(
  overrides: Partial<SearchResultData> = {},
): SearchResultData {
  return {
    session_id: "s1",
    message_id: "m1",
    ordinal: 0,
    chunk_index: 0,
    content_snippet: "hello <mark>world</mark>",
    tool_snippet: null,
    session_key: "k",
    source: "claude-code" as Source,
    project_name: null,
    title: "Title",
    started_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("SearchResultCard", () => {
  it("renders as Link when no onClick", () => {
    render(wrap(<SearchResultCard result={makeResult()} />));
    const link = screen.getByTestId("search-result");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/dashboard/sessions/s1#msg-0");
  });

  it("renders as button when onClick provided", () => {
    const onClick = vi.fn();
    render(wrap(<SearchResultCard result={makeResult()} onClick={onClick} />));
    const btn = screen.getByTestId("search-result");
    expect(btn.tagName).toBe("BUTTON");
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("falls back to Untitled session when title null", () => {
    render(wrap(<SearchResultCard result={makeResult({ title: null })} />));
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });

  it("renders project name when provided", () => {
    render(
      wrap(
        <SearchResultCard
          result={makeResult({ project_name: "/path/to/proj" })}
        />,
      ),
    );
    expect(screen.getByText(/proj/)).toBeTruthy();
  });

  it("renders content snippet via dangerouslySetInnerHTML", () => {
    render(wrap(<SearchResultCard result={makeResult()} />));
    const snippet = screen.getByTestId("search-snippet");
    expect(snippet.innerHTML).toContain("<mark>world</mark>");
  });

  it("omits snippet div when content_snippet is empty", () => {
    render(
      wrap(<SearchResultCard result={makeResult({ content_snippet: "" })} />),
    );
    expect(screen.queryByTestId("search-snippet")).toBeNull();
  });

  it("renders tool snippet when provided", () => {
    render(
      wrap(
        <SearchResultCard
          result={makeResult({ tool_snippet: "<mark>cmd</mark>" })}
        />,
      ),
    );
    const tool = screen.getByTestId("search-tool-snippet");
    expect(tool.innerHTML).toContain("<mark>cmd</mark>");
    expect(screen.getByText("Tool context")).toBeTruthy();
  });

  it("displays Message # ordinal+1", () => {
    render(wrap(<SearchResultCard result={makeResult({ ordinal: 4 })} />));
    expect(screen.getByText("Message #5")).toBeTruthy();
  });

  it("applies selected ring styling when selected", () => {
    render(
      wrap(
        <SearchResultCard
          result={makeResult()}
          onClick={() => {}}
          selected
          id="result-1"
          data-result-index={1}
        />,
      ),
    );
    const btn = screen.getByTestId("search-result");
    expect(btn.className).toContain("ring-2");
    expect(btn.getAttribute("aria-selected")).toBe("true");
    expect(btn.getAttribute("id")).toBe("result-1");
    expect(btn.getAttribute("data-result-index")).toBe("1");
  });

  it("supports custom className", () => {
    render(
      wrap(<SearchResultCard result={makeResult()} className="custom-class" />),
    );
    expect(screen.getByTestId("search-result").className).toContain(
      "custom-class",
    );
  });
});
