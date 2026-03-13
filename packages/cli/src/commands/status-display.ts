/**
 * Status display logic — pure functions for `pika status`.
 *
 * Extracted from the command for testability. All I/O is injected via params.
 */

import type { CursorState, ParseError, Source } from "@pika/core";
import { SOURCES } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface StatusInput {
  /** Whether the user is logged in */
  loggedIn: boolean;
  /** Cursor state loaded from disk */
  cursorState: CursorState;
  /** Parse errors loaded from disk (newest first, already limited) */
  parseErrors: ParseError[];
}

export interface SourceStats {
  source: Source;
  fileCount: number;
}

export interface StatusOutput {
  /** Login status line */
  loggedIn: boolean;
  /** Last sync time (ISO string or null if never synced) */
  lastSyncAt: string | null;
  /** Time elapsed since last sync (human-readable) */
  lastSyncAgo: string | null;
  /** Per-source file counts */
  sourceStats: SourceStats[];
  /** Total tracked files across all sources */
  totalFiles: number;
  /** Whether an OpenCode SQLite cursor exists */
  hasOpenCodeDb: boolean;
  /** Total parse error count */
  parseErrorCount: number;
  /** Last N parse errors (already limited by caller) */
  recentErrors: ParseError[];
}

// ── Source detection from file path ────────────────────────────

/**
 * Infer the Source from a cursor file path.
 *
 * Heuristic: match known path segments.
 */
export function inferSource(filePath: string): Source | null {
  if (filePath.includes(".claude/")) return "claude-code";
  if (filePath.includes(".codex/")) return "codex";
  if (filePath.includes(".gemini/")) return "gemini-cli";
  if (filePath.includes("opencode/") || filePath.includes("opencode\\")) return "opencode";
  if (filePath.includes("workspaceStorage/") || filePath.includes("globalStorage/")) return "vscode-copilot";
  return null;
}

// ── Time formatting ────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable relative string.
 */
export function formatTimeAgo(ms: number): string {
  if (ms < 0) return "just now";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Core logic ─────────────────────────────────────────────────

/**
 * Build status output from inputs. Pure function, no I/O.
 *
 * @param input - Status input data
 * @param now - Current time (injectable for testing)
 */
export function buildStatus(input: StatusInput, now: Date = new Date()): StatusOutput {
  const { loggedIn, cursorState, parseErrors } = input;

  // Last sync time
  const lastSyncAt = cursorState.updatedAt;
  let lastSyncAgo: string | null = null;
  if (lastSyncAt) {
    const elapsed = now.getTime() - new Date(lastSyncAt).getTime();
    lastSyncAgo = formatTimeAgo(elapsed);
  }

  // Per-source file counts
  const sourceCounts = new Map<Source, number>();
  for (const source of SOURCES) {
    sourceCounts.set(source, 0);
  }

  for (const filePath of Object.keys(cursorState.files)) {
    const source = inferSource(filePath);
    if (source) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }

  const sourceStats: SourceStats[] = [];
  for (const source of SOURCES) {
    const count = sourceCounts.get(source) ?? 0;
    if (count > 0) {
      sourceStats.push({ source, fileCount: count });
    }
  }

  const totalFiles = Object.keys(cursorState.files).length;
  const hasOpenCodeDb = !!cursorState.openCodeSqlite;

  return {
    loggedIn,
    lastSyncAt,
    lastSyncAgo,
    sourceStats,
    totalFiles,
    hasOpenCodeDb,
    parseErrorCount: parseErrors.length,
    recentErrors: parseErrors,
  };
}

// ── Parse error loading ────────────────────────────────────────

const MAX_RECENT_ERRORS = 5;

/**
 * Load recent parse errors from a JSONL string.
 *
 * Returns the last N errors (newest first).
 */
export function loadParseErrors(content: string): ParseError[] {
  if (!content.trim()) return [];

  const lines = content.trim().split("\n");
  const errors: ParseError[] = [];

  // Read all lines, keep them in order
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ParseError;
      if (parsed.timestamp && parsed.source && parsed.error) {
        errors.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Return last N (newest), reversed to show newest first
  return errors.slice(-MAX_RECENT_ERRORS).reverse();
}

// ── Formatting for console output ──────────────────────────────

/**
 * Format a Source enum to a display-friendly label.
 */
export function formatSourceLabel(source: Source): string {
  const labels: Record<Source, string> = {
    "claude-code": "Claude Code",
    codex: "Codex CLI",
    "gemini-cli": "Gemini CLI",
    opencode: "OpenCode",
    "vscode-copilot": "VS Code Copilot",
  };
  return labels[source];
}

/**
 * Build formatted lines for console output.
 */
export function formatStatusLines(output: StatusOutput): string[] {
  const lines: string[] = [];

  // Login status
  lines.push(output.loggedIn ? "Logged in: yes" : "Logged in: no");

  // Last sync
  if (output.lastSyncAt) {
    lines.push(`Last sync: ${output.lastSyncAgo} (${output.lastSyncAt})`);
  } else {
    lines.push("Last sync: never");
  }

  // Source stats
  if (output.sourceStats.length > 0 || output.hasOpenCodeDb) {
    lines.push("");
    lines.push("Sources:");
    for (const s of output.sourceStats) {
      lines.push(`  ${formatSourceLabel(s.source)}: ${s.fileCount} file(s)`);
    }
    if (output.hasOpenCodeDb) {
      lines.push("  OpenCode (SQLite): active");
    }
    lines.push(`  Total tracked: ${output.totalFiles} file(s)`);
  } else {
    lines.push("");
    lines.push("Sources: none tracked");
  }

  // Parse errors
  if (output.parseErrorCount > 0) {
    lines.push("");
    lines.push(`Parse errors: ${output.parseErrorCount}`);
    for (const err of output.recentErrors) {
      const ts = err.timestamp.slice(0, 19).replace("T", " ");
      lines.push(`  [${ts}] ${err.source}: ${err.error}`);
      if (err.filePath) {
        lines.push(`    ${err.filePath}`);
      }
    }
  }

  return lines;
}
