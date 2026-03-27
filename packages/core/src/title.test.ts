import { describe, expect, it } from "vitest";
import { generateTitle, getFirstUserMessage } from "./title";
import type { CanonicalMessage } from "./types";

// ── Helpers ──────────────────────────────────────────────────────

function makeMsg(
  role: CanonicalMessage["role"],
  content: string,
): CanonicalMessage {
  return {
    role,
    content,
    timestamp: "2026-01-01T00:00:00Z",
  };
}

// ── getFirstUserMessage ──────────────────────────────────────────

describe("getFirstUserMessage", () => {
  it("returns null for empty array", () => {
    expect(getFirstUserMessage([])).toBeNull();
  });

  it("returns null when no user messages exist", () => {
    const msgs = [makeMsg("assistant", "Hello"), makeMsg("tool", "result")];
    expect(getFirstUserMessage(msgs)).toBeNull();
  });

  it("returns null when user message is empty", () => {
    const msgs = [makeMsg("user", "   ")];
    expect(getFirstUserMessage(msgs)).toBeNull();
  });

  it("returns first user message content", () => {
    const msgs = [
      makeMsg("system", "system prompt"),
      makeMsg("user", "fix the login bug"),
      makeMsg("user", "also update tests"),
    ];
    expect(getFirstUserMessage(msgs)).toBe("fix the login bug");
  });

  it("trims whitespace from content", () => {
    const msgs = [makeMsg("user", "  hello world  ")];
    expect(getFirstUserMessage(msgs)).toBe("hello world");
  });

  it("skips empty user messages to find non-empty one", () => {
    const msgs = [
      makeMsg("user", ""),
      makeMsg("user", "  "),
      makeMsg("user", "real message"),
    ];
    expect(getFirstUserMessage(msgs)).toBe("real message");
  });
});

// ── generateTitle ────────────────────────────────────────────────

describe("generateTitle", () => {
  it("returns null when firstUserMessage is null", () => {
    expect(generateTitle("project", null)).toBeNull();
  });

  it("returns null when firstUserMessage is empty", () => {
    expect(generateTitle("project", "")).toBeNull();
  });

  it("returns null when firstUserMessage is only whitespace", () => {
    expect(generateTitle("project", "   \n\t  ")).toBeNull();
  });

  it("returns message only when no project name", () => {
    expect(generateTitle(null, "fix the bug")).toBe("fix the bug");
  });

  it("returns message with project prefix", () => {
    expect(generateTitle("my-app", "fix the bug")).toBe("[my-app] fix the bug");
  });

  it("extracts last path segment from project name", () => {
    expect(generateTitle("/Users/me/workspace/pika", "hello")).toBe(
      "[pika] hello",
    );
  });

  it("truncates long messages at word boundary", () => {
    const longMsg =
      "implement a comprehensive authentication system with OAuth2 support including Google and GitHub providers and session management";
    const title = generateTitle(null, longMsg);
    expect(title?.length).toBeLessThanOrEqual(80);
    expect(title?.endsWith("…")).toBe(true);
    // Should not cut in the middle of a word
    expect(title?.slice(0, -1).endsWith(" ")).toBeFalsy();
  });

  it("truncates with project prefix within 80 chars", () => {
    const longMsg =
      "implement a comprehensive authentication system with OAuth2 support including Google and GitHub providers";
    const title = generateTitle("my-app", longMsg);
    expect(title?.length).toBeLessThanOrEqual(80);
    expect(title?.startsWith("[my-app] ")).toBe(true);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("does not truncate short messages", () => {
    expect(generateTitle(null, "fix typo")).toBe("fix typo");
  });

  it("normalizes whitespace in message", () => {
    expect(generateTitle(null, "fix\n\nthe  bug\there")).toBe(
      "fix the bug here",
    );
  });

  it("handles exactly 80 char message without truncation", () => {
    const msg = "a".repeat(80);
    expect(generateTitle(null, msg)).toBe(msg);
    expect(generateTitle(null, msg)?.length).toBe(80);
  });

  it("handles 81 char message with truncation", () => {
    const msg = "a".repeat(81);
    const title = generateTitle(null, msg);
    expect(title?.length).toBeLessThanOrEqual(80);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("handles single long word without spaces", () => {
    const msg = "superlongcommandthathasnospacesandexceedsthelimitbyfar".repeat(
      2,
    );
    const title = generateTitle(null, msg);
    expect(title?.length).toBeLessThanOrEqual(80);
    expect(title?.endsWith("…")).toBe(true);
  });
});
