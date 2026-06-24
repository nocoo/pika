import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatToolContent, ToolCall } from "./tool-call";

describe("formatToolContent", () => {
  it("pretty-prints valid JSON", () => {
    expect(formatToolContent('{"a":1,"b":2}')).toBe(
      '{\n  "a": 1,\n  "b": 2\n}',
    );
  });

  it("returns input unchanged for invalid JSON", () => {
    expect(formatToolContent("not json")).toBe("not json");
  });

  it("handles arrays", () => {
    expect(formatToolContent("[1,2,3]")).toBe("[\n  1,\n  2,\n  3\n]");
  });
});

describe("ToolCall", () => {
  it("renders tool name with success styling when result present", () => {
    render(<ToolCall toolName="Read" toolResult='{"ok":true}' />);
    const card = screen.getByTestId("tool-call");
    expect(card.className).toContain("border-success/20");
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("renders neutral styling when no result", () => {
    render(<ToolCall toolName="Read" toolInput='{"path":"/tmp"}' />);
    const card = screen.getByTestId("tool-call");
    expect(card.className).toContain("bg-secondary");
    expect(card.className).not.toContain("border-success");
  });

  it("trigger is disabled when no input or result", () => {
    render(<ToolCall toolName="Bash" />);
    const trigger = screen.getByTestId("tool-call-trigger");
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  it("expanding shows input and output panels with fallback rendering", () => {
    render(
      <ToolCall
        toolName="Read"
        toolInput='{"file":"a.ts"}'
        toolResult='{"size":100}'
      />,
    );
    fireEvent.click(screen.getByTestId("tool-call-trigger"));
    expect(screen.getByTestId("tool-input")).toBeTruthy();
    expect(screen.getByTestId("tool-output")).toBeTruthy();
    const fallbacks = screen.getAllByTestId("tool-result-fallback");
    expect(fallbacks.length).toBeGreaterThanOrEqual(2);
    expect(fallbacks[0]?.textContent).toContain('"file": "a.ts"');
  });

  it("renders only input section when no result given", () => {
    render(<ToolCall toolName="Edit" toolInput='{"x":1}' />);
    fireEvent.click(screen.getByTestId("tool-call-trigger"));
    expect(screen.getByTestId("tool-input")).toBeTruthy();
    expect(screen.queryByTestId("tool-output")).toBeNull();
  });

  it("plain-text content also renders in fallback pre", () => {
    render(<ToolCall toolName="X" toolResult="raw text" />);
    fireEvent.click(screen.getByTestId("tool-call-trigger"));
    const fallback = screen.getByTestId("tool-result-fallback");
    expect(fallback.textContent).toBe("raw text");
  });
});
