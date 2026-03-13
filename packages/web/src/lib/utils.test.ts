import { describe, it, expect } from "vitest";
import { cn, formatTokens, formatTokensFull } from "./utils";

// ── cn ─────────────────────────────────────────────────────────

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("deduplicates tailwind classes", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("returns empty string for no input", () => {
    expect(cn()).toBe("");
  });
});

// ── formatTokens ──────────────────────────────────────────────

describe("formatTokens", () => {
  it("returns raw number below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands as K", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(45_300)).toBe("45.3K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  it("formats millions as M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });

  it("formats billions as B", () => {
    expect(formatTokens(1_000_000_000)).toBe("1.0B");
    expect(formatTokens(11_832_456_789)).toBe("11.8B");
  });
});

// ── formatTokensFull ──────────────────────────────────────────

describe("formatTokensFull", () => {
  it("formats with comma separators", () => {
    expect(formatTokensFull(0)).toBe("0");
    expect(formatTokensFull(1234)).toBe("1,234");
    expect(formatTokensFull(11_832_456)).toBe("11,832,456");
  });
});
