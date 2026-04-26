import type { CanonicalMessage, Source } from "@pika/core";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageBubble,
  parseContentSegments,
  parseInlineCode,
} from "./message-bubble";

function makeMessage(
  overrides: Partial<CanonicalMessage> = {},
): CanonicalMessage {
  return {
    role: "user",
    content: "hello",
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  } as CanonicalMessage;
}

function wrap(node: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {node}
    </SWRConfig>
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ email: "a@b.io", userId: "u" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseContentSegments", () => {
  it("returns single text segment for plain content", () => {
    expect(parseContentSegments("hello")).toEqual([
      { type: "text", content: "hello" },
    ]);
  });

  it("splits text and code blocks with language", () => {
    const segs = parseContentSegments("foo\n```ts\nconst x = 1\n```\nbar");
    expect(segs).toEqual([
      { type: "text", content: "foo" },
      { type: "code", content: "const x = 1\n", lang: "ts" },
      { type: "text", content: "bar" },
    ]);
  });

  it("handles code block without language", () => {
    const segs = parseContentSegments("```\nplain\n```");
    expect(segs[0]?.type).toBe("code");
    expect(segs[0]?.lang).toBeUndefined();
  });

  it("returns empty array for blank string", () => {
    expect(parseContentSegments("")).toEqual([]);
  });
});

describe("parseInlineCode", () => {
  it("splits text on backtick code", () => {
    expect(parseInlineCode("use `npm` here")).toEqual([
      { text: "use ", isCode: false },
      { text: "npm", isCode: true },
      { text: " here", isCode: false },
    ]);
  });

  it("returns single non-code part when no backticks", () => {
    expect(parseInlineCode("plain")).toEqual([
      { text: "plain", isCode: false },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseInlineCode("")).toEqual([]);
  });
});

describe("MessageBubble", () => {
  it("renders user message with bubble + role avatar", () => {
    render(
      wrap(
        <MessageBubble
          message={makeMessage({ role: "user", content: "hi" })}
          index={0}
          source={"claude-code" as Source}
        />,
      ),
    );
    expect(screen.getByTestId("message-role")).toBeTruthy();
    expect(screen.getByTestId("message-bubble").textContent).toContain("hi");
  });

  it("renders timestamp separator when showTimestamp=true", () => {
    render(
      wrap(
        <MessageBubble
          message={makeMessage({
            role: "assistant",
            content: "yo",
            timestamp: "2024-01-01T12:30:00Z",
          })}
          index={1}
          source={"claude-code" as Source}
          showTimestamp
        />,
      ),
    );
    expect(screen.getByTestId("message-timestamp")).toBeTruthy();
  });

  it("renders tool messages without bubble (indented)", () => {
    render(
      wrap(
        <MessageBubble
          message={
            {
              role: "tool",
              toolName: "Read",
              toolInput: '{"f":"x"}',
              toolResult: '{"ok":true}',
            } as CanonicalMessage
          }
          index={2}
          source={"claude-code" as Source}
        />,
      ),
    );
    expect(screen.getByTestId("tool-call")).toBeTruthy();
    expect(screen.queryByTestId("message-bubble")).toBeNull();
  });

  it("renders inline tool call when assistant message has toolName", () => {
    render(
      wrap(
        <MessageBubble
          message={
            {
              role: "assistant",
              content: "ok",
              toolName: "Bash",
              toolInput: '{"cmd":"ls"}',
            } as CanonicalMessage
          }
          index={3}
          source={"claude-code" as Source}
        />,
      ),
    );
    expect(screen.getByTestId("message-bubble")).toBeTruthy();
    expect(screen.getByTestId("tool-call")).toBeTruthy();
  });

  it("renders token info when totalTokens > 0", () => {
    render(
      wrap(
        <MessageBubble
          message={makeMessage({
            role: "assistant",
            content: "hi",
            inputTokens: 100,
            outputTokens: 50,
            cachedTokens: 20,
            model: "sonnet",
          })}
          index={4}
          source={"claude-code" as Source}
        />,
      ),
    );
    expect(screen.getByTestId("message-tokens").textContent).toContain("in");
  });

  it("renders system message with italic styling", () => {
    render(
      wrap(
        <MessageBubble
          message={makeMessage({ role: "system", content: "sys" })}
          index={5}
          source={"claude-code" as Source}
        />,
      ),
    );
    expect(screen.getByTestId("message-bubble").className).toContain("italic");
  });

  it("does not render timestamp when showTimestamp=false", () => {
    render(
      wrap(
        <MessageBubble
          message={makeMessage()}
          index={6}
          source={"claude-code" as Source}
        />,
      ),
    );
    expect(screen.queryByTestId("message-timestamp")).toBeNull();
  });
});
