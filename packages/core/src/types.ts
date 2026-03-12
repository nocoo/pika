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
