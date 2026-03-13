/**
 * Codex CLI parser.
 *
 * Reads JSONL rollout files from ~/.codex/sessions/, extracts full
 * conversation content (messages, tool calls, token usage), and produces
 * both canonical (CanonicalSession) and raw (RawSessionArchive) outputs.
 *
 * File format: one JSON object per line with top-level `type` field:
 * - "session_meta": session metadata (id, cwd, model_provider, timestamp)
 * - "turn_context": per-turn context (model, cwd, sandbox_policy)
 * - "event_msg": UI events (subtypes: user_message, agent_message,
 *     agent_reasoning, token_count, entered_review_mode, exited_review_mode)
 * - "response_item": API response items (subtypes: message, function_call,
 *     function_call_output, reasoning)
 *
 * Session key: `codex:{payload.id}` from session_meta, or
 *   `codex:{uuid-from-filename}` if session_meta is missing.
 *
 * Token usage: cumulative totals from the last `token_count` event.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { PARSER_REVISION, SCHEMA_VERSION } from "@pika/core";
import type {
  CanonicalMessage,
  CanonicalSession,
  RawSessionArchive,
  ParseResult,
} from "@pika/core";
import { hashProjectRef } from "../utils/hash-project-ref";

// ── Types ───────────────────────────────────────────────────────

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface TokenCountInfo {
  total_token_usage?: TokenUsage;
  last_token_usage?: TokenUsage;
  model_context_window?: number;
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface CodexLine {
  timestamp?: string;
  type: string;
  payload: Record<string, unknown>;
}

interface SessionAccum {
  sessionId: string;
  messages: CanonicalMessage[];
  lines: string[];
  startedAt: string | null;
  lastMessageAt: string | null;
  lastModel: string | null;
  cwd: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
}

// ── Helpers ─────────────────────────────────────────────────────

function toNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return 0;
  return Math.floor(value);
}

/**
 * Extract session ID from a Codex rollout filename.
 *
 * Format: rollout-YYYY-MM-DDTHH-MM-SS-{uuid}.jsonl
 * The UUID is the part after the datetime prefix.
 */
export function extractSessionIdFromFilename(
  filePath: string,
): string | null {
  const name = basename(filePath);
  // Match: rollout-YYYY-MM-DDTHH-MM-SS-{uuid}.jsonl
  const match = name.match(
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
  );
  if (!match) return null;
  return match[1];
}

/**
 * Extract project reference (privacy-hashed) from Codex cwd.
 */
export function extractProjectRef(cwd: string | null): string | null {
  if (!cwd) return null;
  return hashProjectRef(cwd);
}

/**
 * Extract human-readable project name from Codex cwd.
 * Uses the last path segment.
 */
export function extractProjectName(cwd: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

// ── Content extraction ──────────────────────────────────────────

function extractContentFromBlocks(
  blocks: unknown[],
): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (
      typeof block === "object" &&
      block !== null &&
      "text" in block &&
      typeof (block as ContentBlock).text === "string"
    ) {
      parts.push((block as ContentBlock).text!);
    }
  }
  return parts.join("\n");
}

// ── Line processing ─────────────────────────────────────────────

function processLine(
  line: string,
  accum: SessionAccum,
): void {
  let obj: CodexLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }

  if (!obj || typeof obj.type !== "string") return;

  const timestamp =
    typeof obj.timestamp === "string" ? obj.timestamp : null;

  accum.lines.push(line);

  // Track timestamps
  if (timestamp) {
    if (!accum.startedAt || timestamp < accum.startedAt) {
      accum.startedAt = timestamp;
    }
    if (!accum.lastMessageAt || timestamp > accum.lastMessageAt) {
      accum.lastMessageAt = timestamp;
    }
  }

  const payload = obj.payload;
  if (!payload || typeof payload !== "object") return;

  switch (obj.type) {
    case "session_meta":
      processSessionMeta(payload, accum);
      break;
    case "turn_context":
      processTurnContext(payload, accum);
      break;
    case "event_msg":
      processEventMsg(payload, timestamp, accum);
      break;
    case "response_item":
      processResponseItem(payload, timestamp, accum);
      break;
  }
}

function processSessionMeta(
  payload: Record<string, unknown>,
  accum: SessionAccum,
): void {
  if (typeof payload.id === "string") {
    accum.sessionId = payload.id;
  }
  if (typeof payload.cwd === "string") {
    accum.cwd = payload.cwd;
  }
  if (typeof payload.timestamp === "string") {
    if (!accum.startedAt || payload.timestamp < accum.startedAt) {
      accum.startedAt = payload.timestamp as string;
    }
  }
}

function processTurnContext(
  payload: Record<string, unknown>,
  accum: SessionAccum,
): void {
  if (typeof payload.model === "string") {
    accum.lastModel = payload.model;
  }
  if (typeof payload.cwd === "string" && !accum.cwd) {
    accum.cwd = payload.cwd;
  }
}

function processEventMsg(
  payload: Record<string, unknown>,
  timestamp: string | null,
  accum: SessionAccum,
): void {
  const subtype = payload.type;
  if (typeof subtype !== "string") return;

  const ts = timestamp ?? new Date().toISOString();

  switch (subtype) {
    case "user_message": {
      const message =
        typeof payload.message === "string" ? payload.message : null;
      if (message) {
        accum.messages.push({
          role: "user",
          content: message,
          timestamp: ts,
        });
      }
      break;
    }
    case "agent_message": {
      const message =
        typeof payload.message === "string" ? payload.message : null;
      if (message) {
        accum.messages.push({
          role: "assistant",
          content: message,
          model: accum.lastModel ?? undefined,
          timestamp: ts,
        });
      }
      break;
    }
    case "token_count": {
      const info = payload.info as TokenCountInfo | null;
      if (info?.total_token_usage) {
        const usage = info.total_token_usage;
        accum.totalInputTokens = toNonNegInt(usage.input_tokens);
        accum.totalOutputTokens = toNonNegInt(usage.output_tokens);
        accum.totalCachedTokens = toNonNegInt(usage.cached_input_tokens);
      }
      break;
    }
    // agent_reasoning, entered_review_mode, exited_review_mode → skip
  }
}

function processResponseItem(
  payload: Record<string, unknown>,
  timestamp: string | null,
  accum: SessionAccum,
): void {
  const subtype = payload.type;
  if (typeof subtype !== "string") return;

  const ts = timestamp ?? new Date().toISOString();

  switch (subtype) {
    case "message": {
      const role = payload.role;
      const content = payload.content;

      if (role === "user" || role === "assistant") {
        let text = "";
        if (Array.isArray(content)) {
          text = extractContentFromBlocks(content);
        } else if (typeof content === "string") {
          text = content;
        }

        if (text) {
          accum.messages.push({
            role: role === "user" ? "user" : "assistant",
            content: text,
            model: role === "assistant" ? (accum.lastModel ?? undefined) : undefined,
            timestamp: ts,
          });
        }
      }
      // developer messages are system prompts — skip for conversation content
      break;
    }
    case "function_call": {
      const name =
        typeof payload.name === "string" ? payload.name : undefined;
      const args =
        typeof payload.arguments === "string"
          ? payload.arguments
          : undefined;
      accum.messages.push({
        role: "tool",
        content: "",
        toolName: name,
        toolInput: args,
        timestamp: ts,
      });
      break;
    }
    case "function_call_output": {
      const output =
        typeof payload.output === "string" ? payload.output : "";
      accum.messages.push({
        role: "tool",
        content: output,
        toolResult: output,
        timestamp: ts,
      });
      break;
    }
    // reasoning → skip (encrypted/summary thinking)
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

  const sessionKey = `codex:${accum.sessionId}`;

  const canonical: CanonicalSession = {
    sessionKey,
    source: "codex",
    parserRevision: PARSER_REVISION,
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    lastMessageAt,
    durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
    projectRef: extractProjectRef(accum.cwd),
    projectName: extractProjectName(accum.cwd),
    model: accum.lastModel,
    title: null,
    messages: accum.messages,
    totalInputTokens: accum.totalInputTokens,
    totalOutputTokens: accum.totalOutputTokens,
    totalCachedTokens: accum.totalCachedTokens,
    snapshotAt: new Date().toISOString(),
  };

  const raw: RawSessionArchive = {
    sessionKey,
    source: "codex",
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
  const sessionId = extractSessionIdFromFilename(filePath) ?? "unknown";
  const sessionKey = `codex:${sessionId}`;

  return {
    canonical: {
      sessionKey,
      source: "codex",
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
      sessionKey,
      source: "codex",
      parserRevision: PARSER_REVISION,
      collectedAt: now,
      sourceFiles: [{ path: filePath, format: "jsonl", content: "" }],
    },
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Parse a single Codex CLI rollout JSONL file.
 *
 * Each file corresponds to a single session. The session ID is extracted
 * from the `session_meta` event's `payload.id`, falling back to the
 * UUID in the filename.
 */
export async function parseCodexFile(
  filePath: string,
  startOffset = 0,
): Promise<ParseResult> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return buildEmptyResult(filePath);

  if (startOffset >= st.size) return buildEmptyResult(filePath);

  // Default session ID from filename; session_meta may override it
  const filenameId = extractSessionIdFromFilename(filePath) ?? "unknown";

  const accum: SessionAccum = {
    sessionId: filenameId,
    messages: [],
    lines: [],
    startedAt: null,
    lastMessageAt: null,
    lastModel: null,
    cwd: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
  };

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;
      processLine(line, accum);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (accum.messages.length === 0) return buildEmptyResult(filePath);

  return buildParseResult(accum, filePath);
}
