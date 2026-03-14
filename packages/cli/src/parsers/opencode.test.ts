/**
 * Tests for OpenCode parser.
 *
 * Covers: parseOpenCodeMessages (core), parseOpenCodeJsonSession (filesystem),
 * parseOpenCodeSqliteSession (SQLite wrapper), extractProjectRef, extractProjectName.
 * Part types: text, tool (completed/running), synthetic, reasoning, step-start/finish,
 * patch, file, compaction. Token accumulation, edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseOpenCodeMessages,
  parseOpenCodeJsonSession,
  parseOpenCodeSqliteSession,
  extractProjectRef,
  extractProjectName,
} from "./opencode";
import type { OcSession, OcMessage, OcPart } from "./opencode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSession(overrides: Partial<OcSession> = {}): OcSession {
  return {
    id: "ses_test123",
    projectID: "abc123def456",
    directory: "/Users/test/workspace/my-project",
    title: "Test Session",
    time: { created: 1700000000000, updated: 1700000300000 },
    ...overrides,
  };
}

function userMsg(
  id: string,
  text: string,
  ts: number,
): OcMessage {
  return {
    id,
    sessionID: "ses_test123",
    role: "user",
    time: { created: ts },
    parts: [
      {
        id: `prt_${id}_1`,
        type: "text",
        text,
        messageID: id,
        sessionID: "ses_test123",
      },
    ],
  };
}

function assistantMsg(
  id: string,
  text: string,
  ts: number,
  opts: {
    model?: string;
    tokens?: { input?: number; output?: number; cacheRead?: number };
    toolParts?: OcPart[];
  } = {},
): OcMessage {
  const parts: OcPart[] = [];

  if (text) {
    parts.push({
      id: `prt_${id}_text`,
      type: "text",
      text,
      messageID: id,
      sessionID: "ses_test123",
      time: { start: ts, end: ts },
    });
  }

  if (opts.toolParts) {
    parts.push(...opts.toolParts);
  }

  return {
    id,
    sessionID: "ses_test123",
    role: "assistant",
    time: { created: ts, completed: ts + 1000 },
    modelID: opts.model ?? "claude-sonnet-4-20250514",
    providerID: "anthropic",
    tokens: opts.tokens
      ? {
          input: opts.tokens.input ?? 0,
          output: opts.tokens.output ?? 0,
          reasoning: 0,
          cache: { read: opts.tokens.cacheRead ?? 0, write: 0 },
        }
      : undefined,
    parts,
  };
}

function completedToolPart(
  name: string,
  input: Record<string, unknown>,
  output: string,
  ts: number,
): OcPart {
  return {
    id: `prt_tool_${Date.now()}`,
    type: "tool",
    tool: name,
    callID: `call_${Date.now()}`,
    state: {
      status: "completed",
      input,
      output,
      title: name,
      metadata: { output, exit: 0, truncated: false },
      time: { start: ts, end: ts + 500 },
    },
    messageID: "msg_test",
    sessionID: "ses_test123",
  };
}

function runningToolPart(
  name: string,
  input: Record<string, unknown>,
  ts: number,
): OcPart {
  return {
    id: `prt_tool_${Date.now()}`,
    type: "tool",
    tool: name,
    callID: `call_${Date.now()}`,
    state: {
      status: "running",
      input,
      metadata: { output: "" },
      time: { start: ts },
    },
    messageID: "msg_test",
    sessionID: "ses_test123",
  };
}

// ---------------------------------------------------------------------------
// parseOpenCodeMessages — basic parsing
// ---------------------------------------------------------------------------

describe("parseOpenCodeMessages", () => {
  it("parses a simple user-assistant conversation", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello OpenCode", 1700000000000),
      assistantMsg("msg_2", "Hello! How can I help?", 1700000001000, {
        tokens: { input: 100, output: 20, cacheRead: 5 },
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test/path");
    expect(result.canonical.sessionKey).toBe("opencode:ses_test123");
    expect(result.canonical.source).toBe("opencode");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[0].content).toBe("Hello OpenCode");
    expect(result.canonical.messages[1].role).toBe("assistant");
    expect(result.canonical.messages[1].content).toBe("Hello! How can I help?");
  });

  it("accumulates token counts across assistant messages", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "First", 1700000000000),
      assistantMsg("msg_2", "Reply 1", 1700000001000, {
        tokens: { input: 100, output: 50, cacheRead: 10 },
      }),
      userMsg("msg_3", "Second", 1700000002000),
      assistantMsg("msg_4", "Reply 2", 1700000003000, {
        tokens: { input: 200, output: 80, cacheRead: 30 },
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.totalInputTokens).toBe(300);
    expect(result.canonical.totalOutputTokens).toBe(130);
    expect(result.canonical.totalCachedTokens).toBe(40);
  });

  it("extracts model from assistant messages", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000, {
        model: "claude-opus-4-20250514",
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.model).toBe("claude-opus-4-20250514");
    expect(result.canonical.messages[1].model).toBe("claude-opus-4-20250514");
  });

  it("uses last model as session model", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Reply", 1700000001000, {
        model: "claude-sonnet-4-20250514",
      }),
      userMsg("msg_3", "More", 1700000002000),
      assistantMsg("msg_4", "Sure", 1700000003000, {
        model: "claude-opus-4-20250514",
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.model).toBe("claude-opus-4-20250514");
  });

  it("computes duration from session time", () => {
    const session = buildSession({
      time: { created: 1700000000000, updated: 1700000330000 },
    });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000330000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.durationSeconds).toBe(330);
  });

  it("sets projectRef from projectID", () => {
    const session = buildSession({
      projectID: "bdf1f79d9d912149e40897001619b15ac9ce58c9",
    });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.projectRef).toBeDefined();
    expect(result.canonical.projectRef).toHaveLength(16);
  });

  it("sets projectName from directory", () => {
    const session = buildSession({
      directory: "/Users/test/workspace/my-cool-project",
    });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.projectName).toBe(
      "/Users/test/workspace/my-cool-project",
    );
  });

  it("sets title from session", () => {
    const session = buildSession({ title: "Fix authentication bug" });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.title).toBe("Fix authentication bug");
  });
});

// ---------------------------------------------------------------------------
// parseOpenCodeMessages — tool parts
// ---------------------------------------------------------------------------

describe("parseOpenCodeMessages — tool parts", () => {
  it("extracts completed tool calls", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Read the file", 1700000000000),
      assistantMsg("msg_2", "Let me read that.", 1700000001000, {
        toolParts: [
          completedToolPart(
            "bash",
            { command: "cat package.json" },
            '{"name":"test"}',
            1700000001500,
          ),
        ],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // user + assistant text + tool invocation + tool result
    expect(result.canonical.messages).toHaveLength(4);

    const toolInvocation = result.canonical.messages[2];
    expect(toolInvocation.role).toBe("tool");
    expect(toolInvocation.toolName).toBe("bash");
    expect(toolInvocation.toolInput).toBe('{"command":"cat package.json"}');

    const toolResult = result.canonical.messages[3];
    expect(toolResult.role).toBe("tool");
    expect(toolResult.toolResult).toBe('{"name":"test"}');
  });

  it("extracts running tool calls (invocation only)", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Run something", 1700000000000),
      assistantMsg("msg_2", "Running...", 1700000001000, {
        toolParts: [
          runningToolPart(
            "bash",
            { command: "npm test" },
            1700000001500,
          ),
        ],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // user + assistant text + tool invocation (no result for running)
    expect(result.canonical.messages).toHaveLength(3);
    expect(result.canonical.messages[2].role).toBe("tool");
    expect(result.canonical.messages[2].toolName).toBe("bash");
    expect(result.canonical.messages[2].toolResult).toBeUndefined();
  });

  it("handles tool call with metadata.output fallback", () => {
    const session = buildSession();
    const toolPart: OcPart = {
      id: "prt_tool_1",
      type: "tool",
      tool: "read",
      callID: "call_1",
      state: {
        status: "completed",
        input: { filePath: "test.ts" },
        // No output field — should fall back to metadata.output
        metadata: { output: "file contents here", exit: 0, truncated: false },
        time: { start: 1700000001500, end: 1700000002000 },
      },
    };

    const messages = [
      userMsg("msg_1", "Read file", 1700000000000),
      assistantMsg("msg_2", "Reading.", 1700000001000, {
        toolParts: [toolPart],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    const toolResult = result.canonical.messages.find(
      (m) => m.toolResult !== undefined,
    );
    expect(toolResult?.toolResult).toBe("file contents here");
  });

  it("handles multiple tool calls in one message", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Read two files", 1700000000000),
      assistantMsg("msg_2", "Reading both.", 1700000001000, {
        toolParts: [
          completedToolPart("read", { path: "a.ts" }, "content-a", 1700000001500),
          completedToolPart("read", { path: "b.ts" }, "content-b", 1700000002000),
        ],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // user + assistant text + 2*(invocation + result)
    expect(result.canonical.messages).toHaveLength(6);
  });

  it("handles completed tool with no input", () => {
    const session = buildSession();
    const toolPart: OcPart = {
      id: "prt_tool_1",
      type: "tool",
      tool: "noop",
      callID: "call_1",
      state: {
        status: "completed",
        // no input field
        output: "done",
        time: { start: 1700000001500, end: 1700000002000 },
      },
    };

    const messages = [
      userMsg("msg_1", "Run", 1700000000000),
      assistantMsg("msg_2", "Running.", 1700000001000, {
        toolParts: [toolPart],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    const toolInvocation = result.canonical.messages.find(
      (m) => m.role === "tool" && m.toolResult === undefined,
    );
    expect(toolInvocation?.toolInput).toBeUndefined();
  });

  it("handles completed tool with no output and no metadata.output (empty string fallback)", () => {
    const session = buildSession();
    const toolPart: OcPart = {
      id: "prt_tool_1",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: {
        status: "completed",
        input: { command: "echo" },
        // no output, no metadata.output — falls back to ""
        time: { start: 1700000001500, end: 1700000002000 },
      },
    };

    const messages = [
      userMsg("msg_1", "Run", 1700000000000),
      assistantMsg("msg_2", "Running.", 1700000001000, {
        toolParts: [toolPart],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // user + text + tool invocation (no tool result because output is "")
    const toolMsgs = result.canonical.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1); // only invocation, empty output not emitted
    expect(toolMsgs[0].toolInput).toBe('{"command":"echo"}');
  });

  it("handles tool with no state", () => {
    const session = buildSession();
    const toolPart: OcPart = {
      id: "prt_tool_1",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      // no state
    };

    const messages = [
      userMsg("msg_1", "Run", 1700000000000),
      assistantMsg("msg_2", "Running.", 1700000001000, {
        toolParts: [toolPart],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // user + assistant text only (tool with no state is skipped)
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles completed tool with empty output", () => {
    const session = buildSession();
    const toolPart: OcPart = {
      id: "prt_tool_1",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: {
        status: "completed",
        input: { command: "true" },
        output: "",
        time: { start: 1700000001500, end: 1700000002000 },
      },
    };

    const messages = [
      userMsg("msg_1", "Run", 1700000000000),
      assistantMsg("msg_2", "Running.", 1700000001000, {
        toolParts: [toolPart],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // user + text + tool invocation (no result because empty output)
    expect(result.canonical.messages).toHaveLength(3);
    const toolMsgs = result.canonical.messages.filter(
      (m) => m.role === "tool",
    );
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].toolResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseOpenCodeMessages — skipped part types
// ---------------------------------------------------------------------------

describe("parseOpenCodeMessages — skipped part types", () => {
  it("skips synthetic text parts", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        parts: [
          {
            id: "prt_1",
            type: "text",
            text: "[analyze-mode] SYSTEM PROMPT...",
            synthetic: true,
          },
          {
            id: "prt_2",
            type: "text",
            text: "Hello, help me debug this.",
          },
        ],
      },
      assistantMsg("msg_2", "Sure!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].content).toBe("Hello, help me debug this.");
  });

  it("skips reasoning parts", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      userMsg("msg_1", "Help me", 1700000000000),
      {
        id: "msg_2",
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000002000 },
        modelID: "claude-sonnet-4-20250514",
        parts: [
          {
            id: "prt_1",
            type: "reasoning",
            text: "Let me think about this...",
            time: { start: 1700000001000, end: 1700000001500 },
          },
          {
            id: "prt_2",
            type: "text",
            text: "Here is my answer.",
            time: { start: 1700000001500, end: 1700000002000 },
          },
        ],
      },
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[1].content).toBe("Here is my answer.");
  });

  it("skips step-start and step-finish parts", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      userMsg("msg_1", "Hello", 1700000000000),
      {
        id: "msg_2",
        role: "assistant",
        time: { created: 1700000001000 },
        modelID: "claude-sonnet-4-20250514",
        parts: [
          { id: "prt_1", type: "step-start", text: undefined },
          { id: "prt_2", type: "text", text: "Reply text." },
          { id: "prt_3", type: "step-finish", text: undefined },
        ],
      },
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[1].content).toBe("Reply text.");
  });

  it("skips patch, file, and compaction parts", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      userMsg("msg_1", "Make changes", 1700000000000),
      {
        id: "msg_2",
        role: "assistant",
        time: { created: 1700000001000 },
        modelID: "claude-sonnet-4-20250514",
        parts: [
          { id: "prt_1", type: "text", text: "Done." },
          { id: "prt_2", type: "patch" },
          { id: "prt_3", type: "file" },
          { id: "prt_4", type: "compaction" },
        ],
      },
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseOpenCodeMessages — edge cases
// ---------------------------------------------------------------------------

describe("parseOpenCodeMessages — edge cases", () => {
  it("returns empty result for empty messages array", () => {
    const session = buildSession();
    const result = parseOpenCodeMessages(session, [], "json", "/test");
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("opencode:ses_test123");
  });

  it("returns empty result for null messages", () => {
    const session = buildSession();
    const result = parseOpenCodeMessages(
      session,
      null as unknown as OcMessage[],
      "json",
      "/test",
    );
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result when all messages produce no canonical output", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        parts: [
          { id: "prt_1", type: "text", text: "", synthetic: false },
        ],
      },
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("opencode:ses_test123");
  });

  it("handles messages with no parts", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        parts: [],
      },
      userMsg("msg_2", "Real message", 1700000001000),
      assistantMsg("msg_3", "Reply", 1700000002000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles messages without parts field", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        // no parts field
      },
      userMsg("msg_2", "Hello", 1700000001000),
      assistantMsg("msg_3", "Hi!", 1700000002000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles messages with invalid role", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: 123 as unknown as string,
        time: { created: 1700000000000 },
        parts: [{ id: "prt_1", type: "text", text: "skip me" }],
      },
      userMsg("msg_2", "Hello", 1700000001000),
      assistantMsg("msg_3", "Hi!", 1700000002000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles parts with invalid type", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        parts: [
          { id: "prt_1", type: 42 as unknown as string, text: "bad" },
          { id: "prt_2", type: "text", text: "Hello" },
        ],
      },
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].content).toBe("Hello");
  });

  it("handles negative token values gracefully", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000, {
        tokens: { input: -5, output: -10, cacheRead: -1 },
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  it("handles assistant messages without tokens", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  it("handles session with no time.created (uses fallback)", () => {
    const session = buildSession({ time: undefined });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(new Date(result.canonical.startedAt).getTime()).toBeGreaterThan(0);
    expect(result.canonical.durationSeconds).toBe(0);
  });

  it("handles session with invalid time values", () => {
    const session = buildSession({ time: { created: -1, updated: NaN } });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(new Date(result.canonical.startedAt).getTime()).toBeGreaterThan(0);
  });

  it("handles session with no projectID", () => {
    const session = buildSession({ projectID: undefined });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.projectRef).toBeNull();
  });

  it("handles session with no directory", () => {
    const session = buildSession({ directory: undefined });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.projectName).toBeNull();
  });

  it("handles session with no title", () => {
    const session = buildSession({ title: undefined });
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.title).toBeNull();
  });

  it("handles message with no time.created (uses fallback timestamp)", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: undefined,
        parts: [{ id: "prt_1", type: "text", text: "Hello" }],
      },
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(
      new Date(result.canonical.messages[0].timestamp).getTime(),
    ).toBeGreaterThan(0);
  });

  it("produces raw session archive with json format", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test/path");
    expect(result.raw.sessionKey).toBe("opencode:ses_test123");
    expect(result.raw.source).toBe("opencode");
    expect(result.raw.sourceFiles).toHaveLength(1);
    expect(result.raw.sourceFiles[0].format).toBe("json");
    expect(result.raw.sourceFiles[0].path).toBe("/test/path");
  });

  it("produces raw session archive with sqlite-export format", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(
      session,
      messages,
      "sqlite-export",
      "/test/db.sqlite",
    );
    expect(result.raw.sourceFiles[0].format).toBe("sqlite-export");
  });

  it("does not set model on user messages", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000, {
        model: "claude-opus-4-20250514",
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages[0].model).toBeUndefined();
    expect(result.canonical.messages[1].model).toBe("claude-opus-4-20250514");
  });

  it("falls back model from lastModel when modelID missing", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      userMsg("msg_1", "First", 1700000000000),
      assistantMsg("msg_2", "Reply 1", 1700000001000, {
        model: "claude-opus-4-20250514",
      }),
      userMsg("msg_3", "Second", 1700000002000),
      {
        id: "msg_4",
        role: "assistant",
        time: { created: 1700000003000 },
        // no modelID
        parts: [
          { id: "prt_4", type: "text", text: "Reply 2" },
        ],
      },
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    const assistants = result.canonical.messages.filter(
      (m) => m.role === "assistant",
    );
    expect(assistants[1].model).toBe("claude-opus-4-20250514");
  });

  it("handles text part with non-string text", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        parts: [
          { id: "prt_1", type: "text", text: 42 as unknown as string },
          { id: "prt_2", type: "text", text: "Real text" },
        ],
      },
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].content).toBe("Real text");
  });

  it("handles null message in array", () => {
    const session = buildSession();
    const messages = [
      null as unknown as OcMessage,
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles null part in parts array", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        parts: [
          null as unknown as OcPart,
          { id: "prt_1", type: "text", text: "Hello" },
        ],
      },
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].content).toBe("Hello");
  });

  it("skips user tokens (only accumulates from assistant)", () => {
    const session = buildSession();
    const messages: OcMessage[] = [
      {
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
        tokens: { input: 999, output: 999, cache: { read: 999, write: 0 } },
        parts: [{ id: "prt_1", type: "text", text: "Hello" }],
      },
      assistantMsg("msg_2", "Hi!", 1700000001000, {
        tokens: { input: 100, output: 50, cacheRead: 10 },
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    expect(result.canonical.totalInputTokens).toBe(100);
    expect(result.canonical.totalOutputTokens).toBe(50);
    expect(result.canonical.totalCachedTokens).toBe(10);
  });

  it("handles tool with unknown status (not running/completed)", () => {
    const session = buildSession();
    const toolPart: OcPart = {
      id: "prt_tool_1",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: {
        status: "error",
        input: { command: "bad cmd" },
        time: { start: 1700000001500 },
      },
    };

    const messages = [
      userMsg("msg_1", "Run", 1700000000000),
      assistantMsg("msg_2", "Running.", 1700000001000, {
        toolParts: [toolPart],
      }),
    ];

    const result = parseOpenCodeMessages(session, messages, "json", "/test");
    // Only user + assistant text, tool with "error" status is not emitted
    expect(result.canonical.messages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseOpenCodeJsonSession — filesystem
// ---------------------------------------------------------------------------

describe("parseOpenCodeJsonSession", () => {
  let tmpDir: string;
  let storageDir: string;
  let sessionDir: string;
  let messageDir: string;
  let partDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-opencode-parser-"));
    storageDir = join(tmpDir, "storage");
    sessionDir = join(storageDir, "session", "proj_abc123");
    messageDir = join(storageDir, "message");
    partDir = join(storageDir, "part");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await mkdir(partDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a session from JSON files", async () => {
    // Write session file
    const sessionPath = join(sessionDir, "ses_abc.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_abc",
        projectID: "proj_abc123",
        directory: "/Users/test/project",
        title: "Test Session",
        time: { created: 1700000000000, updated: 1700000300000 },
      }),
    );

    // Write message files
    const msgDir = join(messageDir, "ses_abc");
    await mkdir(msgDir, { recursive: true });
    await writeFile(
      join(msgDir, "msg_1.json"),
      JSON.stringify({
        id: "msg_1",
        sessionID: "ses_abc",
        role: "user",
        time: { created: 1700000000000 },
      }),
    );
    await writeFile(
      join(msgDir, "msg_2.json"),
      JSON.stringify({
        id: "msg_2",
        sessionID: "ses_abc",
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000002000 },
        modelID: "claude-sonnet-4-20250514",
        tokens: { input: 100, output: 50, cache: { read: 10, write: 0 } },
      }),
    );

    // Write part files
    const partDir1 = join(partDir, "msg_1");
    await mkdir(partDir1, { recursive: true });
    await writeFile(
      join(partDir1, "prt_1.json"),
      JSON.stringify({
        id: "prt_1",
        type: "text",
        text: "Hello from user",
        messageID: "msg_1",
        sessionID: "ses_abc",
      }),
    );

    const partDir2 = join(partDir, "msg_2");
    await mkdir(partDir2, { recursive: true });
    await writeFile(
      join(partDir2, "prt_2.json"),
      JSON.stringify({
        id: "prt_2",
        type: "text",
        text: "Hello! How can I help?",
        messageID: "msg_2",
        sessionID: "ses_abc",
        time: { start: 1700000001000, end: 1700000002000 },
      }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );

    expect(result.canonical.sessionKey).toBe("opencode:ses_abc");
    expect(result.canonical.source).toBe("opencode");
    expect(result.canonical.title).toBe("Test Session");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[0].content).toBe("Hello from user");
    expect(result.canonical.messages[1].role).toBe("assistant");
    expect(result.canonical.messages[1].content).toBe("Hello! How can I help?");
    expect(result.canonical.totalInputTokens).toBe(100);
    expect(result.canonical.model).toBe("claude-sonnet-4-20250514");

    // Bug #5: raw archive should contain individual source files, not synthetic JSON
    const sf = result.raw.sourceFiles;
    // 1 session + 2 messages + 2 parts = 5 source files
    expect(sf).toHaveLength(5);
    // All entries have format "json"
    expect(sf.every((f) => f.format === "json")).toBe(true);
    // First entry is the session file
    expect(sf[0].path).toBe(sessionPath);
    expect(JSON.parse(sf[0].content).id).toBe("ses_abc");
    // For each message: message file then its parts (interleaved)
    expect(sf[1].path).toContain("msg_1.json");
    expect(JSON.parse(sf[1].content).role).toBe("user");
    expect(sf[2].path).toContain("prt_1.json");
    expect(JSON.parse(sf[2].content).text).toBe("Hello from user");
    expect(sf[3].path).toContain("msg_2.json");
    expect(JSON.parse(sf[3].content).role).toBe("assistant");
    expect(sf[4].path).toContain("prt_2.json");
    expect(JSON.parse(sf[4].content).text).toBe("Hello! How can I help?");
    // No entry should be a synthetic JSON.stringify of the messages array
    for (const f of sf) {
      const parsed = JSON.parse(f.content);
      expect(Array.isArray(parsed)).toBe(false);
    }
  });

  it("raw archive preserves original file content verbatim", async () => {
    // Write session with extra whitespace to verify content is preserved as-is
    const sessionContent = JSON.stringify(
      { id: "ses_raw", projectID: "proj_raw", title: "Raw Test", time: { created: 1700000000000, updated: 1700000001000 } },
      null,
      2,
    );
    const sessionPath = join(sessionDir, "ses_raw.json");
    await writeFile(sessionPath, sessionContent);

    const msgDir = join(messageDir, "ses_raw");
    await mkdir(msgDir, { recursive: true });
    const msgContent = JSON.stringify(
      { id: "msg_r1", sessionID: "ses_raw", role: "user", time: { created: 1700000000000 } },
      null,
      2,
    );
    await writeFile(join(msgDir, "msg_r1.json"), msgContent);

    const pDir = join(partDir, "msg_r1");
    await mkdir(pDir, { recursive: true });
    const partContent = JSON.stringify(
      { id: "prt_r1", type: "text", text: "verbatim check", messageID: "msg_r1", sessionID: "ses_raw" },
      null,
      2,
    );
    await writeFile(join(pDir, "prt_r1.json"), partContent);

    const result = await parseOpenCodeJsonSession(sessionPath, messageDir, partDir);

    // 1 session + 1 message + 1 part = 3 source files
    expect(result.raw.sourceFiles).toHaveLength(3);
    // Content should be the EXACT original string (pretty-printed), not re-serialized
    expect(result.raw.sourceFiles[0].content).toBe(sessionContent);
    expect(result.raw.sourceFiles[1].content).toBe(msgContent);
    expect(result.raw.sourceFiles[2].content).toBe(partContent);
  });

  it("returns empty result for non-existent session file", async () => {
    const result = await parseOpenCodeJsonSession(
      join(sessionDir, "nonexistent.json"),
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("opencode:unknown");
  });

  it("returns empty result for invalid session JSON", async () => {
    const sessionPath = join(sessionDir, "bad.json");
    await writeFile(sessionPath, "not valid json {{{");

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result for session with no id", async () => {
    const sessionPath = join(sessionDir, "noid.json");
    await writeFile(sessionPath, JSON.stringify({ title: "No ID" }));

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("opencode:unknown");
  });

  it("returns empty result when message dir does not exist", async () => {
    const sessionPath = join(sessionDir, "ses_nmsgs.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_nmsgs",
        time: { created: 1700000000000, updated: 1700000000000 },
      }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("opencode:ses_nmsgs");
  });

  it("handles messages with no part directory", async () => {
    const sessionPath = join(sessionDir, "ses_noparts.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_noparts",
        time: { created: 1700000000000, updated: 1700000000000 },
      }),
    );

    const msgDir = join(messageDir, "ses_noparts");
    await mkdir(msgDir, { recursive: true });
    await writeFile(
      join(msgDir, "msg_1.json"),
      JSON.stringify({
        id: "msg_1",
        sessionID: "ses_noparts",
        role: "user",
        time: { created: 1700000000000 },
      }),
    );

    // No part dir for msg_1 — should get empty parts
    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    // Message with no parts produces no output
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("sorts messages by creation time", async () => {
    const sessionPath = join(sessionDir, "ses_sort.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_sort",
        time: { created: 1700000000000, updated: 1700000002000 },
      }),
    );

    const msgDir = join(messageDir, "ses_sort");
    await mkdir(msgDir, { recursive: true });

    // Write messages in reverse order (msg_2 first)
    await writeFile(
      join(msgDir, "msg_2.json"),
      JSON.stringify({
        id: "msg_2",
        sessionID: "ses_sort",
        role: "assistant",
        time: { created: 1700000002000 },
        modelID: "claude-sonnet-4-20250514",
      }),
    );
    await writeFile(
      join(msgDir, "msg_1.json"),
      JSON.stringify({
        id: "msg_1",
        sessionID: "ses_sort",
        role: "user",
        time: { created: 1700000001000 },
      }),
    );

    // Parts
    const partDir1 = join(partDir, "msg_1");
    await mkdir(partDir1, { recursive: true });
    await writeFile(
      join(partDir1, "prt_1.json"),
      JSON.stringify({ id: "prt_1", type: "text", text: "First" }),
    );
    const partDir2 = join(partDir, "msg_2");
    await mkdir(partDir2, { recursive: true });
    await writeFile(
      join(partDir2, "prt_2.json"),
      JSON.stringify({ id: "prt_2", type: "text", text: "Second" }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages[0].content).toBe("First");
    expect(result.canonical.messages[1].content).toBe("Second");
  });

  it("skips non-json files in message directory", async () => {
    const sessionPath = join(sessionDir, "ses_nonjson.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_nonjson",
        time: { created: 1700000000000, updated: 1700000001000 },
      }),
    );

    const msgDir = join(messageDir, "ses_nonjson");
    await mkdir(msgDir, { recursive: true });
    await writeFile(join(msgDir, "notes.txt"), "not a message");
    await writeFile(
      join(msgDir, "msg_1.json"),
      JSON.stringify({
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
      }),
    );

    const partDir1 = join(partDir, "msg_1");
    await mkdir(partDir1, { recursive: true });
    await writeFile(
      join(partDir1, "prt_1.json"),
      JSON.stringify({ id: "prt_1", type: "text", text: "Hello" }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(1);
  });

  it("skips invalid message JSON files", async () => {
    const sessionPath = join(sessionDir, "ses_badmsg.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_badmsg",
        time: { created: 1700000000000, updated: 1700000001000 },
      }),
    );

    const msgDir = join(messageDir, "ses_badmsg");
    await mkdir(msgDir, { recursive: true });
    await writeFile(join(msgDir, "msg_bad.json"), "not json {{{");
    await writeFile(
      join(msgDir, "msg_good.json"),
      JSON.stringify({
        id: "msg_good",
        role: "user",
        time: { created: 1700000000000 },
      }),
    );

    const goodPartDir = join(partDir, "msg_good");
    await mkdir(goodPartDir, { recursive: true });
    await writeFile(
      join(goodPartDir, "prt_1.json"),
      JSON.stringify({ id: "prt_1", type: "text", text: "Hello" }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(1);
  });

  it("skips non-json files in part directory", async () => {
    const sessionPath = join(sessionDir, "ses_badpart.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_badpart",
        time: { created: 1700000000000, updated: 1700000001000 },
      }),
    );

    const msgDir = join(messageDir, "ses_badpart");
    await mkdir(msgDir, { recursive: true });
    await writeFile(
      join(msgDir, "msg_1.json"),
      JSON.stringify({
        id: "msg_1",
        role: "user",
        time: { created: 1700000000000 },
      }),
    );

    const pDir = join(partDir, "msg_1");
    await mkdir(pDir, { recursive: true });
    await writeFile(join(pDir, "notes.txt"), "not a part");
    await writeFile(
      join(pDir, "prt_1.json"),
      JSON.stringify({ id: "prt_1", type: "text", text: "Hello" }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(1);
  });

  it("handles message without role field", async () => {
    const sessionPath = join(sessionDir, "ses_norole.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        id: "ses_norole",
        time: { created: 1700000000000, updated: 1700000001000 },
      }),
    );

    const msgDir = join(messageDir, "ses_norole");
    await mkdir(msgDir, { recursive: true });
    await writeFile(
      join(msgDir, "msg_norole.json"),
      JSON.stringify({
        id: "msg_norole",
        time: { created: 1700000000000 },
        // no role
      }),
    );
    await writeFile(
      join(msgDir, "msg_good.json"),
      JSON.stringify({
        id: "msg_good",
        role: "user",
        time: { created: 1700000001000 },
      }),
    );

    const goodPartDir = join(partDir, "msg_good");
    await mkdir(goodPartDir, { recursive: true });
    await writeFile(
      join(goodPartDir, "prt_1.json"),
      JSON.stringify({ id: "prt_1", type: "text", text: "Hello" }),
    );

    const result = await parseOpenCodeJsonSession(
      sessionPath,
      messageDir,
      partDir,
    );
    expect(result.canonical.messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseOpenCodeSqliteSession
// ---------------------------------------------------------------------------

describe("parseOpenCodeSqliteSession", () => {
  it("wraps parseOpenCodeMessages with sqlite-export format", () => {
    const session = buildSession();
    const messages = [
      userMsg("msg_1", "Hello", 1700000000000),
      assistantMsg("msg_2", "Hi!", 1700000001000),
    ];

    const result = parseOpenCodeSqliteSession(
      session,
      messages,
      "/path/to/opencode.db",
    );

    expect(result.canonical.sessionKey).toBe("opencode:ses_test123");
    expect(result.raw.sourceFiles[0].format).toBe("sqlite-export");
    expect(result.raw.sourceFiles[0].path).toBe("/path/to/opencode.db");
  });

  it("returns empty result for empty messages", () => {
    const session = buildSession();
    const result = parseOpenCodeSqliteSession(session, [], "/path/to/db");
    expect(result.canonical.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractProjectRef / extractProjectName
// ---------------------------------------------------------------------------

describe("extractProjectRef", () => {
  it("returns 16-char hash from projectID", () => {
    const ref = extractProjectRef("bdf1f79d9d912149e40897001619b15ac9ce58c9");
    expect(ref).toBeDefined();
    expect(ref).toHaveLength(16);
  });

  it("returns consistent hash for same input", () => {
    const ref1 = extractProjectRef("abc123");
    const ref2 = extractProjectRef("abc123");
    expect(ref1).toBe(ref2);
  });

  it("returns different hashes for different inputs", () => {
    const ref1 = extractProjectRef("project-a");
    const ref2 = extractProjectRef("project-b");
    expect(ref1).not.toBe(ref2);
  });

  it("returns null for null input", () => {
    expect(extractProjectRef(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractProjectRef(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractProjectRef("")).toBeNull();
  });
});

describe("extractProjectName", () => {
  it("returns directory path as project name", () => {
    expect(extractProjectName("/Users/test/workspace/project")).toBe(
      "/Users/test/workspace/project",
    );
  });

  it("returns null for null input", () => {
    expect(extractProjectName(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractProjectName(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractProjectName("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(extractProjectName(42 as unknown as string)).toBeNull();
  });
});
