/**
 * OpenCode parser.
 *
 * Reads OpenCode session data from two possible sources:
 * 1. JSON files: ~/.local/share/opencode/storage/{session,message,part}/
 * 2. SQLite DB: ~/.local/share/opencode/opencode.db
 *
 * Data layout:
 * - Session JSON: metadata only (id, projectID, directory, title, time)
 * - Message JSON: metadata (id, sessionID, role, time, tokens, modelID)
 * - Part JSON: actual content (text, tool calls, reasoning, patches, etc.)
 *
 * Part types (discriminated by "type" field):
 * - "text": text content (user prompt or assistant reply)
 * - "tool": tool invocation with state.status, state.input, state.output
 * - "reasoning": chain-of-thought (skipped)
 * - "step-start" / "step-finish": step boundaries (skipped)
 * - "patch": file patches (skipped)
 * - "file": embedded files (skipped)
 * - "compaction": context compaction markers (skipped)
 *
 * Token usage: per-message on assistant messages (tokens.input, tokens.output,
 * tokens.cache.read), summed across all turns.
 * Session key: `opencode:{sessionID}`
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { PARSER_REVISION, SCHEMA_VERSION } from "@pika/core";
import type {
  CanonicalMessage,
  CanonicalSession,
  RawSessionArchive,
  ParseResult,
} from "@pika/core";
import { hashProjectRef } from "../utils/hash-project-ref";

// ── Types ───────────────────────────────────────────────────────

/** OpenCode session metadata (from session JSON or SQLite session table). */
export interface OcSession {
  id: string;
  projectID?: string;
  directory?: string;
  title?: string;
  time?: { created?: number; updated?: number };
}

/** OpenCode message metadata (from message JSON or SQLite message table). */
export interface OcMessage {
  id: string;
  sessionID?: string;
  role: string;
  time?: { created?: number; completed?: number };
  modelID?: string;
  providerID?: string;
  tokens?: OcTokens;
  /** Optional embedded parts (pre-loaded by driver) */
  parts?: OcPart[];
}

export interface OcTokens {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

/** OpenCode part (content unit within a message). */
export interface OcPart {
  id?: string;
  type: string;
  /** Text content for "text" parts */
  text?: string;
  /** Synthetic flag (system-injected text) */
  synthetic?: boolean;
  /** Tool call fields (for "tool" parts) */
  tool?: string;
  callID?: string;
  state?: OcToolState;
  /** Timing info */
  time?: { start?: number; end?: number };
  /** Part linkage */
  messageID?: string;
  sessionID?: string;
}

interface OcToolState {
  status?: string;
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  metadata?: { output?: string; exit?: number; truncated?: boolean };
  time?: { start?: number; end?: number };
}

// ── Helpers ─────────────────────────────────────────────────────

function toNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return 0;
  return Math.floor(value);
}

function msToIso(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return new Date().toISOString();
  }
  return new Date(ms).toISOString();
}

/**
 * Extract project ref from OpenCode's projectID.
 * Re-hash through hashProjectRef for consistent 16-char format.
 */
export function extractProjectRef(
  projectId: string | null | undefined,
): string | null {
  if (!projectId) return null;
  return hashProjectRef(projectId);
}

/**
 * Extract project name from the session directory path.
 * Returns the last path component as a readable project name.
 */
export function extractProjectName(
  directory: string | null | undefined,
): string | null {
  if (!directory || typeof directory !== "string") return null;
  return directory;
}

// ── Part processing ─────────────────────────────────────────────

function processTextPart(
  part: OcPart,
  role: string,
  model: string | undefined,
  ts: string,
  accum: SessionAccum,
): void {
  if (!part.text || typeof part.text !== "string" || part.text.length === 0)
    return;

  // Skip synthetic parts (system-injected prompts)
  if (part.synthetic) return;

  const canonicalRole = role === "user" ? "user" : "assistant";
  accum.messages.push({
    role: canonicalRole,
    content: part.text,
    model: canonicalRole === "assistant" ? model : undefined,
    timestamp: ts,
  });
}

function processToolPart(
  part: OcPart,
  ts: string,
  accum: SessionAccum,
): void {
  if (!part.state) return;

  const toolName = part.tool ?? undefined;
  const input = part.state.input
    ? JSON.stringify(part.state.input)
    : undefined;

  // Only emit completed tool calls (with output)
  if (part.state.status === "completed") {
    const output =
      part.state.output ??
      part.state.metadata?.output ??
      "";

    // Tool invocation
    accum.messages.push({
      role: "tool",
      content: "",
      toolName,
      toolInput: input,
      timestamp: ts,
    });

    // Tool result
    if (typeof output === "string" && output.length > 0) {
      accum.messages.push({
        role: "tool",
        content: output,
        toolName,
        toolResult: output,
        timestamp: ts,
      });
    }
  } else if (part.state.status === "running") {
    // Emit just the invocation for running tools
    accum.messages.push({
      role: "tool",
      content: "",
      toolName,
      toolInput: input,
      timestamp: ts,
    });
  }
}

// ── Message processing ──────────────────────────────────────────

interface SessionAccum {
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  lastModel: string | null;
}

function processMessage(
  msg: OcMessage,
  parts: OcPart[],
  accum: SessionAccum,
): void {
  const ts = msToIso(msg.time?.created);
  const role = msg.role;

  // Track model from assistant messages
  if (role === "assistant" && typeof msg.modelID === "string") {
    accum.lastModel = msg.modelID;
  }

  // Process parts to build content
  const model = msg.modelID ?? accum.lastModel ?? undefined;
  for (const part of parts) {
    if (!part || typeof part !== "object" || typeof part.type !== "string")
      continue;

    switch (part.type) {
      case "text":
        processTextPart(part, role, model, ts, accum);
        break;
      case "tool":
        processToolPart(part, ts, accum);
        break;
      // Skip: reasoning, step-start, step-finish, patch, file, compaction
    }
  }

  // Accumulate tokens from assistant messages
  if (role === "assistant" && msg.tokens) {
    accum.totalInputTokens += toNonNegInt(msg.tokens.input);
    accum.totalOutputTokens += toNonNegInt(msg.tokens.output);
    accum.totalCachedTokens += toNonNegInt(msg.tokens.cache?.read);
  }
}

// ── Session building ────────────────────────────────────────────

function buildParseResult(
  session: OcSession,
  accum: SessionAccum,
  rawContent: string,
  rawFormat: "json" | "sqlite-export",
  rawPath: string,
): ParseResult {
  const sessionKey = `opencode:${session.id}`;
  const startedAt = msToIso(session.time?.created);
  const lastMessageAt = msToIso(session.time?.updated);
  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  const canonical: CanonicalSession = {
    sessionKey,
    source: "opencode",
    parserRevision: PARSER_REVISION,
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    lastMessageAt,
    durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
    projectRef: extractProjectRef(session.projectID),
    projectName: extractProjectName(session.directory),
    model: accum.lastModel,
    title: session.title ?? null,
    messages: accum.messages,
    totalInputTokens: accum.totalInputTokens,
    totalOutputTokens: accum.totalOutputTokens,
    totalCachedTokens: accum.totalCachedTokens,
    snapshotAt: new Date().toISOString(),
  };

  const raw: RawSessionArchive = {
    sessionKey,
    source: "opencode",
    parserRevision: PARSER_REVISION,
    collectedAt: new Date().toISOString(),
    sourceFiles: [
      {
        path: rawPath,
        format: rawFormat,
        content: rawContent,
      },
    ],
  };

  return { canonical, raw };
}

function buildEmptyResult(
  sessionId: string,
  rawPath: string,
): ParseResult {
  const now = new Date().toISOString();
  const sessionKey = `opencode:${sessionId}`;

  return {
    canonical: {
      sessionKey,
      source: "opencode",
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
      source: "opencode",
      parserRevision: PARSER_REVISION,
      collectedAt: now,
      sourceFiles: [{ path: rawPath, format: "json", content: "" }],
    },
  };
}

// ── JSON file loading ───────────────────────────────────────────

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadPartsForMessage(
  partDir: string,
  messageId: string,
): Promise<OcPart[]> {
  const msgPartDir = join(partDir, messageId);
  let entries: string[];
  try {
    entries = await readdir(msgPartDir);
  } catch {
    return [];
  }

  const parts: OcPart[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".json")) continue;
    const part = await loadJsonFile<OcPart>(join(msgPartDir, entry));
    if (part && typeof part.type === "string") {
      parts.push(part);
    }
  }
  return parts;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Parse pre-loaded OpenCode messages with their parts.
 *
 * This is the core parsing function used by both JSON and SQLite drivers.
 * It takes pre-loaded data and produces a ParseResult.
 *
 * @param session - Session metadata
 * @param messages - Messages with parts pre-loaded (sorted by time_created)
 * @param rawFormat - Source format indicator
 * @param rawPath - Path for raw archive attribution
 */
export function parseOpenCodeMessages(
  session: OcSession,
  messages: OcMessage[],
  rawFormat: "json" | "sqlite-export",
  rawPath: string,
): ParseResult {
  if (!messages || messages.length === 0) {
    return buildEmptyResult(session.id, rawPath);
  }

  const accum: SessionAccum = {
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    lastModel: null,
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || typeof msg.role !== "string")
      continue;

    const parts = msg.parts ?? [];
    processMessage(msg, parts, accum);
  }

  if (accum.messages.length === 0) {
    return buildEmptyResult(session.id, rawPath);
  }

  // Build raw content: JSON array of messages with inline parts
  const rawContent = JSON.stringify(messages);

  return buildParseResult(session, accum, rawContent, rawFormat, rawPath);
}

/**
 * Parse an OpenCode session from JSON files on disk.
 *
 * Reads session metadata, message files, and part files from the filesystem.
 * This function is intended for the OpenCode JSON file driver.
 *
 * @param sessionJsonPath - Path to the session JSON file
 * @param messageDir - Root message directory (~/.local/share/opencode/storage/message)
 * @param partDir - Root part directory (~/.local/share/opencode/storage/part)
 */
export async function parseOpenCodeJsonSession(
  sessionJsonPath: string,
  messageDir: string,
  partDir: string,
): Promise<ParseResult> {
  // Load session metadata
  const session = await loadJsonFile<OcSession>(sessionJsonPath);
  if (!session || typeof session !== "object" || !session.id) {
    return buildEmptyResult("unknown", sessionJsonPath);
  }

  // Discover message files for this session
  const sessionMsgDir = join(messageDir, session.id);
  let msgEntries: string[];
  try {
    msgEntries = await readdir(sessionMsgDir);
  } catch {
    return buildEmptyResult(session.id, sessionJsonPath);
  }

  // Load messages with their parts
  const messages: OcMessage[] = [];
  for (const entry of msgEntries.sort()) {
    if (!entry.endsWith(".json")) continue;
    const msgPath = join(sessionMsgDir, entry);
    const msg = await loadJsonFile<OcMessage>(msgPath);
    if (!msg || typeof msg.role !== "string") continue;

    // Load parts for this message
    msg.parts = await loadPartsForMessage(partDir, msg.id);
    messages.push(msg);
  }

  // Sort by creation time
  messages.sort(
    (a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0),
  );

  return parseOpenCodeMessages(session, messages, "json", sessionJsonPath);
}

/**
 * Parse OpenCode session from pre-queried SQLite rows.
 *
 * The driver queries the DB and passes structured data here.
 * This function just wraps parseOpenCodeMessages with sqlite-export format.
 *
 * @param session - Session metadata from SQLite
 * @param messages - Messages with parts pre-loaded
 * @param dbPath - Path to the SQLite DB file
 */
export function parseOpenCodeSqliteSession(
  session: OcSession,
  messages: OcMessage[],
  dbPath: string,
): ParseResult {
  return parseOpenCodeMessages(session, messages, "sqlite-export", dbPath);
}
