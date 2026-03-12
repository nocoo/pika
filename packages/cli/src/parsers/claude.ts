/**
 * Claude Code parser.
 *
 * Reads JSONL files from ~/.claude/projects/, extracts full conversation
 * content (messages, tool calls, token usage), and produces both
 * canonical (CanonicalSession) and raw (RawSessionArchive) outputs.
 *
 * File format: one JSON object per line with top-level `type` field:
 * - "user": human message (message.content = string | content_block[])
 * - "assistant": assistant message (message.content = content_block[])
 * - "queue-operation": enqueue events (skipped)
 *
 * Content block types:
 * - {type: "text", text: "..."} → assistant text
 * - {type: "tool_use", id, name, input} → tool call
 * - {type: "tool_result", tool_use_id, content} → tool result (in user messages)
 * - {type: "thinking", thinking: "..."} → thinking (skipped)
 */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PARSER_REVISION, SCHEMA_VERSION } from "@pika/core";
import type {
  CanonicalMessage,
  CanonicalSession,
  RawSessionArchive,
  ParseResult,
} from "@pika/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";

// ── Types ───────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown[];
}

interface ClaudeMessage {
  role: string;
  model?: string;
  content: string | ContentBlock[];
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

interface ClaudeLine {
  type: string;
  sessionId?: string;
  timestamp?: string;
  message?: ClaudeMessage;
  cwd?: string;
  slug?: string;
}

interface SessionAccum {
  sessionId: string;
  messages: CanonicalMessage[];
  lines: string[];
  startedAt: string | null;
  lastMessageAt: string | null;
  lastModel: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
}

// ── Content extraction ──────────────────────────────────────────

function extractUserContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }
  return textParts.join("\n");
}

function toNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return 0;
  return Math.floor(value);
}

function processAssistantContent(
  content: ContentBlock[],
  timestamp: string,
  model: string | undefined,
  usage:
    | {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      }
    | undefined,
): CanonicalMessage[] {
  const messages: CanonicalMessage[] = [];
  const textParts: string[] = [];

  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      // Flush any accumulated text first
      if (textParts.length > 0) {
        messages.push({
          role: "assistant",
          content: textParts.join("\n"),
          model,
          inputTokens: usage ? toNonNegInt(usage.input_tokens) : undefined,
          outputTokens: usage ? toNonNegInt(usage.output_tokens) : undefined,
          cachedTokens: usage
            ? toNonNegInt(usage.cache_read_input_tokens)
            : undefined,
          timestamp,
        });
        textParts.length = 0;
      }

      messages.push({
        role: "tool",
        content: "",
        toolName: typeof block.name === "string" ? block.name : undefined,
        toolInput:
          block.input != null ? JSON.stringify(block.input) : undefined,
        timestamp,
      });
    }
    // Skip thinking blocks
  }

  // Flush remaining text
  if (textParts.length > 0 || messages.length === 0) {
    messages.push({
      role: "assistant",
      content: textParts.join("\n"),
      model,
      inputTokens: usage ? toNonNegInt(usage.input_tokens) : undefined,
      outputTokens: usage ? toNonNegInt(usage.output_tokens) : undefined,
      cachedTokens: usage
        ? toNonNegInt(usage.cache_read_input_tokens)
        : undefined,
      timestamp,
    });
  }

  return messages;
}

function processToolResults(
  content: ContentBlock[],
  timestamp: string,
): CanonicalMessage[] {
  const messages: CanonicalMessage[] = [];
  for (const block of content) {
    if (block.type === "tool_result") {
      const resultContent =
        typeof block.content === "string"
          ? block.content
          : block.content != null
            ? JSON.stringify(block.content)
            : "";
      messages.push({
        role: "tool",
        content: resultContent,
        toolResult: resultContent,
        timestamp,
      });
    }
  }
  return messages;
}

// ── Line processing ─────────────────────────────────────────────

function processLine(
  line: string,
  sessions: Map<string, SessionAccum>,
): void {
  let obj: ClaudeLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }

  const sessionId = obj.sessionId;
  if (!sessionId || typeof sessionId !== "string") return;

  const type = obj.type;
  if (type !== "user" && type !== "assistant") return;

  const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null;
  if (!timestamp) return;

  const message = obj.message;
  if (!message) return;

  // Get or create accumulator
  let accum = sessions.get(sessionId);
  if (!accum) {
    accum = {
      sessionId,
      messages: [],
      lines: [],
      startedAt: null,
      lastMessageAt: null,
      lastModel: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
    };
    sessions.set(sessionId, accum);
  }

  accum.lines.push(line);

  // Track timestamps
  if (!accum.startedAt || timestamp < accum.startedAt) {
    accum.startedAt = timestamp;
  }
  if (!accum.lastMessageAt || timestamp > accum.lastMessageAt) {
    accum.lastMessageAt = timestamp;
  }

  if (type === "user") {
    const content = message.content;
    if (Array.isArray(content)) {
      // Check if it contains tool_result blocks
      const hasToolResults = content.some(
        (b: ContentBlock) => b.type === "tool_result",
      );
      if (hasToolResults) {
        accum.messages.push(...processToolResults(content, timestamp));
      } else {
        accum.messages.push({
          role: "user",
          content: extractUserContent(content),
          timestamp,
        });
      }
    } else {
      accum.messages.push({
        role: "user",
        content: extractUserContent(content),
        timestamp,
      });
    }
  } else if (type === "assistant") {
    const model =
      typeof message.model === "string" ? message.model.trim() : undefined;
    if (model) accum.lastModel = model;

    const content = message.content;
    if (Array.isArray(content)) {
      const msgs = processAssistantContent(
        content,
        timestamp,
        model,
        message.usage,
      );
      accum.messages.push(...msgs);
    }

    // Accumulate token usage
    if (message.usage) {
      accum.totalInputTokens += toNonNegInt(message.usage.input_tokens);
      accum.totalOutputTokens += toNonNegInt(message.usage.output_tokens);
      accum.totalCachedTokens += toNonNegInt(
        message.usage.cache_read_input_tokens,
      );
    }
  }
}

// ── Session building ────────────────────────────────────────────

function buildParseResult(
  accum: SessionAccum,
  filePath: string,
): ParseResult {
  const startedAt = accum.startedAt ?? new Date().toISOString();
  const lastMessageAt = accum.lastMessageAt ?? startedAt;
  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  const canonical: CanonicalSession = {
    sessionKey: `claude:${accum.sessionId}`,
    source: "claude-code",
    parserRevision: PARSER_REVISION,
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    lastMessageAt,
    durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
    projectRef: extractProjectRef(filePath),
    projectName: extractProjectName(filePath),
    model: accum.lastModel,
    title: null,
    messages: accum.messages,
    totalInputTokens: accum.totalInputTokens,
    totalOutputTokens: accum.totalOutputTokens,
    totalCachedTokens: accum.totalCachedTokens,
    snapshotAt: new Date().toISOString(),
  };

  const raw: RawSessionArchive = {
    sessionKey: `claude:${accum.sessionId}`,
    source: "claude-code",
    parserRevision: PARSER_REVISION,
    collectedAt: new Date().toISOString(),
    sourceFiles: [
      {
        path: filePath,
        format: "jsonl",
        content: accum.lines.join("\n"),
      },
    ],
  };

  return { canonical, raw };
}

function buildEmptyResult(filePath: string): ParseResult {
  const now = new Date().toISOString();
  return {
    canonical: {
      sessionKey: "claude:unknown",
      source: "claude-code",
      parserRevision: PARSER_REVISION,
      schemaVersion: SCHEMA_VERSION,
      startedAt: now,
      lastMessageAt: now,
      durationSeconds: 0,
      projectRef: null,
      projectName: null,
      model: null,
      title: null,
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      snapshotAt: now,
    },
    raw: {
      sessionKey: "claude:unknown",
      source: "claude-code",
      parserRevision: PARSER_REVISION,
      collectedAt: now,
      sourceFiles: [{ path: filePath, format: "jsonl", content: "" }],
    },
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Extract project reference (privacy-hashed) from Claude file path.
 *
 * Claude stores files under ~/.claude/projects/{dirName}/{file}.jsonl
 * where dirName is a path-encoded string like "-Users-nocoo-workspace-pika".
 */
export function extractProjectRef(filePath: string): string | null {
  const parts = filePath.split("/");
  const projectsIdx = parts.lastIndexOf("projects");
  if (projectsIdx < 0 || projectsIdx + 1 >= parts.length - 1) return null;
  const dirName = parts[projectsIdx + 1];
  if (!dirName) return null;
  return hashProjectRef(dirName);
}

/**
 * Extract human-readable project name from Claude file path.
 *
 * Converts Claude's path encoding (e.g. "-Users-nocoo-workspace-pika")
 * back to a readable path ("/Users/nocoo/workspace/pika").
 */
export function extractProjectName(filePath: string): string | null {
  const parts = filePath.split("/");
  const projectsIdx = parts.lastIndexOf("projects");
  if (projectsIdx < 0 || projectsIdx + 1 >= parts.length - 1) return null;
  const dirName = parts[projectsIdx + 1];
  if (!dirName) return null;
  // Claude encodes paths by replacing / with - and prepending -
  // e.g. "-Users-nocoo-workspace-personal-pika" → "/Users/nocoo/workspace/personal/pika"
  return dirName.replace(/-/g, "/");
}

/**
 * Parse a single Claude Code JSONL file.
 *
 * Returns the first (or only) session found. For files with multiple
 * sessionIds, use `parseClaudeFileMulti`.
 */
export async function parseClaudeFile(
  filePath: string,
  startOffset = 0,
): Promise<ParseResult> {
  const results = await parseClaudeFileMulti(filePath, startOffset);
  if (results.length === 0) return buildEmptyResult(filePath);
  return results[0];
}

/**
 * Parse a Claude Code JSONL file, returning all sessions found.
 *
 * Claude files are typically one session per file, but the format
 * supports multiple sessionIds in a single file.
 */
export async function parseClaudeFileMulti(
  filePath: string,
  startOffset = 0,
): Promise<ParseResult[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return [];

  if (startOffset >= st.size) return [];

  const sessions = new Map<string, SessionAccum>();

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;
      processLine(line, sessions);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const results: ParseResult[] = [];
  for (const accum of sessions.values()) {
    if (accum.messages.length === 0) continue;
    results.push(buildParseResult(accum, filePath));
  }

  return results;
}
