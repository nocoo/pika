/**
 * Driver interfaces for the unified source driver architecture.
 *
 * Two driver kinds:
 * - File-based: discover -> for each file: stat -> shouldSkip -> resumeState -> parse -> buildCursor
 * - DB-based: single run() call (manages own DB lifecycle, watermark, dedup)
 *
 * These are CLI-internal contracts -- not shared across packages.
 * Parsers and discovery functions are unchanged; drivers are thin wrappers.
 */

import type {
  Source,
  FileCursorBase,
  FileCursor,
  ParseResult,
} from "@pika/core";
import type { FileFingerprint } from "../utils/file-changed";

// Re-export for convenience -- consumers import from drivers/types
export type { FileFingerprint } from "../utils/file-changed";

// ---------------------------------------------------------------------------
// SyncContext -- shared state bag for cross-driver communication
// ---------------------------------------------------------------------------

/**
 * Shared state bag passed to all drivers in a sync run.
 *
 * Drivers may read or write entries. The orchestrator creates the context
 * before the driver loop, passes it to every driver, and persists any
 * state that drivers deposited (e.g. dirMtimes -> CursorState).
 */
export interface SyncContext {
  /**
   * OpenCode cross-source dedup state.
   *
   * Deposited by the JSON driver after parsing each session.
   * Read by the SQLite driver to decide whether to skip or re-process.
   *
   * Key: sessionKey (e.g. "opencode:ses_001")
   * Value: { lastMessageAt, totalMessages } from the JSON parse result
   */
  openCodeSessionState?: Map<string, OpenCodeSessionInfo>;

  /**
   * Directory mtime cache for OpenCode JSON discovery optimization.
   * Read/written by the OpenCode JSON driver.
   * Persisted to CursorState.dirMtimes by the orchestrator.
   */
  dirMtimes?: Record<string, number>;
}

/**
 * Summary info from one OpenCode session parse, used for cross-source dedup.
 */
export interface OpenCodeSessionInfo {
  lastMessageAt: string;
  totalMessages: number;
}

// ---------------------------------------------------------------------------
// Discovery options
// ---------------------------------------------------------------------------

/**
 * Options passed to driver discover() methods.
 *
 * Each driver reads its relevant directory from this bag.
 * Drivers whose directory is absent return [].
 */
export interface DiscoverOpts {
  claudeDir?: string;
  codexSessionsDir?: string;
  geminiDir?: string;
  openCodeMessageDir?: string;
  openCodeDbPath?: string;
  vscodeCopilotDirs?: string[];
}

// ---------------------------------------------------------------------------
// Resume state -- driver-specific incremental parsing state
// ---------------------------------------------------------------------------

/**
 * Resume state for byte-offset JSONL parsers (Claude, Codex).
 */
export interface ByteOffsetResumeState {
  readonly kind: "byte-offset";
  startOffset: number;
}

/**
 * Resume state for array-index JSON parsers (Gemini).
 */
export interface ArrayIndexResumeState {
  readonly kind: "array-index";
  startIndex: number;
  lastTotalTokens: number;
  lastModel: string | null;
}

/**
 * Resume state for Codex (byte-offset + cumulative diff state).
 */
export interface CodexResumeState {
  readonly kind: "codex";
  startOffset: number;
  lastTotalTokens: number;
  lastModel: string | null;
}

/**
 * Resume state for OpenCode JSON per-file parser.
 */
export interface OpenCodeJsonResumeState {
  readonly kind: "opencode-json";
}

/**
 * Resume state for VSCode Copilot CRDT JSONL files.
 * Carries byte offset + persisted request metadata for cross-line correlation.
 */
export interface VscodeCopilotResumeState {
  readonly kind: "vscode-copilot";
  startOffset: number;
  processedRequestIds: string[];
}

/**
 * Union of all resume state variants.
 * Discriminated by `kind` so drivers can narrow safely.
 */
export type ResumeState =
  | ByteOffsetResumeState
  | ArrayIndexResumeState
  | CodexResumeState
  | OpenCodeJsonResumeState
  | VscodeCopilotResumeState;

// ---------------------------------------------------------------------------
// File-based session driver
// ---------------------------------------------------------------------------

/**
 * Session driver for file-based sources.
 *
 * The generic loop is:
 *   discover -> for each file: stat -> shouldSkip -> resumeState -> parse -> buildCursor
 *
 * TCursor is source-specific (ClaudeCursor, CodexCursor, etc.)
 * and must extend FileCursorBase.
 */
export interface FileDriver<TCursor extends FileCursorBase = FileCursorBase> {
  readonly source: Source;

  /** Discover candidate files for this source */
  discover(opts: DiscoverOpts): Promise<string[]>;

  /** Fast skip: has this file changed since last cursor? Uses fileUnchanged() internally. */
  shouldSkip(cursor: TCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Extract incremental resume state from cursor (offset, lastIndex, etc.) */
  resumeState(cursor: TCursor | undefined, fingerprint: FileFingerprint): ResumeState;

  /** Parse file from resume point, return all sessions found */
  parse(filePath: string, resume: ResumeState): Promise<ParseResult[]>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint, results: ParseResult[]): TCursor;
}

// ---------------------------------------------------------------------------
// DB-based driver
// ---------------------------------------------------------------------------

/**
 * Result from a DB driver's run() method.
 */
export interface DbDriverResult<TCursor> {
  results: ParseResult[];
  cursor: TCursor;
  /** Number of raw rows queried (for progress reporting) */
  rowCount: number;
}

/**
 * Driver for DB-query sources (OpenCode SQLite).
 *
 * NOT part of the generic file loop. The orchestrator calls run() directly.
 * The driver manages its own DB handle lifecycle, watermark, and dedup.
 */
export interface DbDriver<TCursor = unknown> {
  readonly source: Source;

  /**
   * Execute the full DB sync cycle:
   *   open -> query -> parse -> return results + new cursor.
   *
   * Reads cross-driver state (messageKeys) from ctx for dedup.
   */
  run(prevCursor: TCursor | undefined, ctx: SyncContext): Promise<DbDriverResult<TCursor>>;
}

// ---------------------------------------------------------------------------
// Union types for the registry
// ---------------------------------------------------------------------------

/** Any driver (file or DB) */
export type Driver = FileDriver<FileCursorBase> | DbDriver;
