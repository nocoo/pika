import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCodexFile,
  extractSessionIdFromFilename,
  extractProjectRef,
  extractProjectName,
} from "./codex";

describe("parseCodexFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pika-codex-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Helpers: build JSONL lines ────────────────────────────────

  function sessionMetaLine(opts?: {
    id?: string;
    timestamp?: string;
    cwd?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:00Z",
      type: "session_meta",
      payload: {
        id: opts?.id ?? "019c5057-4d5f-78c1-9ac9-aada438a903c",
        timestamp: opts?.timestamp ?? "2026-01-01T00:00:00Z",
        cwd: opts?.cwd ?? "/Users/test/workspace/myproject",
        originator: "codex_interactive",
        cli_version: "0.99.0",
        source: "interactive",
        model_provider: "openai",
      },
    });
  }

  function turnContextLine(opts?: {
    model?: string;
    cwd?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:01Z",
      type: "turn_context",
      payload: {
        model: opts?.model ?? "gpt-5.3-codex",
        cwd: opts?.cwd ?? "/Users/test/workspace/myproject",
        approval_policy: "auto-edit",
        sandbox_policy: "full-auto",
      },
    });
  }

  function userMessageLine(opts?: {
    message?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:02Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: opts?.message ?? "Hello Codex",
        images: [],
        local_images: [],
        text_elements: [],
      },
    });
  }

  function agentMessageLine(opts?: {
    message?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:01:00Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: opts?.message ?? "Hello! How can I help?",
      },
    });
  }

  function agentReasoningLine(opts?: {
    text?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:30Z",
      type: "event_msg",
      payload: {
        type: "agent_reasoning",
        text: opts?.text ?? "**Thinking about the problem**",
      },
    });
  }

  function tokenCountLine(opts?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: opts?.inputTokens ?? 1000,
            cached_input_tokens: opts?.cachedInputTokens ?? 500,
            output_tokens: opts?.outputTokens ?? 200,
            reasoning_output_tokens: opts?.reasoningOutputTokens ?? 50,
            total_tokens:
              (opts?.inputTokens ?? 1000) + (opts?.outputTokens ?? 200),
          },
          last_token_usage: {
            input_tokens: opts?.inputTokens ?? 1000,
            cached_input_tokens: opts?.cachedInputTokens ?? 500,
            output_tokens: opts?.outputTokens ?? 200,
            reasoning_output_tokens: opts?.reasoningOutputTokens ?? 50,
            total_tokens:
              (opts?.inputTokens ?? 1000) + (opts?.outputTokens ?? 200),
          },
          model_context_window: 258400,
        },
        rate_limits: {
          primary: { used_percent: 0.0 },
        },
      },
    });
  }

  function tokenCountNullInfoLine(opts?: {
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:05Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
        rate_limits: {
          primary: { used_percent: 0.0 },
        },
      },
    });
  }

  function responseItemMessageLine(opts?: {
    role?: string;
    contentText?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:30Z",
      type: "response_item",
      payload: {
        type: "message",
        role: opts?.role ?? "assistant",
        content: [
          {
            type: opts?.role === "assistant" ? "output_text" : "input_text",
            text: opts?.contentText ?? "Here is my response.",
          },
        ],
      },
    });
  }

  function functionCallLine(opts?: {
    name?: string;
    args?: string;
    callId?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:30Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: opts?.name ?? "exec_command",
        arguments:
          opts?.args ??
          '{"cmd":"git status","workdir":"/Users/test/workspace"}',
        call_id: opts?.callId ?? "call_abc123",
      },
    });
  }

  function functionCallOutputLine(opts?: {
    callId?: string;
    output?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:35Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: opts?.callId ?? "call_abc123",
        output: opts?.output ?? "On branch main\nnothing to commit",
      },
    });
  }

  function reasoningLine(opts?: { timestamp?: string }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:25Z",
      type: "response_item",
      payload: {
        type: "reasoning",
        content: [],
        encrypted_content: "encrypted...",
        summary: [{ type: "summary_text", text: "Thinking..." }],
      },
    });
  }

  function developerMessageLine(opts?: {
    text?: string;
    timestamp?: string;
  }): string {
    return JSON.stringify({
      timestamp: opts?.timestamp ?? "2026-01-01T00:00:00Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: opts?.text ?? "<permissions>read-only</permissions>",
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

  it("parses a simple user + agent conversation", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-019c5057-4d5f-78c1-9ac9-aada438a903c.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine({ message: "What is 2+2?" }),
        agentMessageLine({ message: "The answer is 4." }),
      ],
    );

    const result = await parseCodexFile(filePath);

    expect(result.canonical.sessionKey).toBe(
      "codex:019c5057-4d5f-78c1-9ac9-aada438a903c",
    );
    expect(result.canonical.source).toBe("codex");
    expect(result.canonical.messages).toHaveLength(2);

    const [userMsg, agentMsg] = result.canonical.messages;
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("What is 2+2?");
    expect(agentMsg.role).toBe("assistant");
    expect(agentMsg.content).toBe("The answer is 4.");
  });

  it("extracts session ID from session_meta payload", async () => {
    const filePath = await writeJsonl("rollout-2026-01-01T00-00-00-fallback-id.jsonl", [
      sessionMetaLine({ id: "real-session-id" }),
      userMessageLine(),
      agentMessageLine(),
    ]);

    const result = await parseCodexFile(filePath);
    expect(result.canonical.sessionKey).toBe("codex:real-session-id");
  });

  it("falls back to filename UUID when session_meta is missing", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-019c-filename-uuid.jsonl",
      [
        turnContextLine(),
        userMessageLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.sessionKey).toBe("codex:019c-filename-uuid");
  });

  // ── Token usage ───────────────────────────────────────────────

  it("extracts cumulative token usage from last token_count event", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-test-tokens.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        tokenCountLine({
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 20,
        }),
        agentMessageLine(),
        tokenCountLine({
          inputTokens: 500,
          cachedInputTokens: 200,
          outputTokens: 100,
        }),
      ],
    );

    const result = await parseCodexFile(filePath);
    // Should use the LAST token_count event's totals (cumulative)
    expect(result.canonical.totalInputTokens).toBe(500);
    expect(result.canonical.totalOutputTokens).toBe(100);
    expect(result.canonical.totalCachedTokens).toBe(200);
  });

  it("handles token_count with null info gracefully", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-null-tokens.jsonl",
      [
        sessionMetaLine(),
        userMessageLine(),
        tokenCountNullInfoLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  // ── Model extraction ──────────────────────────────────────────

  it("extracts model from turn_context", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-test-model.jsonl",
      [
        sessionMetaLine(),
        turnContextLine({ model: "gpt-5.3-codex" }),
        userMessageLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.model).toBe("gpt-5.3-codex");
    // Agent message should have model
    const agentMsg = result.canonical.messages.find(
      (m) => m.role === "assistant",
    );
    expect(agentMsg?.model).toBe("gpt-5.3-codex");
  });

  it("uses last seen model across multiple turn_contexts", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-multi-model.jsonl",
      [
        sessionMetaLine(),
        turnContextLine({ model: "gpt-5", timestamp: "2026-01-01T00:00:01Z" }),
        userMessageLine({ timestamp: "2026-01-01T00:00:02Z" }),
        agentMessageLine({ timestamp: "2026-01-01T00:00:03Z" }),
        turnContextLine({
          model: "gpt-5.3-codex",
          timestamp: "2026-01-01T00:01:00Z",
        }),
        userMessageLine({
          message: "Another question",
          timestamp: "2026-01-01T00:01:01Z",
        }),
        agentMessageLine({
          message: "Another answer",
          timestamp: "2026-01-01T00:01:02Z",
        }),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.model).toBe("gpt-5.3-codex");
  });

  // ── Tool calls (function_call + function_call_output) ─────────

  it("extracts function_call as tool message", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-tool-call.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine({ message: "Check git status" }),
        functionCallLine({
          name: "exec_command",
          args: '{"cmd":"git status"}',
          callId: "call_123",
        }),
        functionCallOutputLine({
          callId: "call_123",
          output: "On branch main\nnothing to commit",
        }),
        agentMessageLine({ message: "Your repo is clean." }),
      ],
    );

    const result = await parseCodexFile(filePath);
    // user + function_call + function_call_output + agent_message = 4
    expect(result.canonical.messages).toHaveLength(4);

    const toolCall = result.canonical.messages[1];
    expect(toolCall.role).toBe("tool");
    expect(toolCall.toolName).toBe("exec_command");
    expect(toolCall.toolInput).toBe('{"cmd":"git status"}');

    const toolOutput = result.canonical.messages[2];
    expect(toolOutput.role).toBe("tool");
    expect(toolOutput.content).toBe("On branch main\nnothing to commit");
    expect(toolOutput.toolResult).toBe("On branch main\nnothing to commit");
  });

  // ── response_item message types ───────────────────────────────

  it("extracts response_item messages with role user/assistant", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-resp-msg.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        responseItemMessageLine({
          role: "user",
          contentText: "User prompt via response_item",
        }),
        responseItemMessageLine({
          role: "assistant",
          contentText: "Assistant response via response_item",
          timestamp: "2026-01-01T00:01:00Z",
        }),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[0].content).toBe(
      "User prompt via response_item",
    );
    expect(result.canonical.messages[1].role).toBe("assistant");
    expect(result.canonical.messages[1].content).toBe(
      "Assistant response via response_item",
    );
  });

  it("skips developer messages from response_items", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-dev-msg.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        developerMessageLine(),
        userMessageLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    // Developer message should be skipped; only user + agent
    expect(result.canonical.messages).toHaveLength(2);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[1].role).toBe("assistant");
  });

  it("skips reasoning response_items", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-reasoning.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        reasoningLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    // Reasoning items should be skipped
    expect(result.canonical.messages).toHaveLength(2);
  });

  // ── agent_reasoning events ────────────────────────────────────

  it("skips agent_reasoning events (not included in messages)", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-agent-reasoning.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        agentReasoningLine({ text: "**Thinking step 1**" }),
        agentReasoningLine({ text: "**Thinking step 2**" }),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    // Only user + agent messages, reasoning skipped
    expect(result.canonical.messages).toHaveLength(2);
  });

  // ── Session metadata ──────────────────────────────────────────

  it("computes duration from first to last timestamp", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-duration.jsonl",
      [
        sessionMetaLine({ timestamp: "2026-01-01T00:00:00Z" }),
        turnContextLine({ timestamp: "2026-01-01T00:00:01Z" }),
        userMessageLine({ timestamp: "2026-01-01T00:00:02Z" }),
        agentMessageLine({ timestamp: "2026-01-01T00:05:30Z" }),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.canonical.lastMessageAt).toBe("2026-01-01T00:05:30Z");
    expect(result.canonical.durationSeconds).toBe(330); // 5m30s
  });

  it("extracts project ref and name from cwd", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-project.jsonl",
      [
        sessionMetaLine({ cwd: "/Users/test/workspace/myproject" }),
        userMessageLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.projectRef).toBeTruthy();
    expect(result.canonical.projectRef!.length).toBe(16);
    expect(result.canonical.projectName).toBe("myproject");
  });

  it("extracts cwd from turn_context when session_meta has no cwd", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-tc-cwd.jsonl",
      [
        // session_meta without cwd
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00Z",
          type: "session_meta",
          payload: { id: "test-id" },
        }),
        turnContextLine({ cwd: "/Users/test/workspace/from-tc" }),
        userMessageLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.projectName).toBe("from-tc");
  });

  // ── Raw output ────────────────────────────────────────────────

  it("produces raw session archive with original JSONL content", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-raw.jsonl",
      [sessionMetaLine(), userMessageLine(), agentMessageLine()],
    );

    const result = await parseCodexFile(filePath);
    expect(result.raw.sessionKey).toBe(
      "codex:019c5057-4d5f-78c1-9ac9-aada438a903c",
    );
    expect(result.raw.source).toBe("codex");
    expect(result.raw.sourceFiles).toHaveLength(1);
    expect(result.raw.sourceFiles[0].format).toBe("jsonl");
    expect(result.raw.sourceFiles[0].path).toBe(filePath);
    // Raw content should contain all original lines
    expect(result.raw.sourceFiles[0].content).toContain("session_meta");
    expect(result.raw.sourceFiles[0].content).toContain("user_message");
  });

  // ── Branch coverage: uncovered edge cases ───────────────────────

  it("uses session_meta timestamp as startedAt when earlier than event timestamps", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-meta-ts.jsonl",
      [
        // session_meta with an earlier timestamp than the events
        sessionMetaLine({ timestamp: "2025-12-31T23:00:00Z" }),
        turnContextLine({ timestamp: "2026-01-01T00:00:01Z" }),
        userMessageLine({ timestamp: "2026-01-01T00:00:02Z" }),
        agentMessageLine({ timestamp: "2026-01-01T00:00:03Z" }),
      ],
    );

    const result = await parseCodexFile(filePath);
    // session_meta payload.timestamp is earlier, so startedAt should use it
    expect(result.canonical.startedAt).toBe("2025-12-31T23:00:00Z");
  });

  it("handles response_item message with string content (not array)", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-str-content.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        // response_item message with plain string content instead of array
        JSON.stringify({
          timestamp: "2026-01-01T00:00:30Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: "Plain string content",
          },
        }),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.messages).toHaveLength(1);
    expect(result.canonical.messages[0].role).toBe("assistant");
    expect(result.canonical.messages[0].content).toBe("Plain string content");
  });

  it("handles function_call with non-string arguments", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-no-args.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        // function_call with missing/non-string arguments
        JSON.stringify({
          timestamp: "2026-01-01T00:00:30Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: null,
            call_id: "call_no_args",
          },
        }),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    const toolMsg = result.canonical.messages.find(
      (m) => m.role === "tool" && m.toolName === "exec_command",
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolInput).toBeUndefined();
  });

  it("handles function_call with non-string name", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-no-name.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        JSON.stringify({
          timestamp: "2026-01-01T00:00:30Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: 123,
            arguments: '{"cmd":"test"}',
            call_id: "call_no_name",
          },
        }),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    const toolMsg = result.canonical.messages.find(
      (m) => m.role === "tool" && m.toolName === undefined,
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolInput).toBe('{"cmd":"test"}');
  });

  it("handles response_item message with empty content (no text blocks)", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-empty-content.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        // response_item with empty array content — should be skipped (no text)
        JSON.stringify({
          timestamp: "2026-01-01T00:00:30Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [],
          },
        }),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    // Empty content message skipped, only user + agent
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles function_call_output with non-string output", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-non-str-output.jsonl",
      [
        sessionMetaLine(),
        turnContextLine(),
        userMessageLine(),
        functionCallLine({ callId: "call_x" }),
        JSON.stringify({
          timestamp: "2026-01-01T00:00:35Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_x",
            output: 42,
          },
        }),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    const toolOutput = result.canonical.messages.find(
      (m) => m.role === "tool" && m.toolResult !== undefined,
    );
    // Non-string output falls back to ""
    expect(toolOutput?.content).toBe("");
  });

  // ── Edge cases ────────────────────────────────────────────────

  it("returns empty result for missing file", async () => {
    const result = await parseCodexFile(join(tempDir, "nonexistent.jsonl"));
    expect(result.canonical.messages).toHaveLength(0);
    expect(result.canonical.source).toBe("codex");
  });

  it("returns empty result for empty file", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-empty.jsonl",
      [],
    );
    const result = await parseCodexFile(filePath);
    expect(result.canonical.messages).toHaveLength(0);
  });

  it("skips malformed JSON lines", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-malformed.jsonl",
      [
        sessionMetaLine(),
        "{{{malformed json",
        userMessageLine({ message: "Valid message" }),
        agentMessageLine({ message: "Valid response" }),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles lines without payload gracefully", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-no-payload.jsonl",
      [
        JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", type: "unknown" }),
        userMessageLine(),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.messages).toHaveLength(2);
  });

  it("handles zero token usage gracefully", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-zero-tokens.jsonl",
      [
        sessionMetaLine(),
        userMessageLine(),
        tokenCountLine({
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
        }),
        agentMessageLine(),
      ],
    );

    const result = await parseCodexFile(filePath);
    expect(result.canonical.totalInputTokens).toBe(0);
    expect(result.canonical.totalOutputTokens).toBe(0);
    expect(result.canonical.totalCachedTokens).toBe(0);
  });

  // ── Incremental parsing (byte offset) ─────────────────────────

  it("resumes from byte offset", async () => {
    const line1 = sessionMetaLine({ timestamp: "2026-01-01T00:00:00Z" });
    const line2 = userMessageLine({
      message: "First message",
      timestamp: "2026-01-01T00:00:01Z",
    });
    const line3 = agentMessageLine({
      message: "First response",
      timestamp: "2026-01-01T00:00:02Z",
    });
    const line4 = userMessageLine({
      message: "Second message",
      timestamp: "2026-01-01T00:01:00Z",
    });
    const line5 = agentMessageLine({
      message: "Second response",
      timestamp: "2026-01-01T00:01:01Z",
    });

    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-resume.jsonl",
      [line1, line2, line3, line4, line5],
    );

    // Full parse
    const full = await parseCodexFile(filePath);
    expect(full.canonical.messages).toHaveLength(4);

    // Offset after first 3 lines (session_meta + user + agent)
    const offset =
      Buffer.byteLength(line1 + "\n") +
      Buffer.byteLength(line2 + "\n") +
      Buffer.byteLength(line3 + "\n");

    // With the full-canonical fix, resumed parse always produces the
    // complete snapshot (all 4 messages). The offset is only used as
    // a "has new data?" gate — parsing always starts from byte 0.
    const resumed = await parseCodexFile(filePath, offset);
    expect(resumed.canonical.messages).toHaveLength(4);
    expect(resumed.canonical.messages[0].content).toBe("First message");
    expect(resumed.canonical.messages[1].content).toBe("First response");
    expect(resumed.canonical.messages[2].content).toBe("Second message");
    expect(resumed.canonical.messages[3].content).toBe("Second response");
  });

  it("returns empty result when offset is at or past file size", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-past-eof.jsonl",
      [sessionMetaLine(), userMessageLine()],
    );

    const result = await parseCodexFile(filePath, 999999);
    expect(result.canonical.messages).toHaveLength(0);
  });

  // ── Complex multi-turn conversation ───────────────────────────

  it("parses a full multi-turn conversation with tool calls", async () => {
    const filePath = await writeJsonl(
      "rollout-2026-01-01T00-00-00-full-conv.jsonl",
      [
        sessionMetaLine({
          id: "full-test-session",
          cwd: "/Users/test/projects/app",
          timestamp: "2026-01-01T00:00:00Z",
        }),
        turnContextLine({
          model: "gpt-5.3-codex",
          timestamp: "2026-01-01T00:00:01Z",
        }),
        developerMessageLine({ timestamp: "2026-01-01T00:00:01Z" }),
        responseItemMessageLine({
          role: "user",
          contentText: "AGENTS.md instructions",
          timestamp: "2026-01-01T00:00:01Z",
        }),
        userMessageLine({
          message: "Check the git status",
          timestamp: "2026-01-01T00:00:02Z",
        }),
        agentReasoningLine({ timestamp: "2026-01-01T00:00:03Z" }),
        reasoningLine({ timestamp: "2026-01-01T00:00:03Z" }),
        functionCallLine({
          name: "exec_command",
          args: '{"cmd":"git status"}',
          callId: "call_1",
          timestamp: "2026-01-01T00:00:04Z",
        }),
        functionCallOutputLine({
          callId: "call_1",
          output: "modified: src/app.ts",
          timestamp: "2026-01-01T00:00:05Z",
        }),
        tokenCountLine({
          inputTokens: 5000,
          cachedInputTokens: 2000,
          outputTokens: 300,
          timestamp: "2026-01-01T00:00:06Z",
        }),
        agentMessageLine({
          message: "You have modified src/app.ts.",
          timestamp: "2026-01-01T00:00:07Z",
        }),
      ],
    );

    const result = await parseCodexFile(filePath);

    expect(result.canonical.sessionKey).toBe("codex:full-test-session");
    expect(result.canonical.source).toBe("codex");
    expect(result.canonical.model).toBe("gpt-5.3-codex");
    expect(result.canonical.projectName).toBe("app");
    expect(result.canonical.projectRef).toBeTruthy();

    // Messages: user(response_item) + user(event_msg) + tool_call + tool_output + agent_message = 5
    // developer message and reasoning are skipped
    expect(result.canonical.messages).toHaveLength(5);
    expect(result.canonical.messages[0].role).toBe("user");
    expect(result.canonical.messages[1].role).toBe("user");
    expect(result.canonical.messages[2].role).toBe("tool");
    expect(result.canonical.messages[2].toolName).toBe("exec_command");
    expect(result.canonical.messages[3].role).toBe("tool");
    expect(result.canonical.messages[3].toolResult).toBe(
      "modified: src/app.ts",
    );
    expect(result.canonical.messages[4].role).toBe("assistant");

    // Token totals from last token_count
    expect(result.canonical.totalInputTokens).toBe(5000);
    expect(result.canonical.totalOutputTokens).toBe(300);
    expect(result.canonical.totalCachedTokens).toBe(2000);

    // Duration
    expect(result.canonical.durationSeconds).toBe(7);
  });
});

// ── extractSessionIdFromFilename ────────────────────────────────

describe("extractSessionIdFromFilename", () => {
  it("extracts UUID from standard rollout filename", () => {
    const id = extractSessionIdFromFilename(
      "/path/to/rollout-2026-02-12T13-33-44-019c5057-4d5f-78c1-9ac9-aada438a903c.jsonl",
    );
    expect(id).toBe("019c5057-4d5f-78c1-9ac9-aada438a903c");
  });

  it("extracts UUID from nested path", () => {
    const id = extractSessionIdFromFilename(
      "/Users/nocoo/.codex/sessions/2026/02/12/rollout-2026-02-12T13-33-44-019c5057-4d5f-78c1-9ac9-aada438a903c.jsonl",
    );
    expect(id).toBe("019c5057-4d5f-78c1-9ac9-aada438a903c");
  });

  it("returns null for non-rollout filename", () => {
    expect(extractSessionIdFromFilename("/path/to/session.jsonl")).toBeNull();
    expect(extractSessionIdFromFilename("/path/to/data.json")).toBeNull();
  });

  it("returns null for empty path", () => {
    expect(extractSessionIdFromFilename("")).toBeNull();
  });
});

// ── extractProjectRef ───────────────────────────────────────────

describe("extractProjectRef (codex)", () => {
  it("hashes cwd to 16-char hex string", () => {
    const ref = extractProjectRef("/Users/test/workspace/myproject");
    expect(ref).toBeTruthy();
    expect(typeof ref).toBe("string");
    expect(ref!.length).toBe(16);
  });

  it("returns null for null cwd", () => {
    expect(extractProjectRef(null)).toBeNull();
  });

  it("returns consistent hash for same input", () => {
    const cwd = "/Users/test/workspace/myproject";
    expect(extractProjectRef(cwd)).toBe(extractProjectRef(cwd));
  });

  it("returns different hashes for different cwds", () => {
    const ref1 = extractProjectRef("/Users/test/project-a");
    const ref2 = extractProjectRef("/Users/test/project-b");
    expect(ref1).not.toBe(ref2);
  });
});

// ── extractProjectName ──────────────────────────────────────────

describe("extractProjectName (codex)", () => {
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

  it("returns null for null cwd", () => {
    expect(extractProjectName(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractProjectName("")).toBeNull();
  });
});
