/**
 * Gemini CLI parser.
 *
 * Reads JSON session files from ~/.gemini/tmp/{projectHash}/chats/session-*.json,
 * extracts full conversation content (messages, tool calls, token usage), and
 * produces both canonical (CanonicalSession) and raw (RawSessionArchive) outputs.
 *
 * File format: Single JSON object per file with top-level fields:
 * - "sessionId": UUID string
 * - "projectHash": SHA-256 hash string
 * - "startTime": ISO 8601 timestamp
 * - "lastUpdated": ISO 8601 timestamp
 * - "messages[]": array of message objects
 *
 * Message types (discriminated by "type" field):
 * - "user": { content: [{text: "..."}], timestamp }
 * - "gemini": { content: "...", model, tokens, toolCalls[], thoughts[], timestamp }
 * - "info": system info messages (login prompts, etc.) — skipped
 *
 * Token usage: per-message on gemini messages, summed across all turns.
 * Session key: `gemini:{sessionId}`
 */

import { readFile, stat } from "node:fs/promises";
import { PARSER_REVISION, SCHEMA_VERSION } from "@pika/core";
import type {
  CanonicalMessage,
  CanonicalSession,
  RawSessionArchive,
  ParseResult,
} from "@pika/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";

// ── Types ───────────────────────────────────────────────────────

interface GeminiTokens {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
  total?: number;
}

interface GeminiToolCallResult {
  functionResponse?: {
    id?: string;
    name?: string;
    response?: { output?: string };
  };
}

interface GeminiToolCall {
  name?: string;
  displayName?: string;
  status?: string;
  args?: Record<string, unknown>;
  result?: GeminiToolCallResult[];
  id?: string;
  timestamp?: string;
}

interface GeminiUserContent {
  text?: string;
}

interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type: string;
  content?: unknown; // string for gemini, array for user
  model?: string;
  tokens?: GeminiTokens;
  toolCalls?: GeminiToolCall[];
  thoughts?: unknown[];
}

interface GeminiSession {
  sessionId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
}

// ── Helpers ─────────────────────────────────────────────────────

function toNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return 0;
  return Math.floor(value);
}

/**
 * Extract text content from a user message's content array.
 */
function extractUserContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      "text" in item &&
      typeof (item as GeminiUserContent).text === "string"
    ) {
      parts.push((item as GeminiUserContent).text!);
    }
  }
  return parts.join("\n");
}

/**
 * Extract project ref from Gemini's projectHash.
 * We re-hash through hashProjectRef for consistent 16-char format.
 */
export function extractProjectRef(
  projectHash: string | null | undefined,
): string | null {
  if (!projectHash) return null;
  return hashProjectRef(projectHash);
}

/**
 * Extract project name from the Gemini projectHash.
 * Gemini only provides a hash, so we don't have a human-readable name.
 * Returns null — the project name is unknown.
 */
export function extractProjectName(
  _projectHash: string | null | undefined,
): string | null {
  return null;
}

// ── Message processing ──────────────────────────────────────────

interface SessionAccum {
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  lastModel: string | null;
}

function processUserMessage(
  msg: GeminiMessage,
  accum: SessionAccum,
): void {
  const text = extractUserContent(msg.content);
  if (!text) return;

  accum.messages.push({
    role: "user",
    content: text,
    timestamp: msg.timestamp ?? new Date().toISOString(),
  });
}

function processGeminiMessage(
  msg: GeminiMessage,
  accum: SessionAccum,
): void {
  const ts = msg.timestamp ?? new Date().toISOString();

  // Track model
  if (typeof msg.model === "string") {
    accum.lastModel = msg.model;
  }

  // Process main text content (assistant reply)
  if (typeof msg.content === "string" && msg.content.length > 0) {
    accum.messages.push({
      role: "assistant",
      content: msg.content,
      model: msg.model ?? accum.lastModel ?? undefined,
      timestamp: ts,
    });
  }

  // Process tool calls
  if (Array.isArray(msg.toolCalls)) {
    for (const tc of msg.toolCalls) {
      processToolCall(tc, accum, ts);
    }
  }

  // Accumulate tokens (per-turn values)
  if (msg.tokens) {
    accum.totalInputTokens += toNonNegInt(msg.tokens.input);
    accum.totalOutputTokens += toNonNegInt(msg.tokens.output);
    accum.totalCachedTokens += toNonNegInt(msg.tokens.cached);
  }
}

function processToolCall(
  tc: GeminiToolCall,
  accum: SessionAccum,
  parentTs: string,
): void {
  const ts = tc.timestamp ?? parentTs;
  const toolName = tc.name ?? tc.displayName;

  // Tool invocation
  accum.messages.push({
    role: "tool",
    content: "",
    toolName: toolName ?? undefined,
    toolInput: tc.args ? JSON.stringify(tc.args) : undefined,
    timestamp: ts,
  });

  // Tool result
  if (Array.isArray(tc.result)) {
    for (const item of tc.result) {
      const output = item.functionResponse?.response?.output;
      if (typeof output === "string") {
        accum.messages.push({
          role: "tool",
          content: output,
          toolName: toolName ?? undefined,
          toolResult: output,
          timestamp: ts,
        });
      }
    }
  }
}

// ── Session building ────────────────────────────────────────────

function buildParseResult(
  session: GeminiSession,
  accum: SessionAccum,
  filePath: string,
  rawContent: string,
): ParseResult {
  const sessionId = session.sessionId ?? "unknown";
  const sessionKey = `gemini:${sessionId}`;
  const startedAt = session.startTime ?? new Date().toISOString();
  const lastMessageAt = session.lastUpdated ?? startedAt;
  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  const canonical: CanonicalSession = {
    sessionKey,
    source: "gemini-cli",
    parserRevision: PARSER_REVISION,
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    lastMessageAt,
    durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
    projectRef: extractProjectRef(session.projectHash),
    projectName: extractProjectName(session.projectHash),
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
    source: "gemini-cli",
    parserRevision: PARSER_REVISION,
    collectedAt: new Date().toISOString(),
    sourceFiles: [
      {
        path: filePath,
        format: "json",
        content: rawContent,
      },
    ],
  };

  return { canonical, raw };
}

function buildEmptyResult(filePath: string): ParseResult {
  const now = new Date().toISOString();
  const sessionKey = "gemini:unknown";

  return {
    canonical: {
      sessionKey,
      source: "gemini-cli",
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
      source: "gemini-cli",
      parserRevision: PARSER_REVISION,
      collectedAt: now,
      sourceFiles: [{ path: filePath, format: "json", content: "" }],
    },
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Parse a single Gemini CLI session JSON file.
 *
 * Each file corresponds to a single session. The session ID comes from
 * the top-level `sessionId` field.
 *
 * @param startIndex - Start processing messages from this index (for incremental parsing)
 */
export async function parseGeminiFile(
  filePath: string,
  startIndex = 0,
): Promise<ParseResult> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return buildEmptyResult(filePath);

  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf8");
  } catch {
    return buildEmptyResult(filePath);
  }

  let session: GeminiSession;
  try {
    session = JSON.parse(rawContent);
  } catch {
    return buildEmptyResult(filePath);
  }

  if (!session || typeof session !== "object") return buildEmptyResult(filePath);

  const messages = session.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return buildEmptyResult(filePath);
  }

  const accum: SessionAccum = {
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    lastModel: null,
  };

  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
      continue;
    }

    switch (msg.type) {
      case "user":
        processUserMessage(msg, accum);
        break;
      case "gemini":
        processGeminiMessage(msg, accum);
        break;
      // "info" and other types are skipped
    }
  }

  if (accum.messages.length === 0) return buildEmptyResult(filePath);

  return buildParseResult(session, accum, filePath, rawContent);
}
