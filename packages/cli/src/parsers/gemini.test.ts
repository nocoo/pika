/**
 * Tests for Gemini CLI parser.
 *
 * Covers: parseGeminiFile with various message types, tool calls,
 * token accumulation, incremental parsing, edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseGeminiFile,
  extractProjectRef,
  extractProjectName,
} from "./gemini";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GeminiSessionData {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: unknown[];
}

function buildSession(
  overrides: Partial<GeminiSessionData> = {},
): GeminiSessionData {
  return {
    sessionId: "test-session-id",
    projectHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc12345",
    startTime: "2025-01-15T10:00:00.000Z",
    lastUpdated: "2025-01-15T10:05:00.000Z",
    messages: [],
    ...overrides,
  };
}

function userMsg(text: string, ts: string): unknown {
  return {
    id: `user-${Date.now()}`,
    timestamp: ts,
    type: "user",
    content: [{ text }],
  };
}

function geminiMsg(
  content: string,
  ts: string,
  opts: {
    model?: string;
    tokens?: { input?: number; output?: number; cached?: number };
    toolCalls?: unknown[];
    thoughts?: unknown[];
  } = {},
): unknown {
  return {
    id: `gemini-${Date.now()}`,
    timestamp: ts,
    type: "gemini",
    content,
    model: opts.model ?? "gemini-3-flash-preview",
    tokens: opts.tokens
      ? {
          input: opts.tokens.input ?? 0,
          output: opts.tokens.output ?? 0,
          cached: opts.tokens.cached ?? 0,
          thoughts: 0,
          tool: 0,
          total:
            (opts.tokens.input ?? 0) +
            (opts.tokens.output ?? 0) +
            (opts.tokens.cached ?? 0),
        }
      : undefined,
    toolCalls: opts.toolCalls ?? [],
    thoughts: opts.thoughts ?? [],
  };
}

function infoMsg(text: string, ts: string): unknown {
  return {
    id: `info-${Date.now()}`,
    timestamp: ts,
    type: "info",
    content: text,
  };
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  result?: string,
  ts?: string,
): unknown {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    status: "success",
    args,
    result: result
      ? [
          {
            functionResponse: {
              id: `${name}-${Date.now()}`,
              name,
              response: { output: result },
            },
          },
        ]
      : [],
    id: `${name}-${Date.now()}`,
    timestamp: ts ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// parseGeminiFile — basic parsing
// ---------------------------------------------------------------------------

describe("parseGeminiFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-parser-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a simple user-gemini conversation", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello Gemini", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hello! How can I help?", "2025-01-15T10:00:01.000Z", {
          tokens: { input: 100, output: 20, cached: 0 },
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.sessionKey).toBe("gemini:test-session-id");
    expect(result.canonical.source).toBe("gemini-cli");
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[0].content).toBe("Hello Gemini");
    expect(result.canonical.messages[1].role).toBe("assistant");
    expect(result.canonical.messages[1].content).toBe("Hello! How can I help?");
  });

  it("accumulates token counts across gemini messages", async () => {
    const session = buildSession({
      messages: [
        userMsg("First question", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Answer 1", "2025-01-15T10:00:01.000Z", {
          tokens: { input: 100, output: 50, cached: 10 },
        }),
        userMsg("Follow up", "2025-01-15T10:00:02.000Z"),
        geminiMsg("Answer 2", "2025-01-15T10:00:03.000Z", {
          tokens: { input: 200, output: 80, cached: 30 },
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(300); // 100 + 200
    expect(result.canonical.totalOutputTokens).toBe(130); // 50 + 80
    expect(result.canonical.totalCachedTokens).toBe(40); // 10 + 30
  });

  it("extracts model from gemini messages", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z", {
          model: "gemini-3-flash-preview",
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.model).toBe("gemini-3-flash-preview");
    expect(result.canonical.messages[1].model).toBe("gemini-3-flash-preview");
  });

  it("uses last model as session model", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z", {
          model: "gemini-3-flash-preview",
        }),
        userMsg("More", "2025-01-15T10:00:02.000Z"),
        geminiMsg("Sure!", "2025-01-15T10:00:03.000Z", {
          model: "gemini-3-pro",
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.model).toBe("gemini-3-pro");
  });

  it("computes duration from startTime and lastUpdated", async () => {
    const session = buildSession({
      startTime: "2025-01-15T10:00:00.000Z",
      lastUpdated: "2025-01-15T10:05:30.000Z",
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:05:30.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.durationSeconds).toBe(330); // 5 min 30 sec
  });

  it("sets projectRef from projectHash", async () => {
    const session = buildSession({
      projectHash: "6591e26e96d0e7ef53237d37250b0fdeec5e19e0d4372c5515fe023d673b0f88",
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.projectRef).toBeDefined();
    expect(result.canonical.projectRef).toHaveLength(16);
    // projectName is null (Gemini only provides hash)
    expect(result.canonical.projectName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseGeminiFile — tool calls
// ---------------------------------------------------------------------------

describe("parseGeminiFile — tool calls", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-tools-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("extracts tool call invocations", async () => {
    const session = buildSession({
      messages: [
        userMsg("Read the file", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Let me read that.", "2025-01-15T10:00:01.000Z", {
          toolCalls: [
            toolCall(
              "read_file",
              { file_path: "package.json" },
              '{"name":"test"}',
              "2025-01-15T10:00:02.000Z",
            ),
          ],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // user + assistant + tool invocation + tool result
    expect(result.canonical.messages).toHaveLength(4);

    const toolInvocation = result.canonical.messages[2];
    expect(toolInvocation.role).toBe("tool");
    expect(toolInvocation.toolName).toBe("read_file");
    expect(toolInvocation.toolInput).toBe('{"file_path":"package.json"}');

    const toolResult = result.canonical.messages[3];
    expect(toolResult.role).toBe("tool");
    expect(toolResult.toolResult).toBe('{"name":"test"}');
  });

  it("handles tool calls without results", async () => {
    const session = buildSession({
      messages: [
        userMsg("Run command", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Running...", "2025-01-15T10:00:01.000Z", {
          toolCalls: [toolCall("shell", { command: "ls" })],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // user + assistant + tool invocation (no result since empty result array)
    expect(result.canonical.messages).toHaveLength(3);
    expect(result.canonical.messages[2].role).toBe("tool");
    expect(result.canonical.messages[2].toolName).toBe("shell");
  });

  it("handles multiple tool calls in one message", async () => {
    const session = buildSession({
      messages: [
        userMsg("Read two files", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Reading both.", "2025-01-15T10:00:01.000Z", {
          toolCalls: [
            toolCall("read_file", { file_path: "a.ts" }, "content-a"),
            toolCall("read_file", { file_path: "b.ts" }, "content-b"),
          ],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // user + assistant + 2*(invocation + result)
    expect(result.canonical.messages).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// parseGeminiFile — info messages
// ---------------------------------------------------------------------------

describe("parseGeminiFile — info messages", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-info-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("skips info messages", async () => {
    const session = buildSession({
      messages: [
        infoMsg("Login required...", "2025-01-15T10:00:00.000Z"),
        userMsg("Hello", "2025-01-15T10:00:01.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:02.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // Only user + gemini, info is skipped
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("returns empty result for session with only info messages", async () => {
    const session = buildSession({
      messages: [
        infoMsg("Login required...", "2025-01-15T10:00:00.000Z"),
        infoMsg("Authenticated.", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("gemini:unknown");
  });
});

// ---------------------------------------------------------------------------
// parseGeminiFile — incremental parsing
// ---------------------------------------------------------------------------

describe("parseGeminiFile — incremental parsing", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-incr-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses from startIndex", async () => {
    const session = buildSession({
      messages: [
        userMsg("First", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Reply 1", "2025-01-15T10:00:01.000Z", {
          tokens: { input: 100, output: 50 },
        }),
        userMsg("Second", "2025-01-15T10:00:02.000Z"),
        geminiMsg("Reply 2", "2025-01-15T10:00:03.000Z", {
          tokens: { input: 200, output: 80 },
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    // Start from index 2 — acts as a "has new data?" gate, but
    // parsing always builds the full canonical snapshot from index 0.
    const result = await parseGeminiFile(filePath, 2);
    expect(result.canonical.messages).toHaveLength(4);
    expect(result.canonical.messages[0].content).toBe("First");
    expect(result.canonical.messages[1].content).toBe("Reply 1");
    expect(result.canonical.messages[2].content).toBe("Second");
    expect(result.canonical.messages[3].content).toBe("Reply 2");
    // Tokens include ALL messages (full snapshot)
    expect(result.canonical.totalInputTokens).toBe(300);
    expect(result.canonical.totalOutputTokens).toBe(130);
  });

  it("returns empty result when startIndex exceeds message count", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath, 10);
    expect(result.canonical.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseGeminiFile — edge cases
// ---------------------------------------------------------------------------

describe("parseGeminiFile — edge cases", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-gemini-edge-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result for empty file", async () => {
    const filePath = join(tmpDir, "empty.json");
    await writeFile(filePath, "");

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.sessionKey).toBe("gemini:unknown");
  });

  it("returns empty result for non-existent file", async () => {
    const result = await parseGeminiFile(join(tmpDir, "nonexistent.json"));
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result for invalid JSON", async () => {
    const filePath = join(tmpDir, "invalid.json");
    await writeFile(filePath, "not json {{{");

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result for JSON with no messages", async () => {
    const filePath = join(tmpDir, "no-messages.json");
    await writeFile(filePath, JSON.stringify({ sessionId: "test" }));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result for JSON with empty messages array", async () => {
    const session = buildSession({ messages: [] });
    const filePath = join(tmpDir, "empty-messages.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("handles gemini message with no content", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        {
          id: "g1",
          timestamp: "2025-01-15T10:00:01.000Z",
          type: "gemini",
          content: "",
          model: "gemini-3-flash-preview",
          toolCalls: [
            toolCall("read_file", { file_path: "test.ts" }, "content"),
          ],
        },
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // user + tool invocation + tool result (no assistant message since empty content)
    expect(result.canonical.messages).toHaveLength(3);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[1].role).toBe("tool");
  });

  it("handles user message with multiple content parts", async () => {
    const session = buildSession({
      messages: [
        {
          id: "u1",
          timestamp: "2025-01-15T10:00:00.000Z",
          type: "user",
          content: [
            { text: "Part one." },
            { text: "Part two." },
          ],
        },
        geminiMsg("Got it.", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages[0].content).toBe("Part one.\nPart two.");
  });

  it("handles message with missing type field", async () => {
    const session = buildSession({
      messages: [
        { id: "bad1", content: "no type" },
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // Only user + gemini, bad message skipped
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles gemini message without tokens", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        {
          id: "g1",
          timestamp: "2025-01-15T10:00:01.000Z",
          type: "gemini",
          content: "Hi!",
          model: "gemini-3-flash-preview",
        },
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  it("handles user message with string content (non-array)", async () => {
    const session = buildSession({
      messages: [
        {
          id: "u1",
          timestamp: "2025-01-15T10:00:00.000Z",
          type: "user",
          content: "plain string instead of array",
        },
        geminiMsg("Got it.", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // User message with non-array content is skipped (empty text)
    expect(result.canonical.messages).toHaveLength(1);
    expect(result.canonical.messages[0].role).toBe("assistant");
  });

  it("handles user message with empty content array", async () => {
    const session = buildSession({
      messages: [
        {
          id: "u1",
          timestamp: "2025-01-15T10:00:00.000Z",
          type: "user",
          content: [],
        },
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // Empty content results in empty text, so user message is skipped
    expect(result.canonical.messages).toHaveLength(1);
  });

  it("handles messages missing timestamps (uses fallback)", async () => {
    const session = buildSession({
      messages: [
        {
          id: "u1",
          type: "user",
          content: [{ text: "Hello" }],
          // no timestamp
        },
        {
          id: "g1",
          type: "gemini",
          content: "Hi!",
          model: "gemini-3-flash",
          // no timestamp
        },
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
    // Timestamps should be ISO strings (fallback to now)
    expect(new Date(result.canonical.messages[0].timestamp).getTime()).toBeGreaterThan(0);
    expect(new Date(result.canonical.messages[1].timestamp).getTime()).toBeGreaterThan(0);
  });

  it("handles gemini message with model fallback to lastModel", async () => {
    const session = buildSession({
      messages: [
        userMsg("First", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Reply 1", "2025-01-15T10:00:01.000Z", {
          model: "gemini-3-flash-preview",
        }),
        userMsg("Second", "2025-01-15T10:00:02.000Z"),
        {
          id: "g2",
          timestamp: "2025-01-15T10:00:03.000Z",
          type: "gemini",
          content: "Reply 2",
          // no model field — should fall back to lastModel
        },
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // Last gemini message should have model from fallback
    const lastAssistant = result.canonical.messages.filter(
      (m) => m.role === "assistant",
    );
    expect(lastAssistant[1].model).toBe("gemini-3-flash-preview");
  });

  it("handles tool call with displayName fallback (no name)", async () => {
    const session = buildSession({
      messages: [
        userMsg("Do something", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Running tool.", "2025-01-15T10:00:01.000Z", {
          toolCalls: [
            {
              displayName: "ReadFile",
              // no name field
              status: "success",
              args: { file_path: "test.ts" },
              result: [],
              id: "tc-1",
              timestamp: "2025-01-15T10:00:02.000Z",
            },
          ],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    const toolMsg = result.canonical.messages.find((m) => m.role === "tool");
    expect(toolMsg?.toolName).toBe("ReadFile");
  });

  it("handles tool call with no timestamp (falls back to parent)", async () => {
    const session = buildSession({
      messages: [
        userMsg("Run", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Running.", "2025-01-15T10:00:01.000Z", {
          toolCalls: [
            {
              name: "shell",
              status: "success",
              args: { command: "ls" },
              result: [],
              id: "tc-1",
              // no timestamp
            },
          ],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    const toolMsg = result.canonical.messages.find((m) => m.role === "tool");
    expect(toolMsg?.timestamp).toBe("2025-01-15T10:00:01.000Z");
  });

  it("handles tool call with no args", async () => {
    const session = buildSession({
      messages: [
        userMsg("Do it", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Done.", "2025-01-15T10:00:01.000Z", {
          toolCalls: [
            {
              name: "noop",
              status: "success",
              result: [],
              id: "tc-1",
              timestamp: "2025-01-15T10:00:02.000Z",
              // no args
            },
          ],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    const toolMsg = result.canonical.messages.find((m) => m.role === "tool");
    expect(toolMsg?.toolInput).toBeUndefined();
  });

  it("handles session with missing sessionId, startTime, lastUpdated", async () => {
    const session = {
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z"),
      ],
    };

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.sessionKey).toBe("gemini:unknown");
    // startedAt and lastMessageAt should be ISO strings (fallbacks)
    expect(new Date(result.canonical.startedAt).getTime()).toBeGreaterThan(0);
  });

  it("returns empty result for non-object JSON (array)", async () => {
    const filePath = join(tmpDir, "array.json");
    await writeFile(filePath, "[1, 2, 3]");

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result for JSON null", async () => {
    const filePath = join(tmpDir, "null.json");
    await writeFile(filePath, "null");

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("handles tool call with name but no displayName", async () => {
    const session = buildSession({
      messages: [
        userMsg("Run", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Running.", "2025-01-15T10:00:01.000Z", {
          toolCalls: [
            {
              name: "read_file",
              status: "success",
              args: { path: "test.ts" },
              result: [
                {
                  functionResponse: {
                    id: "rf-1",
                    name: "read_file",
                    response: { output: "file contents here" },
                  },
                },
              ],
              id: "tc-1",
              timestamp: "2025-01-15T10:00:02.000Z",
            },
          ],
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    const toolMsgs = result.canonical.messages.filter(
      (m) => m.role === "tool",
    );
    // invocation + result
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0].toolName).toBe("read_file");
    expect(toolMsgs[1].toolName).toBe("read_file");
    expect(toolMsgs[1].toolResult).toBe("file contents here");
  });

  it("handles negative token values gracefully", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z", {
          tokens: { input: -5, output: -10, cached: -1 },
        }),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  it("produces raw session archive", async () => {
    const session = buildSession({
      messages: [
        userMsg("Hello", "2025-01-15T10:00:00.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:01.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    const rawContent = JSON.stringify(session);
    await writeFile(filePath, rawContent);

    const result = await parseGeminiFile(filePath);
    expect(result.raw.sessionKey).toBe("gemini:test-session-id");
    expect(result.raw.source).toBe("gemini-cli");
    expect(result.raw.sourceFiles).toHaveLength(1);
    expect(result.raw.sourceFiles[0].format).toBe("json");
    expect(result.raw.sourceFiles[0].content).toBe(rawContent);
  });

  it("handles unknown message type gracefully", async () => {
    const session = buildSession({
      messages: [
        { id: "u1", timestamp: "2025-01-15T10:00:00.000Z", type: "custom", content: "test" },
        userMsg("Hello", "2025-01-15T10:00:01.000Z"),
        geminiMsg("Hi!", "2025-01-15T10:00:02.000Z"),
      ],
    });

    const filePath = join(tmpDir, "session.json");
    await writeFile(filePath, JSON.stringify(session));

    const result = await parseGeminiFile(filePath);
    // custom type skipped, only user + gemini
    expect(result.canonical.messages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// extractProjectRef / extractProjectName
// ---------------------------------------------------------------------------

describe("extractProjectRef", () => {
  it("returns 16-char hash from projectHash", () => {
    const ref = extractProjectRef(
      "6591e26e96d0e7ef53237d37250b0fdeec5e19e0d4372c5515fe023d673b0f88",
    );
    expect(ref).toBeDefined();
    expect(ref).toHaveLength(16);
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
  it("always returns null (Gemini only provides hash)", () => {
    expect(extractProjectName("some-hash")).toBeNull();
    expect(extractProjectName(null)).toBeNull();
    expect(extractProjectName(undefined)).toBeNull();
  });
});
