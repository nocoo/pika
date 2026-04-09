import { describe, expect, it } from "vitest";
import { normalizeSource, SOURCE_ALIASES, SOURCES } from "./types";

// ── normalizeSource ────────────────────────────────────────────

describe("normalizeSource", () => {
  it("returns canonical source names unchanged", () => {
    for (const source of SOURCES) {
      expect(normalizeSource(source)).toBe(source);
    }
  });

  it("maps aliases to canonical sources", () => {
    expect(normalizeSource("gemini")).toBe("gemini-cli");
    expect(normalizeSource("claude")).toBe("claude-code");
    expect(normalizeSource("copilot")).toBe("vscode-copilot");
  });

  it("returns undefined for invalid sources", () => {
    expect(normalizeSource("unknown")).toBeUndefined();
    expect(normalizeSource("")).toBeUndefined();
    expect(normalizeSource("Claude-Code")).toBeUndefined();
    expect(normalizeSource("GEMINI")).toBeUndefined();
  });

  it("SOURCE_ALIASES values are all valid sources", () => {
    for (const [alias, source] of Object.entries(SOURCE_ALIASES)) {
      expect(SOURCES).toContain(source);
      // Verify alias is not already a canonical source
      expect(SOURCES).not.toContain(alias);
    }
  });
});
