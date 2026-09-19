import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractProjectName as claudeProjectName,
  extractProjectRef as claudeProjectRef,
  parseClaudeFile,
  parseClaudeFileMulti,
} from "./claude";
import {
  extractProjectName as codexProjectName,
  parseCodexFile,
} from "./codex";
import { parseGeminiFile } from "./gemini";
import {
  extractProjectName as copilotProjectName,
  parseVscodeCopilotFile,
} from "./vscode-copilot";

const timestamp = "2026-01-01T00:00:00.000Z";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pika-protocol-boundaries-"));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

async function fixture(rows: unknown[]) {
  const file = join(directory, "unknown.jsonl");
  const raw = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await writeFile(file, raw);
  return { file, raw };
}

describe("Claude sparse records and interleaved tool output", () => {
  it.each([
    undefined,
    { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
  ])("preserves text around tools with optional usage %j", async (usage) => {
    const { file, raw } = await fixture([
      {
        type: "assistant",
        sessionId: "s",
        timestamp,
        message: {
          content: [
            { type: "text", text: "before" },
            { type: "tool_use", name: "read", input: { path: "fixture.txt" } },
            { type: "text", text: "after" },
          ],
          usage,
        },
      },
    ]);
    const { canonical } = await parseClaudeFile(file);
    expect(canonical.messages.map((m) => [m.role, m.content])).toEqual([
      ["assistant", "before"],
      ["tool", ""],
      ["assistant", "after"],
    ]);
    expect(canonical.messages[0]).toMatchObject({
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      cachedTokens: usage?.cache_read_input_tokens,
    });
    expect(canonical.messages[1].toolInput).toBe('{"path":"fixture.txt"}');
    expect(await readFile(file, "utf8")).toBe(raw);
  });

  it("retains tool results with structured or missing content without inventing tool metadata", async () => {
    const { file } = await fixture([
      {
        type: "assistant",
        sessionId: "s",
        timestamp,
        message: {
          model: "   ",
          content: [{ type: "tool_use" }],
        },
      },
      {
        type: "user",
        sessionId: "s",
        timestamp,
        message: {
          content: [
            { type: "text", text: "tool envelope" },
            {
              type: "tool_result",
              content: [{ type: "text", text: "result" }],
            },
            { type: "tool_result", content: null },
          ],
        },
      },
    ]);
    const { canonical } = await parseClaudeFile(file);
    expect(canonical.model).toBeNull();
    expect(canonical.messages).toHaveLength(3);
    expect(canonical.messages[0]).toMatchObject({
      role: "tool",
      toolName: undefined,
      toolInput: undefined,
    });
    expect(canonical.messages[1].toolResult).toBe(
      '[{"type":"text","text":"result"}]',
    );
    expect(canonical.messages[2].toolResult).toBe("");
  });

  it("does not manufacture sessions from incomplete metadata or unsupported assistant content", async () => {
    const { file } = await fixture([
      {
        type: "user",
        sessionId: "missing-time",
        message: { content: "unusable" },
      },
      {
        type: "user",
        sessionId: "numeric-time",
        timestamp: 42,
        message: { content: "unusable" },
      },
      { type: "user", sessionId: "missing-message", timestamp },
      {
        type: "assistant",
        sessionId: "unsupported",
        timestamp,
        message: { content: "not blocks" },
      },
    ]);
    expect(await parseClaudeFileMulti(file)).toEqual([]);
  });

  it("tolerates sparse user content and respects an exhausted byte cursor", async () => {
    const { file, raw } = await fixture([
      { type: "user", sessionId: "s", timestamp, message: { content: false } },
      {
        type: "user",
        sessionId: "s",
        timestamp,
        message: { content: [{ type: "text", text: 42 }] },
      },
    ]);
    expect(
      (await parseClaudeFile(file)).canonical.messages.map((m) => m.content),
    ).toEqual(["", ""]);
    expect(await parseClaudeFileMulti(file, Buffer.byteLength(raw))).toEqual(
      [],
    );
    expect(claudeProjectName("/projects//s.jsonl")).toBeNull();
    expect(claudeProjectRef("/projects//s.jsonl")).toBeNull();
  });
});

describe("Codex incomplete rollout compatibility", () => {
  it("ignores malformed events while preserving model-less string responses and user messages", async () => {
    const { file } = await fixture([
      null,
      { type: 12 },
      {
        type: "session_meta",
        timestamp,
        payload: { timestamp: "2025-12-31T23:59:00.000Z" },
      },
      {
        type: "session_meta",
        payload: { timestamp: "2026-01-02T00:00:00.000Z" },
      },
      { type: "turn_context", payload: {} },
      { type: "event_msg", payload: {} },
      { type: "response_item", payload: {} },
      { type: "event_msg", payload: { type: "user_message", message: false } },
      { type: "event_msg", payload: { type: "agent_message", message: "" } },
      { type: "event_msg", payload: { type: "agent_message", message: false } },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: "answer" },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [null, false, { text: 3 }, { text: "question" }],
        },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: 3 },
      },
    ]);
    const { canonical } = await parseCodexFile(file);
    expect(canonical.sessionKey).toBe("codex:unknown");
    expect(canonical.startedAt).toBe("2025-12-31T23:59:00.000Z");
    expect(canonical.messages.map((m) => [m.role, m.content])).toEqual([
      ["assistant", "answer"],
      ["user", "question"],
    ]);
    expect(canonical.model).toBeNull();
    expect(codexProjectName("///")).toBeNull();
  });

  it("uses the collection clock only when all event timestamps are absent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(timestamp));
    const { file } = await fixture([
      {
        type: "event_msg",
        payload: { type: "user_message", message: "question" },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: "answer" },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: -1,
              output_tokens: "invalid",
              cached_input_tokens: 2.8,
            },
          },
        },
      },
    ]);
    const { canonical } = await parseCodexFile(file);
    expect(canonical.startedAt).toBe(timestamp);
    expect(canonical.lastMessageAt).toBe(timestamp);
    expect(canonical.messages.every((m) => m.timestamp === timestamp)).toBe(
      true,
    );
    expect([
      canonical.totalInputTokens,
      canonical.totalOutputTokens,
      canonical.totalCachedTokens,
    ]).toEqual([0, 0, 2]);
  });
});

describe("Copilot sparse CRDT replay", () => {
  it("ignores malformed patches without losing valid content or replacing model/title with nonstrings", async () => {
    const { file, raw } = await fixture([
      {
        kind: 0,
        v: {
          sessionId: "s",
          customTitle: "Original",
          inputState: { selectedModel: "model" },
          requests: [
            null,
            4,
            {
              requestId: "r",
              timestamp: 1767225600000,
              message: { text: "question" },
              response: [
                null,
                4,
                { kind: "toolInvocationSerialized", result: "done" },
              ],
              result: { metadata: { promptTokens: -1, outputTokens: 2.8 } },
              modelState: { completedAt: "invalid-date" },
            },
          ],
        },
      },
      { kind: 1, k: ["customTitle"], v: 4 },
      { kind: 1, k: ["inputState", "selectedModel"], v: false },
      { kind: 1, k: ["requests", "0", "result"], v: {} },
      { kind: 1, k: ["requests", 0, "unknown"], v: {} },
      { kind: 2, k: ["requests", "0", "response"], v: {} },
      { kind: 2, k: ["requests", 0, "unknown"], v: {} },
      { kind: 2, k: ["requests", 0, "response"], v: null },
    ]);
    const result = await parseVscodeCopilotFile(file);
    expect(result.canonical.title).toBe("Original");
    expect(result.canonical.model).toBe("model");
    expect(result.canonical.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "question"],
      ["tool", ""],
      ["tool", "done"],
    ]);
    expect(result.canonical.messages[2].toolName).toBeUndefined();
    expect([
      result.canonical.totalInputTokens,
      result.canonical.totalOutputTokens,
    ]).toEqual([0, 2]);
    expect(result.newRequestIds).toEqual(["r"]);
    expect(await readFile(file, "utf8")).toBe(raw);
    expect(copilotProjectName("///")).toBeNull();
  });

  it("does not create a conversation for metadata-only requests", async () => {
    const { file } = await fixture([
      { kind: 0, v: { sessionId: "s" } },
      {
        kind: 2,
        k: ["requests"],
        v: { requestId: "empty", response: "unsupported" },
      },
    ]);
    const result = await parseVscodeCopilotFile(file);
    expect(result.canonical.messages).toEqual([]);
    expect(result.newRequestIds).toEqual([]);
  });
});

describe("Gemini sparse tool records", () => {
  it("retains available text and tool results when optional model and tool names are missing", async () => {
    const file = join(directory, "session.json");
    await writeFile(
      file,
      JSON.stringify({
        sessionId: "s",
        messages: [
          {
            type: "user",
            timestamp,
            content: [null, false, { text: 3 }, { text: "question" }],
          },
          {
            type: "gemini",
            timestamp,
            content: "answer",
            toolCalls: [
              {
                result: [
                  { functionResponse: { response: { output: "done" } } },
                  { functionResponse: { response: { output: 3 } } },
                ],
              },
              {},
            ],
          },
        ],
      }),
    );
    const { canonical } = await parseGeminiFile(file);
    expect(canonical.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "question"],
      ["assistant", "answer"],
      ["tool", ""],
      ["tool", "done"],
      ["tool", ""],
    ]);
    expect(canonical.messages[1].model).toBeUndefined();
    expect(canonical.messages[3].toolName).toBeUndefined();
  });
});
