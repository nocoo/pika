/**
 * OpenCode SQLite DB session driver.
 *
 * Strategy: Watermark-based cursor + cross-source dedup via SyncContext.
 *
 * DB path: ~/.local/share/opencode/opencode.db
 * Tables: session, message, part — each with `data` JSON blob column.
 * Cursor: inode + lastTimeCreated watermark + lastMessageIds for dedup.
 *
 * Watermark uses >= semantics to avoid missing messages that share the same
 * timestamp as the cursor. The lastMessageIds set filters out already-processed
 * rows at the boundary timestamp.
 *
 * This driver runs AFTER the JSON file driver so it can read
 * SyncContext.openCodeSessionState to avoid redundant processing.
 * Dedup rule: skip if JSON version is not behind (lastMessageAt >= and
 * totalMessages >=).
 *
 * Uses better-sqlite3-compatible API (synchronous queries).
 * The caller (orchestrator) is responsible for choosing the right SQLite binding.
 */

import { stat } from "node:fs/promises";
import type { OpenCodeSqliteCursor, ParseResult } from "@pika/core";
import {
  parseOpenCodeSqliteSession,
  type OcSession,
  type OcMessage,
  type OcPart,
} from "../../parsers/opencode.js";
import type {
  DbDriver,
  DbDriverResult,
  SyncContext,
  OpenCodeSessionInfo,
} from "../types.js";

// ---------------------------------------------------------------------------
// SQLite interface — minimal contract for any SQLite binding
// ---------------------------------------------------------------------------

/**
 * Minimal SQLite database interface compatible with both:
 * - better-sqlite3 (Node.js)
 * - bun:sqlite (Bun)
 *
 * The driver only needs prepare().all() for queries.
 */
export interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
}

/**
 * Function type for opening a SQLite database.
 * Injected by the orchestrator to decouple from specific SQLite bindings.
 */
export type OpenDbFn = (path: string, options?: { readonly: boolean }) => SqliteDb;

// ---------------------------------------------------------------------------
// Row types — what comes back from SQLite queries
// ---------------------------------------------------------------------------

interface SessionRow {
  data: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  data: string;
  time_created: string;
}

interface PartRow {
  data: string;
  message_id: string;
}

// ---------------------------------------------------------------------------
// Cross-source dedup helper
// ---------------------------------------------------------------------------

/**
 * Determine if the SQLite version of a session should be skipped because
 * the JSON driver already produced an equal-or-newer version.
 *
 * Rule: skip when JSON lastMessageAt >= sqlite lastMessageAt AND
 *       JSON totalMessages >= sqlite totalMessages.
 * Otherwise the SQLite version has data the JSON version lacks.
 */
function shouldSkipForJson(
  sessionKey: string,
  sqliteLastMessageAt: string,
  sqliteTotalMessages: number,
  jsonState: Map<string, OpenCodeSessionInfo> | undefined,
): boolean {
  if (!jsonState) return false;
  const info = jsonState.get(sessionKey);
  if (!info) return false;

  // JSON is at least as fresh and at least as complete → skip SQLite
  return (
    info.lastMessageAt >= sqliteLastMessageAt &&
    info.totalMessages >= sqliteTotalMessages
  );
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function querySessions(db: SqliteDb): OcSession[] {
  const rows = db
    .prepare("SELECT data FROM session ORDER BY rowid")
    .all() as SessionRow[];

  const sessions: OcSession[] = [];
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as OcSession;
      if (!data || !data.id) continue;
      sessions.push(data);
    } catch {
      continue;
    }
  }
  return sessions;
}

function queryMessagesForSession(
  db: SqliteDb,
  sessionId: string,
  watermark: string | null,
  lastMessageIds: Set<string> | null,
): OcMessage[] {
  let rows: MessageRow[];
  if (watermark) {
    // >= to catch messages at the same timestamp as the cursor
    rows = db
      .prepare(
        "SELECT id, session_id, data, time_created FROM message WHERE session_id = ? AND time_created >= ? ORDER BY time_created",
      )
      .all(sessionId, watermark) as MessageRow[];
  } else {
    rows = db
      .prepare(
        "SELECT id, session_id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created",
      )
      .all(sessionId) as MessageRow[];
  }

  const messages: OcMessage[] = [];
  for (const row of rows) {
    // Dedup: skip messages already processed in the previous run
    if (lastMessageIds?.has(row.id)) continue;

    try {
      const data = JSON.parse(row.data) as OcMessage;
      if (!data || typeof data.role !== "string") continue;
      // Ensure id is set from the row
      if (!data.id) data.id = row.id;
      messages.push(data);
    } catch {
      continue;
    }
  }
  return messages;
}

function queryPartsForMessage(
  db: SqliteDb,
  messageId: string,
): OcPart[] {
  const rows = db
    .prepare("SELECT data, message_id FROM part WHERE message_id = ? ORDER BY rowid")
    .all(messageId) as PartRow[];

  const parts: OcPart[] = [];
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as OcPart;
      if (!data || typeof data.type !== "string") continue;
      parts.push(data);
    } catch {
      continue;
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Driver factory
// ---------------------------------------------------------------------------

/**
 * Create an OpenCode SQLite DB driver.
 *
 * @param openDb - Function to open a SQLite database (injected for testability)
 * @param dbPath - Path to the OpenCode SQLite database file
 */
export function createOpenCodeSqliteDriver(
  openDb: OpenDbFn,
  dbPath: string,
): DbDriver<OpenCodeSqliteCursor> {
  return {
    source: "opencode",

    async run(
      prevCursor: OpenCodeSqliteCursor | undefined,
      ctx: SyncContext,
    ): Promise<DbDriverResult<OpenCodeSqliteCursor>> {
      // Check if DB file exists and get inode
      let dbStat;
      try {
        dbStat = await stat(dbPath);
      } catch {
        return {
          results: [],
          cursor: prevCursor ?? {
            inode: 0,
            lastTimeCreated: "",
            lastMessageIds: [],
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      // If inode changed, DB was replaced — reset watermark
      const inodeMatch = prevCursor && prevCursor.inode === dbStat.ino;
      const watermark = inodeMatch
        ? prevCursor.lastTimeCreated || null
        : null;
      const prevMessageIds = inodeMatch && prevCursor.lastMessageIds
        ? new Set(prevCursor.lastMessageIds)
        : null;

      let db: SqliteDb;
      try {
        db = openDb(dbPath, { readonly: true });
      } catch {
        return {
          results: [],
          cursor: prevCursor ?? {
            inode: dbStat.ino,
            lastTimeCreated: "",
            lastMessageIds: [],
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      try {
        const sessions = querySessions(db);
        const results: ParseResult[] = [];
        let totalRows = 0;
        let maxTimeCreated = watermark ?? "";

        for (const session of sessions) {
          const messages = queryMessagesForSession(
            db,
            session.id,
            watermark,
            prevMessageIds,
          );
          totalRows += messages.length;

          if (messages.length === 0 && watermark) {
            // No new messages since watermark — skip
            continue;
          }

          // Load parts for each message
          for (const msg of messages) {
            msg.parts = queryPartsForMessage(db, msg.id);
          }

          const result = parseOpenCodeSqliteSession(
            session,
            messages,
            dbPath,
          );

          // Cross-source dedup: skip if JSON already has equal-or-newer data
          const sessionKey = result.canonical.sessionKey;
          if (
            shouldSkipForJson(
              sessionKey,
              result.canonical.lastMessageAt,
              result.canonical.messages.length,
              ctx.openCodeSessionState,
            )
          ) {
            continue;
          }

          results.push(result);

          // Deposit session state so future drivers or the orchestrator can see it
          if (!ctx.openCodeSessionState) {
            ctx.openCodeSessionState = new Map();
          }
          ctx.openCodeSessionState.set(sessionKey, {
            lastMessageAt: result.canonical.lastMessageAt,
            totalMessages: result.canonical.messages.length,
          });

          // Track watermark: latest message time_created
          for (const msg of messages) {
            const tc = msg.time?.created;
            if (typeof tc === "number" && tc > 0) {
              const iso = new Date(tc).toISOString();
              if (iso > maxTimeCreated) {
                maxTimeCreated = iso;
              }
            }
          }
        }

        // Collect message IDs at the watermark timestamp for next-run dedup.
        // Query all messages at maxTimeCreated across all sessions so the
        // next >= query can filter them out.
        const boundaryIds: string[] = [];
        if (maxTimeCreated) {
          for (const session of sessions) {
            const rows = db
              .prepare(
                "SELECT id FROM message WHERE session_id = ? AND time_created = ?",
              )
              .all(session.id, maxTimeCreated) as Array<{ id: string }>;
            for (const row of rows) {
              boundaryIds.push(row.id);
            }
          }
        }

        const newCursor: OpenCodeSqliteCursor = {
          inode: dbStat.ino,
          lastTimeCreated: maxTimeCreated,
          lastMessageIds: boundaryIds,
          updatedAt: new Date().toISOString(),
        };

        return { results, cursor: newCursor, rowCount: totalRows };
      } finally {
        try {
          db.close();
        } catch {
          // ignore close errors
        }
      }
    },
  };
}
