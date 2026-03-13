import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVscodeCopilotFile,
  parseCrdtOps,
  replayCrdt,
  extractMessages,
  extractWorkspaceFolder,
  extractProjectRef,
  extractProjectName,
} from "./vscode-copilot";

describe("parseVscodeCopilotFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pika-copilot-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Helpers: build CRDT operations ────────────────────────────

  function snapshotOp(opts?: {
    sessionId?: string;
    creationDate?: string;
    requests?: Record<string, unknown>[];
    customTitle?: string;
    selectedModel?: string;
  }): string {
    const v: Record<string, unknown> = {
      sessionId: opts?.sessionId ?? "test-session-001",
      creationDate: opts?.creationDate ?? "2026-01-01T00:00:00.000Z",
      requests: opts?.requests ?? [],
    };
    if (opts?.customTitle !== undefined) {
      v.customTitle = opts.customTitle;
    }
    if (opts?.selectedModel !== undefined) {
      v.inputState = { selectedModel: opts.selectedModel };
    }
    return JSON.stringify({ kind: 0, v });
  }

  function appendRequestOp(req: Record<string, unknown>): string {
    return JSON.stringify({
      kind: 2,
      k: ["requests"],
      v: req,
    });
  }

  function appendResponseChunkOp(
    requestIndex: number,
    chunk: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      kind: 2,
      k: ["requests", requestIndex, "response"],
      v: chunk,
    });
  }

  function setResultOp(
    requestIndex: number,
    result: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      kind: 1,
      k: ["requests", requestIndex, "result"],
      v: result,
    });
  }

  function setModelStateOp(
    requestIndex: number,
    modelState: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      kind: 1,
      k: ["requests", requestIndex, "modelState"],
      v: modelState,
    });
  }

  function setTitleOp(title: string): string {
    return JSON.stringify({
      kind: 1,
      k: ["customTitle"],
      v: title,
    });
  }

  function setSelectedModelOp(model: string): string {
    return JSON.stringify({
      kind: 1,
      k: ["inputState", "selectedModel"],
      v: model,
    });
  }

  function makeRequest(opts?: {
    requestId?: string;
    timestamp?: number;
    modelId?: string;
    text?: string;
    /** Set to true to omit modelId entirely */
    noModelId?: boolean;
  }): Record<string, unknown> {
    const req: Record<string, unknown> = {
      requestId: opts?.requestId ?? "req-001",
      timestamp: opts?.timestamp ?? 1767225600000, // 2026-01-01T00:00:00Z
      message: { text: opts?.text ?? "Hello Copilot" },
      response: [],
    };
    if (!opts?.noModelId) {
      req.modelId = opts?.modelId ?? "gpt-4o";
    }
    return req;
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
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest({ text: "What is 2+2?" })),
      appendResponseChunkOp(0, { value: "The answer is 4." }),
      setResultOp(0, {
        metadata: { promptTokens: 100, outputTokens: 20 },
      }),
      setModelStateOp(0, { value: 1, completedAt: "2026-01-01T00:01:00.000Z" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);

    expect(result.canonical.sessionKey).toBe("copilot:test-session-001");
    expect(result.canonical.source).toBe("vscode-copilot");
    expect(result.canonical.messages).toHaveLength(2);

    const [userMsg, assistantMsg] = result.canonical.messages;
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("What is 2+2?");
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("The answer is 4.");
  });

  it("extracts session ID from snapshot", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({ sessionId: "my-unique-session" }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.sessionKey).toBe("copilot:my-unique-session");
  });

  // ── Token usage ───────────────────────────────────────────────

  it("extracts token usage from result metadata", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest({ requestId: "r1" })),
      appendResponseChunkOp(0, { value: "Response 1" }),
      setResultOp(0, {
        metadata: { promptTokens: 500, outputTokens: 100 },
      }),
      appendRequestOp(
        makeRequest({
          requestId: "r2",
          text: "Follow up",
          timestamp: 1767225660000,
        }),
      ),
      appendResponseChunkOp(1, { value: "Response 2" }),
      setResultOp(1, {
        metadata: { promptTokens: 800, outputTokens: 200 },
      }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // Summed across all requests
    expect(result.canonical.totalInputTokens).toBe(1300);
    expect(result.canonical.totalOutputTokens).toBe(300);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  it("handles missing token metadata gracefully", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "No tokens" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
  });

  // ── Model extraction ──────────────────────────────────────────

  it("extracts model from request's modelId", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest({ modelId: "claude-sonnet-4" })),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.model).toBe("claude-sonnet-4");
    const assistantMsg = result.canonical.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMsg?.model).toBe("claude-sonnet-4");
  });

  it("uses selectedModel from snapshot when request has no modelId", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({ selectedModel: "gpt-4o" }),
      appendRequestOp({
        requestId: "r1",
        timestamp: 1767225600000,
        message: { text: "Hello" },
        response: [],
      }),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.model).toBe("gpt-4o");
  });

  it("uses selectedModel set via kind=1 operation", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      setSelectedModelOp("o3-pro"),
      appendRequestOp(makeRequest({ noModelId: true })),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.model).toBe("o3-pro");
  });

  // ── Title extraction ──────────────────────────────────────────

  it("extracts title from snapshot", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({ customTitle: "My Project Discussion" }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.title).toBe("My Project Discussion");
  });

  it("extracts title set via kind=1 operation", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
      setTitleOp("Updated Title"),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.title).toBe("Updated Title");
  });

  // ── Tool calls ────────────────────────────────────────────────

  it("extracts tool invocations from response chunks", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest({ text: "Read the file" })),
      appendResponseChunkOp(0, { value: "Let me check... " }),
      appendResponseChunkOp(0, {
        kind: "toolInvocationSerialized",
        toolId: "vscode.readFile",
        invocationMessage: '{"path":"src/app.ts"}',
        toolCallId: "tc-001",
        result: "export const app = () => {}",
      }),
      appendResponseChunkOp(0, { value: "Here's the file content." }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // user + assistant(text before tool) + tool_call + tool_result + assistant(text after tool)
    expect(result.canonical.messages).toHaveLength(5);

    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[1].role).toBe("assistant");
    expect(result.canonical.messages[1].content).toBe("Let me check... ");

    expect(result.canonical.messages[2].role).toBe("tool");
    expect(result.canonical.messages[2].toolName).toBe("vscode.readFile");
    expect(result.canonical.messages[2].toolInput).toBe('{"path":"src/app.ts"}');

    expect(result.canonical.messages[3].role).toBe("tool");
    expect(result.canonical.messages[3].toolResult).toBe(
      "export const app = () => {}",
    );

    expect(result.canonical.messages[4].role).toBe("assistant");
    expect(result.canonical.messages[4].content).toBe("Here's the file content.");
  });

  it("handles tool calls without results", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, {
        kind: "toolInvocationSerialized",
        toolId: "vscode.runCommand",
        invocationMessage: '{"command":"build"}',
        toolCallId: "tc-002",
        // No result field
      }),
      appendResponseChunkOp(0, { value: "Done" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // user + tool_call (no result) + assistant
    expect(result.canonical.messages).toHaveLength(3);
    expect(result.canonical.messages[1].role).toBe("tool");
    expect(result.canonical.messages[1].toolName).toBe("vscode.runCommand");
  });

  it("skips thinking chunks", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { kind: "thinking", value: "Let me think..." }),
      appendResponseChunkOp(0, { value: "Here's my answer." }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // user + assistant (thinking skipped)
    expect(result.canonical.messages).toHaveLength(2);
    const assistantMsg = result.canonical.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMsg?.content).toBe("Here's my answer.");
  });

  // ── Multi-turn conversations ──────────────────────────────────

  it("parses a multi-turn conversation", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(
        makeRequest({
          requestId: "r1",
          text: "What is TypeScript?",
          timestamp: 1767225600000,
        }),
      ),
      appendResponseChunkOp(0, {
        value: "TypeScript is a typed superset of JavaScript.",
      }),
      setResultOp(0, { metadata: { promptTokens: 100, outputTokens: 20 } }),
      setModelStateOp(0, { value: 1, completedAt: "2026-01-01T00:00:30.000Z" }),
      appendRequestOp(
        makeRequest({
          requestId: "r2",
          text: "Give me an example",
          timestamp: 1767225660000,
        }),
      ),
      appendResponseChunkOp(1, {
        value: "const x: number = 42;",
      }),
      setResultOp(1, { metadata: { promptTokens: 200, outputTokens: 15 } }),
      setModelStateOp(1, { value: 1, completedAt: "2026-01-01T00:02:00.000Z" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(4);
    expect(result.canonical.messages[0].content).toBe("What is TypeScript?");
    expect(result.canonical.messages[1].content).toBe(
      "TypeScript is a typed superset of JavaScript.",
    );
    expect(result.canonical.messages[2].content).toBe("Give me an example");
    expect(result.canonical.messages[3].content).toBe("const x: number = 42;");

    // Duration from creationDate to last completedAt
    expect(result.canonical.lastMessageAt).toBe("2026-01-01T00:02:00.000Z");
    expect(result.canonical.durationSeconds).toBe(120);
  });

  // ── Session metadata ──────────────────────────────────────────

  it("computes duration from creation date to last completedAt", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({ creationDate: "2026-01-01T00:00:00.000Z" }),
      appendRequestOp(makeRequest({ timestamp: 1767225600000 })),
      appendResponseChunkOp(0, { value: "Hi" }),
      setModelStateOp(0, { value: 1, completedAt: "2026-01-01T00:05:30.000Z" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.canonical.durationSeconds).toBe(330); // 5m30s
  });

  it("falls back to first request timestamp when creationDate is missing", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      // Snapshot without creationDate
      JSON.stringify({ kind: 0, v: { sessionId: "no-date-session", requests: [] } }),
      appendRequestOp(makeRequest({ timestamp: 1767225600000 })),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  // ── Snapshot with pre-existing requests ───────────────────────

  it("handles snapshot with pre-existing requests", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({
        requests: [
          {
            requestId: "r1",
            timestamp: 1767225600000,
            modelId: "gpt-4o",
            message: { text: "First question" },
            response: [{ value: "First answer" }],
            result: { metadata: { promptTokens: 50, outputTokens: 10 } },
            modelState: { value: 1, completedAt: "2026-01-01T00:00:30.000Z" },
          },
        ],
      }),
      appendRequestOp(
        makeRequest({
          requestId: "r2",
          text: "Second question",
          timestamp: 1767225660000,
        }),
      ),
      appendResponseChunkOp(1, { value: "Second answer" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(4);
    expect(result.canonical.messages[0].content).toBe("First question");
    expect(result.canonical.messages[1].content).toBe("First answer");
    expect(result.canonical.messages[2].content).toBe("Second question");
    expect(result.canonical.messages[3].content).toBe("Second answer");
    // Token usage includes both requests
    expect(result.canonical.totalInputTokens).toBe(50);
    expect(result.canonical.totalOutputTokens).toBe(10);
  });

  // ── Incremental parsing (processed request IDs) ───────────────

  it("skips previously processed requests when processedRequestIds provided", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(
        makeRequest({ requestId: "r1", text: "First question" }),
      ),
      appendResponseChunkOp(0, { value: "First answer" }),
      setResultOp(0, { metadata: { promptTokens: 100, outputTokens: 20 } }),
      appendRequestOp(
        makeRequest({
          requestId: "r2",
          text: "Second question",
          timestamp: 1767225660000,
        }),
      ),
      appendResponseChunkOp(1, { value: "Second answer" }),
      setResultOp(1, { metadata: { promptTokens: 200, outputTokens: 30 } }),
    ]);

    // Parse with r1 already processed
    const result = await parseVscodeCopilotFile(
      filePath,
      0,
      ["r1"],
      null,
    );

    // Only r2 messages should be extracted
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].content).toBe("Second question");
    expect(result.canonical.messages[1].content).toBe("Second answer");
    expect(result.canonical.totalInputTokens).toBe(200);
    expect(result.canonical.totalOutputTokens).toBe(30);
  });

  it("returns empty result when all requests are already processed", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest({ requestId: "r1" })),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(
      filePath,
      0,
      ["r1"],
      null,
    );

    expect(result.canonical.messages).toHaveLength(0);
  });

  // ── Raw output ────────────────────────────────────────────────

  it("produces raw session archive with JSONL content", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.raw.sessionKey).toBe("copilot:test-session-001");
    expect(result.raw.source).toBe("vscode-copilot");
    expect(result.raw.sourceFiles).toHaveLength(1);
    expect(result.raw.sourceFiles[0].format).toBe("jsonl");
    expect(result.raw.sourceFiles[0].path).toBe(filePath);
    expect(result.raw.sourceFiles[0].content).toContain("test-session-001");
  });

  // ── Edge cases ────────────────────────────────────────────────

  it("returns empty result for missing file", async () => {
    const result = await parseVscodeCopilotFile(
      join(tempDir, "nonexistent.jsonl"),
    );
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.source).toBe("vscode-copilot");
    expect(result.canonical.sessionKey).toBe("copilot:unknown");
  });

  it("returns empty result for empty file", async () => {
    const filePath = await writeJsonl("empty.jsonl", []);
    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("skips malformed JSON lines", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      "{{{malformed json",
      appendRequestOp(makeRequest({ text: "Valid message" })),
      appendResponseChunkOp(0, { value: "Valid response" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles snapshot without sessionId", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      JSON.stringify({ kind: 0, v: { requests: [] } }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.sessionKey).toBe("copilot:unknown");
  });

  it("handles snapshot with non-object v", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      JSON.stringify({ kind: 0, v: "not an object" }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("returns empty result when offset is at or past file size", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath, 999999);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("handles requests without response chunks", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest({ text: "Pending question" })),
      // No response chunks appended yet
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // Only user message, no assistant message
    expect(result.canonical.messages).toHaveLength(1);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[0].content).toBe("Pending question");
  });

  it("handles requests with empty user message", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp({
        requestId: "r1",
        timestamp: 1767225600000,
        message: { text: "" },
        response: [],
      }),
      appendResponseChunkOp(0, { value: "I need a question." }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // Empty user text is skipped, only assistant message
    expect(result.canonical.messages).toHaveLength(1);
    expect(result.canonical.messages[0].role).toBe("assistant");
  });

  it("handles multiple text chunks concatenated into one message", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hello " }),
      appendResponseChunkOp(0, { value: "world" }),
      appendResponseChunkOp(0, { value: "!" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    const assistantMsg = result.canonical.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMsg?.content).toBe("Hello world!");
  });

  it("handles response chunk with null/undefined value", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: null }),
      appendResponseChunkOp(0, { value: "Actual content" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    const assistantMsg = result.canonical.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMsg?.content).toBe("Actual content");
  });

  it("handles set operation with out-of-bounds request index", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
      // Set result on non-existent request index 5
      setResultOp(5, { metadata: { promptTokens: 100, outputTokens: 20 } }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // Should not crash, tokens stay at 0
    expect(result.canonical.totalInputTokens).toBe(0);
  });

  it("handles append to non-existent request response", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      // Append response to non-existent request index 5
      appendResponseChunkOp(5, { value: "orphaned" }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Valid" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles set operation with empty key path", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
      // Set with empty key path
      JSON.stringify({ kind: 1, k: [], v: "ignored" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles append operation with empty key path", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
      // Append with empty key path
      JSON.stringify({ kind: 2, k: [], v: "ignored" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles lines without kind field (skipped)", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      JSON.stringify({ noKind: true }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles tool invocation without toolId or invocationMessage", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, {
        kind: "toolInvocationSerialized",
        // Missing toolId and invocationMessage
        toolCallId: "tc-001",
      }),
      appendResponseChunkOp(0, { value: "Done" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    const toolMsg = result.canonical.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolName).toBeUndefined();
    expect(toolMsg!.toolInput).toBeUndefined();
  });

  it("handles tool invocation with empty string result", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, {
        kind: "toolInvocationSerialized",
        toolId: "myTool",
        invocationMessage: "input",
        result: "", // empty result
      }),
      appendResponseChunkOp(0, { value: "Done" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // tool_call (no tool_result since empty) + assistant
    const toolMsgs = result.canonical.messages.filter(
      (m) => m.role === "tool",
    );
    expect(toolMsgs).toHaveLength(1); // only invocation, no result
  });

  it("handles negative request index in set operation", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
      setResultOp(-1, { metadata: { promptTokens: 100, outputTokens: 20 } }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
  });

  it("handles snapshot with no v field", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      JSON.stringify({ kind: 0 }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles append to requests with non-object value", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      // Append a primitive to requests (should be ignored)
      JSON.stringify({ kind: 2, k: ["requests"], v: "not an object" }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("falls back to startedAt for lastMessageAt when request has no timestamp or completedAt", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({ creationDate: "2026-01-01T00:00:00.000Z" }),
      // Request without timestamp or modelState.completedAt
      appendRequestOp({
        requestId: "r1",
        message: { text: "Hi" },
        response: [],
      }),
      appendResponseChunkOp(0, { value: "Hello" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    // lastMessageAt should fall back to startedAt
    expect(result.canonical.lastMessageAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.canonical.durationSeconds).toBe(0);
  });

  it("uses current time as startedAt when no creationDate and no request timestamps", async () => {
    const before = new Date().toISOString();
    const filePath = await writeJsonl("session.jsonl", [
      // Snapshot without creationDate
      JSON.stringify({ kind: 0, v: { sessionId: "no-dates", requests: [] } }),
      // Request without timestamp
      appendRequestOp({
        requestId: "r1",
        message: { text: "Timeless" },
        response: [],
      }),
      appendResponseChunkOp(0, { value: "Response" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    const after = new Date().toISOString();
    // startedAt should be a current timestamp (between before and after)
    expect(result.canonical.startedAt >= before).toBe(true);
    expect(result.canonical.startedAt <= after).toBe(true);
  });

  it("returns empty result when file cannot be read", async () => {
    // Create a directory with the same name — reading it as a file should fail
    const dirPath = join(tempDir, "fake-file.jsonl");
    await mkdir(dirPath);

    const result = await parseVscodeCopilotFile(dirPath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("handles append array value to requests (should be ignored)", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp(),
      // Append an array to requests (should be ignored — arrays not valid)
      JSON.stringify({ kind: 2, k: ["requests"], v: [1, 2, 3] }),
      appendRequestOp(makeRequest()),
      appendResponseChunkOp(0, { value: "Hi" }),
    ]);

    const result = await parseVscodeCopilotFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  // ── Complex multi-turn with tool calls ────────────────────────

  it("parses a full multi-turn conversation with tool calls and tokens", async () => {
    const filePath = await writeJsonl("session.jsonl", [
      snapshotOp({
        sessionId: "full-test",
        creationDate: "2026-01-01T00:00:00.000Z",
        selectedModel: "gpt-4o",
      }),
      // Turn 1: user asks, assistant responds with text
      appendRequestOp(
        makeRequest({
          requestId: "r1",
          text: "Read my config file",
          modelId: "gpt-4o",
          timestamp: 1767225600000,
        }),
      ),
      appendResponseChunkOp(0, { value: "I'll read your config file. " }),
      appendResponseChunkOp(0, {
        kind: "toolInvocationSerialized",
        toolId: "vscode.readFile",
        invocationMessage: '{"path":"config.json"}',
        toolCallId: "tc-001",
        result: '{"port": 3000}',
      }),
      appendResponseChunkOp(0, {
        value: "Your config has port 3000.",
      }),
      setResultOp(0, {
        metadata: { promptTokens: 500, outputTokens: 100 },
      }),
      setModelStateOp(0, { value: 1, completedAt: "2026-01-01T00:00:30.000Z" }),

      // Turn 2: follow-up
      appendRequestOp(
        makeRequest({
          requestId: "r2",
          text: "Change it to 8080",
          modelId: "gpt-4o",
          timestamp: 1767225660000,
        }),
      ),
      appendResponseChunkOp(1, { kind: "thinking", value: "Reasoning..." }),
      appendResponseChunkOp(1, {
        kind: "toolInvocationSerialized",
        toolId: "vscode.editFile",
        invocationMessage: '{"path":"config.json","content":"{\\"port\\": 8080}"}',
        toolCallId: "tc-002",
        result: "File updated",
      }),
      appendResponseChunkOp(1, { value: "Done! Port changed to 8080." }),
      setResultOp(1, {
        metadata: { promptTokens: 800, outputTokens: 50 },
      }),
      setModelStateOp(1, { value: 1, completedAt: "2026-01-01T00:02:00.000Z" }),

      // Custom title set
      setTitleOp("Config Port Change"),
    ]);

    const result = await parseVscodeCopilotFile(filePath);

    expect(result.canonical.sessionKey).toBe("copilot:full-test");
    expect(result.canonical.source).toBe("vscode-copilot");
    expect(result.canonical.model).toBe("gpt-4o");
    expect(result.canonical.title).toBe("Config Port Change");
    expect(result.canonical.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.canonical.lastMessageAt).toBe("2026-01-01T00:02:00.000Z");
    expect(result.canonical.durationSeconds).toBe(120);

    // Turn 1: user + text + tool_call + tool_result + text = 5
    // Turn 2: user + tool_call + tool_result + text = 4 (thinking skipped)
    // Total: 9
    expect(result.canonical.messages).toHaveLength(9);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[0].content).toBe("Read my config file");
    expect(result.canonical.messages[1].role).toBe("assistant");
    expect(result.canonical.messages[2].role).toBe("tool");
    expect(result.canonical.messages[2].toolName).toBe("vscode.readFile");
    expect(result.canonical.messages[3].role).toBe("tool");
    expect(result.canonical.messages[3].toolResult).toBe('{"port": 3000}');

    // Token totals
    expect(result.canonical.totalInputTokens).toBe(1300);
    expect(result.canonical.totalOutputTokens).toBe(150);
  });
});

// ── parseCrdtOps ────────────────────────────────────────────────

describe("parseCrdtOps", () => {
  it("parses valid CRDT operations from content string", () => {
    const content = [
      JSON.stringify({ kind: 0, v: { sessionId: "s1" } }),
      JSON.stringify({ kind: 1, k: ["customTitle"], v: "Test" }),
      JSON.stringify({ kind: 2, k: ["requests"], v: {} }),
    ].join("\n");

    const ops = parseCrdtOps(content);
    expect(ops).toHaveLength(3);
    expect(ops[0].kind).toBe(0);
    expect(ops[1].kind).toBe(1);
    expect(ops[2].kind).toBe(2);
  });

  it("skips empty lines", () => {
    const content = [
      JSON.stringify({ kind: 0, v: {} }),
      "",
      "  ",
      JSON.stringify({ kind: 1, k: ["x"], v: 1 }),
    ].join("\n");

    const ops = parseCrdtOps(content);
    expect(ops).toHaveLength(2);
  });

  it("skips malformed JSON lines", () => {
    const content = [
      JSON.stringify({ kind: 0, v: {} }),
      "{{{bad json",
      JSON.stringify({ kind: 1, k: ["x"], v: 1 }),
    ].join("\n");

    const ops = parseCrdtOps(content);
    expect(ops).toHaveLength(2);
  });

  it("skips objects without kind field", () => {
    const content = [
      JSON.stringify({ kind: 0, v: {} }),
      JSON.stringify({ noKind: true }),
      JSON.stringify({ kind: 2, k: ["x"], v: 1 }),
    ].join("\n");

    const ops = parseCrdtOps(content);
    expect(ops).toHaveLength(2);
  });

  it("returns empty array for empty content", () => {
    expect(parseCrdtOps("")).toHaveLength(0);
    expect(parseCrdtOps("  \n  ")).toHaveLength(0);
  });
});

// ── replayCrdt ──────────────────────────────────────────────────

describe("replayCrdt", () => {
  it("replays snapshot + set + append operations", () => {
    const ops = [
      { kind: 0, v: { sessionId: "s1", creationDate: "2026-01-01T00:00:00Z", requests: [] } },
      { kind: 2, k: ["requests"], v: { requestId: "r1", message: { text: "Hi" }, response: [] } },
      { kind: 2, k: ["requests", 0, "response"], v: { value: "Hello!" } },
      { kind: 1, k: ["customTitle"], v: "My Chat" },
    ];

    const state = replayCrdt(ops);
    expect(state.sessionId).toBe("s1");
    expect(state.customTitle).toBe("My Chat");
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0].response).toHaveLength(1);
  });

  it("returns default state for empty ops", () => {
    const state = replayCrdt([]);
    expect(state.sessionId).toBeNull();
    expect(state.requests).toHaveLength(0);
  });

  it("ignores unknown kind values", () => {
    const ops = [
      { kind: 0, v: { sessionId: "s1", requests: [] } },
      { kind: 99, k: ["foo"], v: "bar" }, // unknown kind
    ];

    const state = replayCrdt(ops);
    expect(state.sessionId).toBe("s1");
  });
});

// ── extractMessages ─────────────────────────────────────────────

describe("extractMessages", () => {
  it("extracts all messages when no processed IDs", () => {
    const state = replayCrdt([
      {
        kind: 0,
        v: {
          sessionId: "s1",
          requests: [
            {
              requestId: "r1",
              timestamp: 1767225600000,
              message: { text: "Q1" },
              response: [{ value: "A1" }],
            },
          ],
        },
      },
    ]);

    const { accum, newRequestIds } = extractMessages(state);
    expect(accum.messages).toHaveLength(2);
    expect(newRequestIds).toEqual(["r1"]);
  });

  it("skips processed request IDs", () => {
    const state = replayCrdt([
      {
        kind: 0,
        v: {
          sessionId: "s1",
          requests: [
            {
              requestId: "r1",
              timestamp: 1767225600000,
              message: { text: "Q1" },
              response: [{ value: "A1" }],
            },
            {
              requestId: "r2",
              timestamp: 1767225660000,
              message: { text: "Q2" },
              response: [{ value: "A2" }],
            },
          ],
        },
      },
    ]);

    const { accum, newRequestIds } = extractMessages(
      state,
      new Set(["r1"]),
    );
    expect(accum.messages).toHaveLength(2);
    expect(accum.messages[0].content).toBe("Q2");
    expect(newRequestIds).toEqual(["r2"]);
  });

  it("handles requests without requestId (always processed)", () => {
    const state = replayCrdt([
      {
        kind: 0,
        v: {
          sessionId: "s1",
          requests: [
            {
              timestamp: 1767225600000,
              message: { text: "No ID" },
              response: [{ value: "Response" }],
            },
          ],
        },
      },
    ]);

    const { accum, newRequestIds } = extractMessages(state);
    expect(accum.messages).toHaveLength(2);
    expect(newRequestIds).toHaveLength(0); // no ID to track
  });
});

// ── extractWorkspaceFolder ──────────────────────────────────────

describe("extractWorkspaceFolder", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pika-ws-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts folder from sibling workspace.json", async () => {
    // Simulate: workspaceStorage/{hash}/chatSessions/session.jsonl
    //           workspaceStorage/{hash}/workspace.json
    const wsDir = join(tempDir, "abc123");
    const chatDir = join(wsDir, "chatSessions");
    await mkdir(chatDir, { recursive: true });
    await writeFile(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: "file:///Users/test/workspace/myproject" }),
    );

    const sessionFile = join(chatDir, "session.jsonl");
    await writeFile(sessionFile, "");

    const folder = await extractWorkspaceFolder(sessionFile);
    expect(folder).toBe("/Users/test/workspace/myproject");
  });

  it("decodes URI-encoded paths", async () => {
    const wsDir = join(tempDir, "abc123");
    const chatDir = join(wsDir, "chatSessions");
    await mkdir(chatDir, { recursive: true });
    await writeFile(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: "file:///Users/test/My%20Project" }),
    );

    const sessionFile = join(chatDir, "session.jsonl");
    await writeFile(sessionFile, "");

    const folder = await extractWorkspaceFolder(sessionFile);
    expect(folder).toBe("/Users/test/My Project");
  });

  it("returns null when workspace.json is missing", async () => {
    const chatDir = join(tempDir, "abc123", "chatSessions");
    await mkdir(chatDir, { recursive: true });
    const sessionFile = join(chatDir, "session.jsonl");
    await writeFile(sessionFile, "");

    const folder = await extractWorkspaceFolder(sessionFile);
    expect(folder).toBeNull();
  });

  it("returns null when workspace.json has no folder field", async () => {
    const wsDir = join(tempDir, "abc123");
    const chatDir = join(wsDir, "chatSessions");
    await mkdir(chatDir, { recursive: true });
    await writeFile(
      join(wsDir, "workspace.json"),
      JSON.stringify({ configPath: "/some/path" }),
    );

    const sessionFile = join(chatDir, "session.jsonl");
    await writeFile(sessionFile, "");

    const folder = await extractWorkspaceFolder(sessionFile);
    expect(folder).toBeNull();
  });

  it("returns null for global sessions (no workspace.json)", async () => {
    const globalDir = join(tempDir, "emptyWindowChatSessions");
    await mkdir(globalDir, { recursive: true });
    const sessionFile = join(globalDir, "session.jsonl");
    await writeFile(sessionFile, "");

    const folder = await extractWorkspaceFolder(sessionFile);
    expect(folder).toBeNull();
  });
});

// ── extractProjectRef ───────────────────────────────────────────

describe("extractProjectRef (vscode-copilot)", () => {
  it("hashes folder to 16-char hex string", () => {
    const ref = extractProjectRef("/Users/test/workspace/myproject");
    expect(ref).toBeTruthy();
    expect(typeof ref).toBe("string");
    expect(ref!.length).toBe(16);
  });

  it("returns null for null folder", () => {
    expect(extractProjectRef(null)).toBeNull();
  });

  it("returns consistent hash for same input", () => {
    const folder = "/Users/test/workspace/myproject";
    expect(extractProjectRef(folder)).toBe(extractProjectRef(folder));
  });

  it("returns different hashes for different folders", () => {
    const ref1 = extractProjectRef("/Users/test/project-a");
    const ref2 = extractProjectRef("/Users/test/project-b");
    expect(ref1).not.toBe(ref2);
  });
});

// ── extractProjectName ──────────────────────────────────────────

describe("extractProjectName (vscode-copilot)", () => {
  it("extracts last path segment as project name", () => {
    expect(extractProjectName("/Users/test/workspace/myproject")).toBe(
      "myproject",
    );
  });

  it("handles deeply nested paths", () => {
    expect(
      extractProjectName("/Users/test/workspace/personal/deep/myapp"),
    ).toBe("myapp");
  });

  it("returns null for null folder", () => {
    expect(extractProjectName(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractProjectName("")).toBeNull();
  });
});
