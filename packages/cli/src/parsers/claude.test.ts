import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClaudeFile,
  extractProjectRef,
  extractProjectName,
} from "./claude.js";
import type { CanonicalMessage } from "@pika/core";

describe("parseClaudeFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pika-claude-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Helper: build JSONL lines ─────────────────────────────────

  function userLine(opts: {
    sessionId?: string;
    content?: string | unknown[];
    timestamp?: string;
  }): string {
    return JSON.stringify({
      type: "user",
      sessionId: opts.sessionId ?? "sess-1",
      timestamp: opts.timestamp ?? "2026-01-01T00:00:00Z",
      userType: "external",
      message: {
        role: "user",
        content: opts.content ?? "Hello",
      },
    });
  }

  function assistantLine(opts: {
    sessionId?: string;
    content?: unknown[];
    model?: string;
    usage?: Record<string, unknown>;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      type: "assistant",
      sessionId: opts.sessionId ?? "sess-1",
      timestamp: opts.timestamp ?? "2026-01-01T00:01:00Z",
      message: {
        role: "assistant",
        model: opts.model ?? "claude-sonnet-4-20250514",
        content: opts.content ?? [{ type: "text", text: "Hi there!" }],
        usage: opts.usage ?? {
          input_tokens: 100,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 50,
          output_tokens: 200,
        },
      },
    });
  }

  function toolResultLine(opts: {
    sessionId?: string;
    toolUseId?: string;
    content?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      type: "user",
      sessionId: opts.sessionId ?? "sess-1",
      timestamp: opts.timestamp ?? "2026-01-01T00:01:30Z",
      userType: "external",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: opts.toolUseId ?? "call_123",
            content: opts.content ?? "file contents here",
          },
        ],
      },
    });
  }

  async function writeJsonl(
    filename: string,
    lines: string[],
  ): Promise<string> {
    const filePath = join(tempDir, filename);
    await writeFile(filePath, lines.join("\n") + "\n");
    return filePath;
  }

  // ── Basic parsing ─────────────────────────────────────────────

  it("parses a simple user + assistant conversation", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ content: "What is 2+2?" }),
      assistantLine({
        content: [{ type: "text", text: "The answer is 4." }],
      }),
    ]);

    const result = await parseClaudeFile(filePath);

    expect(result.canonical.sessionKey).toBe("claude:sess-1");
    expect(result.canonical.source).toBe("claude-code");
    expect(result.canonical.messages).toHaveLength(2);

    const [userMsg, assistantMsg] = result.canonical.messages;
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("What is 2+2?");
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("The answer is 4.");
  });

  it("extracts token usage from assistant messages", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({}),
      assistantLine({
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 50,
          output_tokens: 200,
        },
      }),
    ]);

    const result = await parseClaudeFile(filePath);
    const msg = result.canonical.messages[1];
    expect(msg.inputTokens).toBe(100);
    expect(msg.outputTokens).toBe(200);
    expect(msg.cachedTokens).toBe(50);

    // Session totals
    expect(result.canonical.totalInputTokens).toBe(100);
    expect(result.canonical.totalOutputTokens).toBe(200);
    expect(result.canonical.totalCachedTokens).toBe(50);
  });

  it("extracts model from assistant message", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({}),
      assistantLine({ model: "claude-sonnet-4-20250514" }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.model).toBe("claude-sonnet-4-20250514");
    expect(result.canonical.messages[1].model).toBe("claude-sonnet-4-20250514");
  });

  // ── Tool calls ────────────────────────────────────────────────

  it("extracts tool_use blocks as tool messages", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ content: "Read the file" }),
      assistantLine({
        content: [
          { type: "text", text: "Let me read that file." },
          {
            type: "tool_use",
            id: "call_123",
            name: "Read",
            input: { file_path: "/src/index.ts" },
          },
        ],
      }),
      toolResultLine({ toolUseId: "call_123", content: "export const x = 1;" }),
    ]);

    const result = await parseClaudeFile(filePath);
    // user + assistant text + tool_use + tool_result = 4 messages
    expect(result.canonical.messages).toHaveLength(4);

    const toolUse = result.canonical.messages[2];
    expect(toolUse.role).toBe("tool");
    expect(toolUse.toolName).toBe("Read");
    expect(toolUse.toolInput).toContain("/src/index.ts");

    const toolResult = result.canonical.messages[3];
    expect(toolResult.role).toBe("tool");
    expect(toolResult.content).toBe("export const x = 1;");
  });

  // ── Content block types ───────────────────────────────────────

  it("handles thinking blocks (ignores them for content)", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({}),
      assistantLine({
        content: [
          { type: "thinking", thinking: "Let me think..." },
          { type: "text", text: "Here is my answer." },
        ],
      }),
    ]);

    const result = await parseClaudeFile(filePath);
    // user + assistant text (thinking excluded)
    const msgs = result.canonical.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe("Here is my answer.");
  });

  it("handles user message with string content", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ content: "Simple string content" }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.messages[0].content).toBe("Simple string content");
  });

  it("handles user message with array content blocks", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({
        content: [
          { type: "text", text: "Here is a question" },
          { type: "text", text: " with multiple parts" },
        ],
      }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.messages[0].content).toBe(
      "Here is a question\n with multiple parts",
    );
  });

  // ── Session metadata ──────────────────────────────────────────

  it("computes duration from first to last timestamp", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ timestamp: "2026-01-01T00:00:00Z" }),
      assistantLine({ timestamp: "2026-01-01T00:05:30Z" }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.canonical.lastMessageAt).toBe("2026-01-01T00:05:30Z");
    expect(result.canonical.durationSeconds).toBe(330); // 5m30s
  });

  it("uses last seen model as session model", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({}),
      assistantLine({ model: "claude-3-haiku", timestamp: "2026-01-01T00:00:00Z" }),
      userLine({ timestamp: "2026-01-01T00:01:00Z" }),
      assistantLine({ model: "claude-sonnet-4-20250514", timestamp: "2026-01-01T00:02:00Z" }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.model).toBe("claude-sonnet-4-20250514");
  });

  // ── Multiple sessions in one file ─────────────────────────────

  it("groups messages by sessionId and returns first session", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ sessionId: "sess-A", content: "Hello A", timestamp: "2026-01-01T00:00:00Z" }),
      assistantLine({ sessionId: "sess-A", timestamp: "2026-01-01T00:01:00Z" }),
      userLine({ sessionId: "sess-B", content: "Hello B", timestamp: "2026-01-01T00:02:00Z" }),
      assistantLine({ sessionId: "sess-B", timestamp: "2026-01-01T00:03:00Z" }),
    ]);

    const results = await parseClaudeFile(filePath);
    // Should produce results for both sessions
    expect(results.canonical.sessionKey).toBe("claude:sess-A");
  });

  it("returns all sessions via parseClaudeFileMulti", async () => {
    // This test uses the multi-session variant
    const { parseClaudeFileMulti } = await import("./claude.js");
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ sessionId: "sess-A", content: "Hello A", timestamp: "2026-01-01T00:00:00Z" }),
      assistantLine({ sessionId: "sess-A", timestamp: "2026-01-01T00:01:00Z" }),
      userLine({ sessionId: "sess-B", content: "Hello B", timestamp: "2026-01-01T00:02:00Z" }),
      assistantLine({ sessionId: "sess-B", timestamp: "2026-01-01T00:03:00Z" }),
    ]);

    const results = await parseClaudeFileMulti(filePath);
    expect(results).toHaveLength(2);
    expect(results[0].canonical.sessionKey).toBe("claude:sess-A");
    expect(results[1].canonical.sessionKey).toBe("claude:sess-B");
  });

  // ── Raw output ────────────────────────────────────────────────

  it("produces raw session archive with original JSONL content", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({}),
      assistantLine({}),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.raw.sessionKey).toBe("claude:sess-1");
    expect(result.raw.source).toBe("claude-code");
    expect(result.raw.sourceFiles).toHaveLength(1);
    expect(result.raw.sourceFiles[0].format).toBe("jsonl");
    expect(result.raw.sourceFiles[0].path).toBe(filePath);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it("returns empty result for missing file", async () => {
    const result = await parseClaudeFile(join(tempDir, "nonexistent.jsonl"));
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("returns empty result for empty file", async () => {
    const filePath = await writeJsonl("empty.jsonl", []);
    const result = await parseClaudeFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("skips malformed JSON lines", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({ content: "Valid line" }),
      "{{{malformed",
      assistantLine({ content: [{ type: "text", text: "Also valid" }] }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("skips lines without sessionId", async () => {
    const filePath = join(tempDir, "test.jsonl");
    const lineWithoutSessionId = JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "No session" },
    });
    await writeFile(filePath, lineWithoutSessionId + "\n");

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("handles zero token usage gracefully", async () => {
    const filePath = await writeJsonl("test.jsonl", [
      userLine({}),
      assistantLine({
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ]);

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  it("handles missing usage field", async () => {
    const filePath = join(tempDir, "test.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "sess-1",
      timestamp: "2026-01-01T00:01:00Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "No usage" }],
      },
    });
    await writeFile(
      filePath,
      userLine({}) + "\n" + line + "\n",
    );

    const result = await parseClaudeFile(filePath);
    expect(result.canonical.messages[1].inputTokens).toBeUndefined();
  });

  it("skips queue-operation lines (non-message types)", async () => {
    const queueOp = JSON.stringify({
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-01-01T00:00:00Z",
      sessionId: "sess-1",
      content: "User prompt text",
    });
    const filePath = await writeJsonl("test.jsonl", [
      queueOp,
      userLine({}),
      assistantLine({}),
    ]);

    const result = await parseClaudeFile(filePath);
    // queue-operation is not a message type — should be skipped
    expect(result.canonical.messages).toHaveLength(2);
  });

  // ── Incremental parsing (byte offset) ─────────────────────────

  it("resumes from byte offset", async () => {
    const line1 = userLine({
      content: "First message",
      timestamp: "2026-01-01T00:00:00Z",
    });
    const line2 = assistantLine({ timestamp: "2026-01-01T00:01:00Z" });
    const filePath = await writeJsonl("test.jsonl", [line1, line2]);

    // First parse: get full result
    const full = await parseClaudeFile(filePath);
    expect(full.canonical.messages).toHaveLength(2);

    // Offset after first line (line + newline)
    const offset = Buffer.byteLength(line1 + "\n");

    // Resume from offset: should only get the second line
    const resumed = await parseClaudeFile(filePath, offset);
    expect(resumed.canonical.messages).toHaveLength(1);
    expect(resumed.canonical.messages[0].role).toBe("assistant");
  });
});

// ── extractProjectRef ─────────────────────────────────────────

describe("extractProjectRef", () => {
  it("extracts and hashes project directory from Claude path", () => {
    const ref = extractProjectRef(
      "/Users/nocoo/.claude/projects/-Users-nocoo-workspace-personal-pika/abc123.jsonl",
    );
    expect(ref).toBeTruthy();
    expect(typeof ref).toBe("string");
    expect(ref!.length).toBe(16); // SHA-256 truncated to 16 hex chars
  });

  it("returns null when projects dir not found in path", () => {
    expect(extractProjectRef("/some/random/path.jsonl")).toBeNull();
  });

  it("returns null for path ending right at projects/", () => {
    expect(extractProjectRef("/Users/nocoo/.claude/projects/")).toBeNull();
  });

  it("returns consistent hash for same input", () => {
    const path =
      "/Users/nocoo/.claude/projects/-Users-nocoo-workspace/sess.jsonl";
    expect(extractProjectRef(path)).toBe(extractProjectRef(path));
  });
});

// ── extractProjectName ────────────────────────────────────────

describe("extractProjectName", () => {
  it("converts Claude path encoding to human-readable name", () => {
    const name = extractProjectName(
      "/Users/nocoo/.claude/projects/-Users-nocoo-workspace-personal-pika/abc123.jsonl",
    );
    expect(name).toBe("/Users/nocoo/workspace/personal/pika");
  });

  it("returns null when projects dir not found", () => {
    expect(extractProjectName("/some/random/path.jsonl")).toBeNull();
  });
});
