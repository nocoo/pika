/**
 * VSCode Copilot parser.
 *
 * Reads CRDT-style JSONL files from VSCode's workspace/global storage,
 * reconstructs session state via append-only operations, and extracts
 * full conversation content (messages, tool calls, token usage).
 *
 * File format: one JSON object per line (CRDT operations):
 * - kind=0 (Snapshot): Full initial session state. Contains `v.sessionId`,
 *   `v.creationDate`, `v.requests[]`. Always the first line.
 * - kind=1 (Set): Overwrite value at JSON path `k`. Key paths include:
 *   `["customTitle"]`, `["requests", N, "result"]` (tokens),
 *   `["requests", N, "modelState"]` (completion status),
 *   `["inputState", "selectedModel"]` (model).
 * - kind=2 (Append): Append to array at path `k`. Key paths include:
 *   `["requests"]` (new user turn), `["requests", N, "response"]`
 *   (assistant response chunks).
 *
 * Response chunk types (within response elements):
 * - No kind / text: `{value: "text"}` — assistant text
 * - kind "thinking": reasoning (skipped)
 * - kind "toolInvocationSerialized": tool call with `toolId`, `invocationMessage`
 *
 * Result (set via kind=1): `{timings, metadata: {promptTokens, outputTokens}}`
 * ModelState: `{value: 0|1|3, completedAt}` (0=pending, 1=completed, 3=error)
 *
 * Session key: `copilot:{sessionId}`
 * Project ref: SHA-256 hash of workspace folder from sibling workspace.json
 */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/** A single CRDT operation line from the JSONL file. */
interface CrdtOp {
  /** 0=Snapshot, 1=Set, 2=Append */
  kind: number;
  /** JSON path (array of string/number segments) — for kind=1,2 */
  k?: (string | number)[];
  /** Value to set/append — for kind=1,2 */
  v?: unknown;
}

/** A single user request (turn) in the reconstructed session. */
interface CopilotRequest {
  requestId?: string;
  timestamp?: number;
  modelId?: string;
  message?: { text?: string };
  response?: ResponseChunk[];
  result?: RequestResult;
  modelState?: { value?: number; completedAt?: string };
}

/** A response chunk from the assistant. */
interface ResponseChunk {
  value?: string;
  kind?: string;
  toolId?: string;
  invocationMessage?: string;
  toolCallId?: string;
  result?: string;
}

/** Token usage metadata attached to a completed request. */
interface RequestResult {
  timings?: unknown;
  metadata?: {
    promptTokens?: number;
    outputTokens?: number;
    toolCallRounds?: unknown[];
  };
}

/** Reconstructed session state from CRDT replay. */
interface SessionState {
  sessionId: string | null;
  creationDate: string | null;
  customTitle: string | null;
  selectedModel: string | null;
  requests: CopilotRequest[];
}

interface SessionAccum {
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  lastModel: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────

function toNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return 0;
  return Math.floor(value);
}

// ── CRDT Replay ─────────────────────────────────────────────────

/**
 * Apply a snapshot operation (kind=0) to initialize session state.
 */
function applySnapshot(op: CrdtOp, state: SessionState): void {
  const v = op.v as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return;

  if (typeof v.sessionId === "string") {
    state.sessionId = v.sessionId;
  }
  if (typeof v.creationDate === "string") {
    state.creationDate = v.creationDate;
  }
  if (typeof v.customTitle === "string") {
    state.customTitle = v.customTitle;
  }

  // Extract requests from snapshot
  if (Array.isArray(v.requests)) {
    for (const req of v.requests) {
      if (req && typeof req === "object") {
        state.requests.push(normalizeRequest(req as Record<string, unknown>));
      }
    }
  }

  // Extract selected model from inputState
  const inputState = v.inputState as Record<string, unknown> | undefined;
  if (inputState && typeof inputState.selectedModel === "string") {
    state.selectedModel = inputState.selectedModel;
  }
}

/**
 * Normalize a raw request object into our typed structure.
 */
function normalizeRequest(raw: Record<string, unknown>): CopilotRequest {
  return {
    requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : undefined,
    modelId: typeof raw.modelId === "string" ? raw.modelId : undefined,
    message: raw.message as CopilotRequest["message"],
    response: Array.isArray(raw.response)
      ? (raw.response as ResponseChunk[])
      : [],
    result: raw.result as RequestResult | undefined,
    modelState: raw.modelState as CopilotRequest["modelState"],
  };
}

/**
 * Apply a set operation (kind=1) to update a value at a JSON path.
 */
function applySet(op: CrdtOp, state: SessionState): void {
  const k = op.k;
  if (!Array.isArray(k) || k.length === 0) return;

  // Top-level sets
  if (k.length === 1 && k[0] === "customTitle") {
    if (typeof op.v === "string") {
      state.customTitle = op.v;
    }
    return;
  }

  // inputState.selectedModel
  if (
    k.length === 2 &&
    k[0] === "inputState" &&
    k[1] === "selectedModel"
  ) {
    if (typeof op.v === "string") {
      state.selectedModel = op.v;
    }
    return;
  }

  // requests[N].result or requests[N].modelState
  if (k.length === 3 && k[0] === "requests" && typeof k[1] === "number") {
    const idx = k[1];
    if (idx < 0 || idx >= state.requests.length) return;

    const field = k[2];
    if (field === "result") {
      state.requests[idx].result = op.v as RequestResult;
    } else if (field === "modelState") {
      state.requests[idx].modelState = op.v as CopilotRequest["modelState"];
    }
    return;
  }
}

/**
 * Apply an append operation (kind=2) to append to an array at a JSON path.
 */
function applyAppend(op: CrdtOp, state: SessionState): void {
  const k = op.k;
  if (!Array.isArray(k) || k.length === 0) return;

  // Append to top-level requests array
  if (k.length === 1 && k[0] === "requests") {
    if (op.v && typeof op.v === "object" && !Array.isArray(op.v)) {
      state.requests.push(
        normalizeRequest(op.v as Record<string, unknown>),
      );
    }
    return;
  }

  // Append to requests[N].response
  if (
    k.length === 3 &&
    k[0] === "requests" &&
    typeof k[1] === "number" &&
    k[2] === "response"
  ) {
    const idx = k[1];
    if (idx < 0 || idx >= state.requests.length) return;

    const req = state.requests[idx];
    if (!req.response) req.response = [];

    if (op.v && typeof op.v === "object") {
      req.response.push(op.v as ResponseChunk);
    }
    return;
  }
}

/**
 * Replay all CRDT operations to reconstruct session state.
 */
function replayCrdt(ops: CrdtOp[]): SessionState {
  const state: SessionState = {
    sessionId: null,
    creationDate: null,
    customTitle: null,
    selectedModel: null,
    requests: [],
  };

  for (const op of ops) {
    switch (op.kind) {
      case 0:
        applySnapshot(op, state);
        break;
      case 1:
        applySet(op, state);
        break;
      case 2:
        applyAppend(op, state);
        break;
    }
  }

  return state;
}

// ── Message extraction ──────────────────────────────────────────

/**
 * Extract canonical messages from a single request (user turn + assistant response).
 */
function extractRequestMessages(
  req: CopilotRequest,
  fallbackModel: string | null,
  accum: SessionAccum,
): void {
  const ts = req.timestamp
    ? new Date(req.timestamp).toISOString()
    : new Date().toISOString();

  const model = req.modelId ?? fallbackModel ?? undefined;
  if (req.modelId) accum.lastModel = req.modelId;

  // User message
  const userText = req.message?.text;
  if (typeof userText === "string" && userText.length > 0) {
    accum.messages.push({
      role: "user",
      content: userText,
      timestamp: ts,
    });
  }

  // Assistant response chunks
  if (Array.isArray(req.response)) {
    const textParts: string[] = [];

    for (const chunk of req.response) {
      if (!chunk || typeof chunk !== "object") continue;

      if (chunk.kind === "thinking") {
        // Skip reasoning chunks
        continue;
      }

      if (chunk.kind === "toolInvocationSerialized") {
        // Flush text before tool
        if (textParts.length > 0) {
          accum.messages.push({
            role: "assistant",
            content: textParts.join(""),
            model,
            timestamp: ts,
          });
          textParts.length = 0;
        }

        // Tool invocation
        accum.messages.push({
          role: "tool",
          content: "",
          toolName: typeof chunk.toolId === "string" ? chunk.toolId : undefined,
          toolInput:
            typeof chunk.invocationMessage === "string"
              ? chunk.invocationMessage
              : undefined,
          timestamp: ts,
        });

        // Tool result
        if (typeof chunk.result === "string" && chunk.result.length > 0) {
          accum.messages.push({
            role: "tool",
            content: chunk.result,
            toolName:
              typeof chunk.toolId === "string" ? chunk.toolId : undefined,
            toolResult: chunk.result,
            timestamp: ts,
          });
        }
        continue;
      }

      // Text chunk (no kind or unrecognized kind)
      if (typeof chunk.value === "string") {
        textParts.push(chunk.value);
      }
    }

    // Flush remaining text
    if (textParts.length > 0) {
      accum.messages.push({
        role: "assistant",
        content: textParts.join(""),
        model,
        timestamp: ts,
      });
    }
  }

  // Token usage from result
  if (req.result?.metadata) {
    accum.totalInputTokens += toNonNegInt(req.result.metadata.promptTokens);
    accum.totalOutputTokens += toNonNegInt(req.result.metadata.outputTokens);
  }
}

// ── Project ref extraction ──────────────────────────────────────

/**
 * Extract workspace folder from the workspace.json sibling file.
 *
 * VSCode stores workspace info at:
 *   workspaceStorage/{hash}/workspace.json → {folder: "file:///path/to/project"}
 *
 * Returns the decoded folder path, or null if not found.
 */
export async function extractWorkspaceFolder(
  sessionFilePath: string,
): Promise<string | null> {
  try {
    // For workspace sessions: chatSessions/*.jsonl sits beside workspace.json
    // Layout: workspaceStorage/{hash}/chatSessions/foo.jsonl
    //   → workspaceStorage/{hash}/workspace.json
    const chatSessionsDir = dirname(sessionFilePath);
    const workspaceDir = dirname(chatSessionsDir);
    const workspaceJsonPath = join(workspaceDir, "workspace.json");

    const content = await readFile(workspaceJsonPath, "utf8");
    const data = JSON.parse(content);

    if (typeof data?.folder === "string") {
      // Strip file:// prefix
      const folder = data.folder.replace(/^file:\/\//, "");
      return decodeURIComponent(folder) || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract project reference (privacy-hashed) from workspace folder.
 */
export function extractProjectRef(folder: string | null): string | null {
  if (!folder) return null;
  return hashProjectRef(folder);
}

/**
 * Extract human-readable project name from workspace folder path.
 * Returns the last path segment.
 */
export function extractProjectName(folder: string | null): string | null {
  if (!folder) return null;
  const parts = folder.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

// ── Session building ────────────────────────────────────────────

function buildParseResult(
  state: SessionState,
  accum: SessionAccum,
  filePath: string,
  rawContent: string,
  workspaceFolder: string | null,
): ParseResult {
  const sessionId = state.sessionId ?? "unknown";
  const sessionKey = `copilot:${sessionId}`;

  // Compute timestamps
  let startedAt: string;
  let lastMessageAt: string;

  if (state.creationDate) {
    startedAt = state.creationDate;
  } else if (state.requests.length > 0 && state.requests[0].timestamp) {
    startedAt = new Date(state.requests[0].timestamp).toISOString();
  } else {
    startedAt = new Date().toISOString();
  }

  // Find the last request's timestamp or completedAt
  const lastReq = state.requests[state.requests.length - 1];
  if (lastReq?.modelState?.completedAt) {
    lastMessageAt = lastReq.modelState.completedAt;
  } else if (lastReq?.timestamp) {
    lastMessageAt = new Date(lastReq.timestamp).toISOString();
  } else {
    lastMessageAt = startedAt;
  }

  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  const canonical: CanonicalSession = {
    sessionKey,
    source: "vscode-copilot",
    parserRevision: PARSER_REVISION,
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    lastMessageAt,
    durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
    projectRef: extractProjectRef(workspaceFolder),
    projectName: extractProjectName(workspaceFolder),
    model: accum.lastModel ?? state.selectedModel,
    title: state.customTitle,
    messages: accum.messages,
    totalInputTokens: accum.totalInputTokens,
    totalOutputTokens: accum.totalOutputTokens,
    totalCachedTokens: 0,
    snapshotAt: new Date().toISOString(),
  };

  const raw: RawSessionArchive = {
    sessionKey,
    source: "vscode-copilot",
    parserRevision: PARSER_REVISION,
    collectedAt: new Date().toISOString(),
    sourceFiles: [
      {
        path: filePath,
        format: "jsonl",
        content: rawContent,
      },
    ],
  };

  return { canonical, raw };
}

function buildEmptyResult(filePath: string): ParseResult {
  const now = new Date().toISOString();
  const sessionKey = "copilot:unknown";

  return {
    canonical: {
      sessionKey,
      source: "vscode-copilot",
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
      source: "vscode-copilot",
      parserRevision: PARSER_REVISION,
      collectedAt: now,
      sourceFiles: [{ path: filePath, format: "jsonl", content: "" }],
    },
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Parse CRDT operations from a JSONL buffer into an array of CrdtOp.
 *
 * Exported for testing and for the session driver to use with byte offsets.
 */
export function parseCrdtOps(content: string): CrdtOp[] {
  const ops: CrdtOp[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.kind === "number") {
        ops.push(parsed as CrdtOp);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return ops;
}

/**
 * Replay CRDT operations and extract session state.
 *
 * Exported for testing and driver reuse.
 */
export { replayCrdt };

/**
 * Extract messages from a reconstructed session state.
 *
 * Processes only requests whose IDs are NOT in `processedIds` (for incremental parsing).
 * Returns the accumulator and the set of newly processed request IDs.
 */
export function extractMessages(
  state: SessionState,
  processedIds: Set<string> = new Set(),
): { accum: SessionAccum; newRequestIds: string[] } {
  const accum: SessionAccum = {
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastModel: state.selectedModel,
  };

  const newRequestIds: string[] = [];

  for (const req of state.requests) {
    const id = req.requestId;
    if (id && processedIds.has(id)) continue;

    extractRequestMessages(req, state.selectedModel, accum);
    if (id) newRequestIds.push(id);
  }

  return { accum, newRequestIds };
}

/**
 * Parse a single VSCode Copilot CRDT JSONL file.
 *
 * Each file corresponds to a single session. The CRDT operations are
 * replayed to reconstruct the full session state, then messages are
 * extracted from the reconstructed state.
 *
 * @param filePath - Path to the .jsonl file
 * @param startOffset - Byte offset to start reading from (for incremental parsing)
 * @param processedRequestIds - Previously processed request IDs (for dedup)
 * @param workspaceFolder - Pre-resolved workspace folder (null for global sessions)
 */
export async function parseVscodeCopilotFile(
  filePath: string,
  startOffset = 0,
  processedRequestIds: string[] = [],
  workspaceFolder: string | null = null,
): Promise<ParseResult> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return buildEmptyResult(filePath);

  if (startOffset >= st.size) return buildEmptyResult(filePath);

  // Read file content
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf8");
  } catch {
    return buildEmptyResult(filePath);
  }

  // Parse CRDT operations
  // IMPORTANT: We always replay ALL operations from the beginning to rebuild
  // full state. The byte offset is used by the driver to know how much raw
  // content was already archived, but CRDT replay must be complete.
  const ops = parseCrdtOps(rawContent);
  if (ops.length === 0) return buildEmptyResult(filePath);

  // Replay CRDT to reconstruct session state
  const state = replayCrdt(ops);
  if (state.requests.length === 0) return buildEmptyResult(filePath);

  // Extract messages (skipping previously processed requests)
  const processedSet = new Set(processedRequestIds);
  const { accum, newRequestIds } = extractMessages(state, processedSet);

  if (accum.messages.length === 0) return buildEmptyResult(filePath);

  // Resolve workspace folder if not provided
  const folder = workspaceFolder ?? (await extractWorkspaceFolder(filePath));

  // Build result — only include raw content from startOffset onward
  const rawSlice = startOffset > 0 ? rawContent.slice(startOffset) : rawContent;

  return buildParseResult(state, accum, filePath, rawSlice, folder);
}
