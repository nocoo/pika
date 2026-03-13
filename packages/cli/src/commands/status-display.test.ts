import { describe, it, expect } from "vitest";
import type { CursorState, ParseError } from "@pika/core";
import {
  inferSource,
  formatTimeAgo,
  buildStatus,
  loadParseErrors,
  formatSourceLabel,
  formatStatusLines,
} from "./status-display";
import type { StatusInput, StatusOutput } from "./status-display";

// ── inferSource ────────────────────────────────────────────────

describe("inferSource", () => {
  it("detects claude-code from .claude/ path", () => {
    expect(inferSource("/Users/foo/.claude/projects/bar/session.jsonl")).toBe("claude-code");
  });

  it("detects codex from .codex/ path", () => {
    expect(inferSource("/Users/foo/.codex/sessions/2025/01/01/rollout.jsonl")).toBe("codex");
  });

  it("detects gemini-cli from .gemini/ path", () => {
    expect(inferSource("/Users/foo/.gemini/tmp/abc123/chats/session-1.json")).toBe("gemini-cli");
  });

  it("detects opencode from opencode/ path", () => {
    expect(inferSource("/Users/foo/.local/share/opencode/storage/session/proj/ses_1.json")).toBe("opencode");
  });

  it("detects opencode from windows path with backslash", () => {
    expect(inferSource("C:\\Users\\foo\\opencode\\storage\\session.json")).toBe("opencode");
  });

  it("detects vscode-copilot from workspaceStorage/ path", () => {
    expect(inferSource("/Users/foo/Library/Application Support/Code/User/workspaceStorage/abc/chatSessions/s.jsonl")).toBe("vscode-copilot");
  });

  it("detects vscode-copilot from globalStorage/ path", () => {
    expect(inferSource("/Users/foo/Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions/s.jsonl")).toBe("vscode-copilot");
  });

  it("returns null for unknown path", () => {
    expect(inferSource("/tmp/random/file.txt")).toBeNull();
  });
});

// ── formatTimeAgo ──────────────────────────────────────────────

describe("formatTimeAgo", () => {
  it("returns 'just now' for negative ms", () => {
    expect(formatTimeAgo(-100)).toBe("just now");
  });

  it("formats seconds", () => {
    expect(formatTimeAgo(30_000)).toBe("30s ago");
  });

  it("formats minutes", () => {
    expect(formatTimeAgo(150_000)).toBe("2m ago");
  });

  it("formats hours", () => {
    expect(formatTimeAgo(7_200_000)).toBe("2h ago");
  });

  it("formats days", () => {
    expect(formatTimeAgo(172_800_000)).toBe("2d ago");
  });

  it("formats zero as 0s ago", () => {
    expect(formatTimeAgo(0)).toBe("0s ago");
  });
});

// ── loadParseErrors ────────────────────────────────────────────

describe("loadParseErrors", () => {
  it("returns empty for empty string", () => {
    expect(loadParseErrors("")).toEqual([]);
  });

  it("returns empty for whitespace-only string", () => {
    expect(loadParseErrors("   \n  \n  ")).toEqual([]);
  });

  it("parses valid JSONL lines", () => {
    const line = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      source: "claude-code",
      filePath: "/foo/bar.jsonl",
      error: "bad line",
    });
    const result = loadParseErrors(line);
    expect(result).toHaveLength(1);
    expect(result[0].error).toBe("bad line");
  });

  it("skips malformed lines", () => {
    const good = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      source: "codex",
      filePath: "/foo.jsonl",
      error: "parse failed",
    });
    const content = `not json\n${good}\nalso bad`;
    const result = loadParseErrors(content);
    expect(result).toHaveLength(1);
  });

  it("skips lines missing required fields", () => {
    const incomplete = JSON.stringify({ timestamp: "2025-01-01T00:00:00Z" });
    const result = loadParseErrors(incomplete);
    expect(result).toEqual([]);
  });

  it("limits to last 5 errors, newest first", () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      JSON.stringify({
        timestamp: `2025-01-0${i + 1}T00:00:00Z`,
        source: "claude-code",
        filePath: `/file-${i}.jsonl`,
        error: `error ${i}`,
      }),
    ).join("\n");

    const result = loadParseErrors(lines);
    expect(result).toHaveLength(5);
    // Newest first (reversed from last 5)
    expect(result[0].error).toBe("error 7");
    expect(result[4].error).toBe("error 3");
  });

  it("handles lines with blank lines interspersed", () => {
    const line = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      source: "gemini-cli",
      filePath: "/foo.json",
      error: "test",
    });
    const content = `\n${line}\n\n`;
    const result = loadParseErrors(content);
    expect(result).toHaveLength(1);
  });
});

// ── buildStatus ────────────────────────────────────────────────

describe("buildStatus", () => {
  const emptyState: CursorState = { version: 1, files: {}, updatedAt: null };
  const now = new Date("2025-06-15T12:00:00Z");

  it("shows never synced when updatedAt is null", () => {
    const input: StatusInput = {
      loggedIn: true,
      cursorState: emptyState,
      parseErrors: [],
    };
    const out = buildStatus(input, now);
    expect(out.lastSyncAt).toBeNull();
    expect(out.lastSyncAgo).toBeNull();
    expect(out.totalFiles).toBe(0);
    expect(out.sourceStats).toEqual([]);
  });

  it("calculates last sync ago correctly", () => {
    const input: StatusInput = {
      loggedIn: true,
      cursorState: { ...emptyState, updatedAt: "2025-06-15T11:00:00Z" },
      parseErrors: [],
    };
    const out = buildStatus(input, now);
    expect(out.lastSyncAt).toBe("2025-06-15T11:00:00Z");
    expect(out.lastSyncAgo).toBe("1h ago");
  });

  it("groups files by source", () => {
    const files: CursorState["files"] = {
      "/Users/foo/.claude/projects/a/s1.jsonl": {
        inode: 1, mtimeMs: 100, size: 10, updatedAt: "2025-01-01T00:00:00Z", offset: 0,
      } as any,
      "/Users/foo/.claude/projects/b/s2.jsonl": {
        inode: 2, mtimeMs: 200, size: 20, updatedAt: "2025-01-01T00:00:00Z", offset: 0,
      } as any,
      "/Users/foo/.codex/sessions/2025/01/01/r.jsonl": {
        inode: 3, mtimeMs: 300, size: 30, updatedAt: "2025-01-01T00:00:00Z", offset: 0,
      } as any,
    };

    const input: StatusInput = {
      loggedIn: true,
      cursorState: { version: 1, files, updatedAt: "2025-06-15T10:00:00Z" },
      parseErrors: [],
    };
    const out = buildStatus(input, now);
    expect(out.totalFiles).toBe(3);
    expect(out.sourceStats).toEqual([
      { source: "claude-code", fileCount: 2 },
      { source: "codex", fileCount: 1 },
    ]);
  });

  it("omits sources with zero files", () => {
    const input: StatusInput = {
      loggedIn: false,
      cursorState: emptyState,
      parseErrors: [],
    };
    const out = buildStatus(input, now);
    expect(out.sourceStats).toEqual([]);
  });

  it("detects opencode sqlite cursor", () => {
    const state: CursorState = {
      version: 1,
      files: {},
      updatedAt: "2025-06-15T10:00:00Z",
      openCodeSqlite: {
        inode: 42,
        lastTimeCreated: "2025-06-15T09:00:00Z",
        lastMessageIds: ["msg1"],
        updatedAt: "2025-06-15T10:00:00Z",
      },
    };
    const input: StatusInput = { loggedIn: true, cursorState: state, parseErrors: [] };
    const out = buildStatus(input, now);
    expect(out.hasOpenCodeDb).toBe(true);
  });

  it("passes through parse errors", () => {
    const errors: ParseError[] = [
      { timestamp: "2025-01-01T00:00:00Z", source: "codex", filePath: "/a.jsonl", error: "bad" },
    ];
    const input: StatusInput = { loggedIn: true, cursorState: emptyState, parseErrors: errors };
    const out = buildStatus(input, now);
    expect(out.parseErrorCount).toBe(1);
    expect(out.recentErrors).toEqual(errors);
  });

  it("reflects logged-in status", () => {
    const input: StatusInput = { loggedIn: false, cursorState: emptyState, parseErrors: [] };
    expect(buildStatus(input, now).loggedIn).toBe(false);
  });
});

// ── formatSourceLabel ──────────────────────────────────────────

describe("formatSourceLabel", () => {
  it("formats claude-code", () => {
    expect(formatSourceLabel("claude-code")).toBe("Claude Code");
  });

  it("formats codex", () => {
    expect(formatSourceLabel("codex")).toBe("Codex CLI");
  });

  it("formats gemini-cli", () => {
    expect(formatSourceLabel("gemini-cli")).toBe("Gemini CLI");
  });

  it("formats opencode", () => {
    expect(formatSourceLabel("opencode")).toBe("OpenCode");
  });

  it("formats vscode-copilot", () => {
    expect(formatSourceLabel("vscode-copilot")).toBe("VS Code Copilot");
  });
});

// ── formatStatusLines ──────────────────────────────────────────

describe("formatStatusLines", () => {
  it("shows logged in: yes", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: null,
      lastSyncAgo: null,
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines[0]).toBe("Logged in: yes");
  });

  it("shows logged in: no", () => {
    const out: StatusOutput = {
      loggedIn: false,
      lastSyncAt: null,
      lastSyncAgo: null,
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines[0]).toBe("Logged in: no");
  });

  it("shows 'Last sync: never' when never synced", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: null,
      lastSyncAgo: null,
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines[1]).toBe("Last sync: never");
  });

  it("shows last sync time with ago", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: "2025-06-15T11:00:00Z",
      lastSyncAgo: "1h ago",
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines[1]).toBe("Last sync: 1h ago (2025-06-15T11:00:00Z)");
  });

  it("shows source stats section with files", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: "2025-06-15T11:00:00Z",
      lastSyncAgo: "1h ago",
      sourceStats: [
        { source: "claude-code", fileCount: 5 },
        { source: "codex", fileCount: 2 },
      ],
      totalFiles: 7,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines).toContain("Sources:");
    expect(lines).toContain("  Claude Code: 5 file(s)");
    expect(lines).toContain("  Codex CLI: 2 file(s)");
    expect(lines).toContain("  Total tracked: 7 file(s)");
  });

  it("shows opencode sqlite active indicator", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: "2025-06-15T11:00:00Z",
      lastSyncAgo: "1h ago",
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: true,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines).toContain("  OpenCode (SQLite): active");
  });

  it("shows 'Sources: none tracked' when no sources", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: null,
      lastSyncAgo: null,
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines).toContain("Sources: none tracked");
  });

  it("shows parse errors section", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: null,
      lastSyncAgo: null,
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 2,
      recentErrors: [
        {
          timestamp: "2025-06-15T10:30:00Z",
          source: "codex",
          filePath: "/foo/bar.jsonl",
          error: "unexpected EOF",
        },
        {
          timestamp: "2025-06-15T09:00:00Z",
          source: "claude-code",
          filePath: "/baz/qux.jsonl",
          error: "invalid JSON",
        },
      ],
    };
    const lines = formatStatusLines(out);
    expect(lines).toContain("Parse errors: 2");
    expect(lines).toContain("  [2025-06-15 10:30:00] codex: unexpected EOF");
    expect(lines).toContain("    /foo/bar.jsonl");
    expect(lines).toContain("  [2025-06-15 09:00:00] claude-code: invalid JSON");
    expect(lines).toContain("    /baz/qux.jsonl");
  });

  it("omits parse errors section when count is 0", () => {
    const out: StatusOutput = {
      loggedIn: true,
      lastSyncAt: null,
      lastSyncAgo: null,
      sourceStats: [],
      totalFiles: 0,
      hasOpenCodeDb: false,
      parseErrorCount: 0,
      recentErrors: [],
    };
    const lines = formatStatusLines(out);
    expect(lines.some((l) => l.includes("Parse error"))).toBe(false);
  });
});
