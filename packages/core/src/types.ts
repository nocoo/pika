// ── Source types ────────────────────────────────────────────────

export const SOURCES = [
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
] as const;

export type Source = (typeof SOURCES)[number];

// ── Message roles ──────────────────────────────────────────────

export const MESSAGE_ROLES = ["user", "assistant", "tool", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

// ── Canonical data model ───────────────────────────────────────

export interface CanonicalMessage {
  role: MessageRole;
  content: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  timestamp: string;
}

export interface CanonicalSession {
  sessionKey: string;
  source: Source;
  parserRevision: number;
  schemaVersion: number;
  startedAt: string;
  lastMessageAt: string;
  durationSeconds: number;
  projectRef: string | null;
  projectName: string | null;
  model: string | null;
  title: string | null;
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  snapshotAt: string;
}

// ── Raw data model ─────────────────────────────────────────────

export const RAW_FORMATS = ["jsonl", "json", "sqlite-export"] as const;
export type RawFormat = (typeof RAW_FORMATS)[number];

export interface RawSourceFile {
  path: string;
  format: RawFormat;
  content: string;
}

export interface RawSessionArchive {
  sessionKey: string;
  source: Source;
  parserRevision: number;
  collectedAt: string;
  sourceFiles: RawSourceFile[];
}

// ── Parse result ───────────────────────────────────────────────

export interface ParseResult {
  canonical: CanonicalSession;
  raw: RawSessionArchive;
}

// ── Parse error ────────────────────────────────────────────────

export interface ParseError {
  timestamp: string;
  source: Source;
  filePath: string;
  line?: number;
  error: string;
  sessionKey?: string;
}

// ── File cursor types ──────────────────────────────────────────

/** Base fields for all per-file cursors (change detection triple-check) */
export interface FileCursorBase {
  /** File inode for detecting file rotation/replacement */
  inode: number;
  /** File mtime in ms (for fast-skip change detection) */
  mtimeMs: number;
  /** File size in bytes (for fast-skip change detection) */
  size: number;
  /** ISO 8601 timestamp of last cursor update */
  updatedAt: string;
}

/** Claude Code: byte-offset into JSONL file */
export interface ClaudeCursor extends FileCursorBase {
  offset: number;
}

/** Codex CLI: byte-offset + cumulative token totals for diffing */
export interface CodexCursor extends FileCursorBase {
  offset: number;
  lastTotalTokens: number;
  lastModel: string | null;
}

/** Gemini CLI: array index into messages[] + cumulative totals */
export interface GeminiCursor extends FileCursorBase {
  messageIndex: number;
  lastTotalTokens: number;
  lastModel: string | null;
}

/** OpenCode JSON: dir-level mtime + per-file cursors */
export interface OpenCodeCursor extends FileCursorBase {
  /** Nothing beyond FileCursorBase needed per file */
}

/** OpenCode SQLite: watermark-based cursor */
export interface OpenCodeSqliteCursor {
  /** Database file inode for detecting replacement */
  inode: number;
  /** Last processed message timestamp for watermark queries */
  lastTimeCreated: string;
  /** ISO 8601 timestamp of last cursor update */
  updatedAt: string;
}

/** VSCode Copilot: byte-offset + CRDT reconstruction state */
export interface VscodeCopilotCursor extends FileCursorBase {
  offset: number;
  /** Set of processed request IDs for dedup */
  processedRequestIds: string[];
}

/** Union of all per-file cursor types */
export type FileCursor =
  | ClaudeCursor
  | CodexCursor
  | GeminiCursor
  | OpenCodeCursor
  | VscodeCopilotCursor;

/** Top-level cursor store persisted to ~/.config/pika/cursors.json */
export interface CursorState {
  version: 1;
  /** Per-file cursors, keyed by absolute file path */
  files: Record<string, FileCursor>;
  /** Directory-level mtimeMs cache for fast skip (OpenCode JSON optimization) */
  dirMtimes?: Record<string, number>;
  /** OpenCode SQLite database cursor */
  openCodeSqlite?: OpenCodeSqliteCursor;
  /** ISO 8601 timestamp of last cursor update */
  updatedAt: string | null;
}

// ── Session snapshot (upload payload) ──────────────────────────

export interface SessionSnapshot {
  sessionKey: string;
  source: Source;
  startedAt: string;
  lastMessageAt: string;
  durationSeconds: number;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  projectRef: string | null;
  projectName: string | null;
  model: string | null;
  title: string | null;
  contentHash: string;
  rawHash: string;
  parserRevision: number;
  schemaVersion: number;
  snapshotAt: string;
}
