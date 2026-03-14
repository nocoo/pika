/**
 * Tests for OpenCode SQLite DB session driver.
 *
 * Covers: run() with watermark, inode detection, cross-source dedup,
 * error handling (missing DB, open failure, malformed rows).
 *
 * Uses an in-memory mock SQLite interface to avoid bun:sqlite dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OpenCodeSqliteCursor } from "@pika/core";
import type { SyncContext } from "../types";
import {
  createOpenCodeSqliteDriver,
  type SqliteDb,
  type SqliteStatement,
  type OpenDbFn,
} from "./opencode-sqlite";

// ---------------------------------------------------------------------------
// Mock SQLite database
// ---------------------------------------------------------------------------

interface MockTable {
  rows: Record<string, unknown>[];
}

function createMockDb(tables: {
  session?: Record<string, unknown>[];
  message?: Record<string, unknown>[];
  part?: Record<string, unknown>[];
}): SqliteDb {
  const sessionRows = tables.session ?? [];
  const messageRows = tables.message ?? [];
  const partRows = tables.part ?? [];

  return {
    prepare(sql: string): SqliteStatement {
      return {
        all(...params: unknown[]): unknown[] {
          // Route queries based on SQL
          if (sql.includes("FROM session")) {
            return sessionRows.map((r) => ({
              data: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
            }));
          }

          if (sql.includes("FROM message")) {
            const sessionId = params[0] as string;
            const watermark = params.length > 1 ? (params[1] as string) : null;
            let filtered = messageRows.filter(
              (r) => r.session_id === sessionId,
            );
            if (watermark) {
              filtered = filtered.filter(
                (r) => (r.time_created as string) >= watermark,
              );
            }
            return filtered.map((r) => ({
              id: r.id,
              session_id: r.session_id,
              data: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
              time_created: r.time_created,
            }));
          }

          if (sql.includes("FROM part")) {
            const messageId = params[0] as string;
            return partRows
              .filter((r) => r.message_id === messageId)
              .map((r) => ({
                data: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
                message_id: r.message_id,
              }));
          }

          return [];
        },
      };
    },
    close(): void {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionData(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectID: "proj_test",
    directory: "/home/user/project",
    title: "Test session",
    time: { created: 1700000000000, updated: 1700000300000 },
    ...overrides,
  };
}

function messageData(
  id: string,
  sessionId: string,
  role: string,
  timeCreated: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    sessionID: sessionId,
    role,
    time: { created: timeCreated },
    ...overrides,
  };
}

function partData(
  id: string,
  type: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    text: "Hello from part",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openCodeSqliteDriver.source", () => {
  it("has source set to opencode", () => {
    const openDb: OpenDbFn = () => createMockDb({});
    const driver = createOpenCodeSqliteDriver(openDb, "/tmp/test.db");
    expect(driver.source).toBe("opencode");
  });
});

describe("openCodeSqliteDriver.run", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-oc-sqlite-driver-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty results when DB file does not exist", async () => {
    const openDb: OpenDbFn = () => createMockDb({});
    const driver = createOpenCodeSqliteDriver(
      openDb,
      join(tmpDir, "nonexistent.db"),
    );
    const ctx: SyncContext = {};

    const { results, rowCount } = await driver.run(undefined, ctx);
    expect(results).toEqual([]);
    expect(rowCount).toBe(0);
  });

  it("returns empty results when DB cannot be opened", async () => {
    const dbPath = join(tmpDir, "broken.db");
    await writeFile(dbPath, "not a sqlite db");

    const openDb: OpenDbFn = () => {
      throw new Error("Cannot open database");
    };
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results, rowCount } = await driver.run(undefined, ctx);
    expect(results).toEqual([]);
    expect(rowCount).toBe(0);
  });

  it("parses sessions from DB with full data", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
        {
          id: "msg_002",
          session_id: "ses_001",
          data: messageData("msg_002", "ses_001", "assistant", 1700000002000, {
            modelID: "claude-sonnet-4-20250514",
            tokens: { input: 100, output: 50, cache: { read: 10 } },
          }),
          time_created: "2023-11-14T16:53:22.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text", { text: "User question" }),
        },
        {
          message_id: "msg_002",
          data: partData("prt_002", "text", { text: "Assistant answer" }),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results, cursor, rowCount } = await driver.run(undefined, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("opencode:ses_001");
    expect(results[0].canonical.messages).toHaveLength(2);
    expect(results[0].canonical.messages[0].content).toBe("User question");
    expect(results[0].canonical.messages[1].content).toBe("Assistant answer");
    expect(results[0].canonical.totalInputTokens).toBe(100);
    expect(results[0].canonical.totalOutputTokens).toBe(50);
    expect(rowCount).toBe(2);
    // Watermark derived from msg.time.created (ms epoch → ISO)
    expect(cursor.lastTimeCreated).toBe(
      new Date(1700000002000).toISOString(),
    );
    // lastMessageIds populated (tested thoroughly in dedicated test)
    expect(Array.isArray(cursor.lastMessageIds)).toBe(true);
  });

  it("skips sessions already in SyncContext.openCodeSessionState (dedup)", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [
        { data: sessionData("ses_001") },
        { data: sessionData("ses_002") },
      ],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
        {
          id: "msg_002",
          session_id: "ses_002",
          data: messageData("msg_002", "ses_002", "user", 1700000002000),
          time_created: "2023-11-14T16:53:22.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text", { text: "From ses_001" }),
        },
        {
          message_id: "msg_002",
          data: partData("prt_002", "text", { text: "From ses_002" }),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    // Pre-populate openCodeSessionState as if JSON driver already processed ses_001
    // with an equal-or-newer version (lastMessageAt >= sqlite's, totalMessages >= sqlite's)
    // sqlite ses_001 has session.time.updated = 1700000300000 → lastMessageAt = "2023-11-14T22:18:20.000Z"
    // sqlite ses_001 has 1 message
    const ctx: SyncContext = {
      openCodeSessionState: new Map([
        [
          "opencode:ses_001",
          {
            lastMessageAt: "2023-11-14T22:18:20.000Z",
            totalMessages: 1,
          },
        ],
      ]),
    };

    const { results } = await driver.run(undefined, ctx);
    // Only ses_002 should be processed
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("opencode:ses_002");
  });

  it("deposits openCodeSessionState into SyncContext after processing", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_new") }],
      message: [
        {
          id: "msg_001",
          session_id: "ses_new",
          data: messageData("msg_001", "ses_new", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text"),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    await driver.run(undefined, ctx);
    expect(ctx.openCodeSessionState).toBeDefined();
    expect(ctx.openCodeSessionState!.has("opencode:ses_new")).toBe(true);
    const info = ctx.openCodeSessionState!.get("opencode:ses_new")!;
    expect(info.totalMessages).toBe(1);
    expect(info.lastMessageAt).toBeDefined();
  });

  it("uses watermark from previous cursor when inode matches", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    // Get actual inode
    const { stat: statFn } = await import("node:fs/promises");
    const dbStat = await statFn(dbPath);

    const prepareSpy = vi.fn();
    const mockDb: SqliteDb = {
      prepare(sql: string): SqliteStatement {
        prepareSpy(sql);
        return {
          all(..._params: unknown[]): unknown[] {
            if (sql.includes("FROM session")) {
              return [
                { data: JSON.stringify(sessionData("ses_001")) },
              ];
            }
            if (sql.includes("FROM message")) {
              // Return empty for all message queries (watermark, boundary, etc.)
              return [];
            }
            return [];
          },
        };
      },
      close() {},
    };

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);

    const prevCursor: OpenCodeSqliteCursor = {
      inode: dbStat.ino,
      lastTimeCreated: "2023-11-14T16:53:00.000Z",
      lastMessageIds: [],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const ctx: SyncContext = {};
    const { results } = await driver.run(prevCursor, ctx);

    // With watermark and no new messages, session should be skipped
    expect(results).toHaveLength(0);
  });

  it("resets watermark when inode changes (DB replaced)", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text"),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);

    // Previous cursor with different inode
    const prevCursor: OpenCodeSqliteCursor = {
      inode: 99999, // different from actual inode
      lastTimeCreated: "2023-11-14T16:53:00.000Z",
      lastMessageIds: [],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const ctx: SyncContext = {};
    const { results } = await driver.run(prevCursor, ctx);

    // Should process all sessions (no watermark filter)
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("opencode:ses_001");
  });

  it("handles malformed session data gracefully", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [
        { data: "not valid json {{{" }, // malformed
        { data: { noId: true } },        // missing id
        { data: sessionData("ses_valid") }, // valid
      ],
      message: [
        {
          id: "msg_001",
          session_id: "ses_valid",
          data: messageData("msg_001", "ses_valid", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text"),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results } = await driver.run(undefined, ctx);
    // Only valid session should produce results
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("opencode:ses_valid");
  });

  it("handles malformed message and part data gracefully", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_bad",
          session_id: "ses_001",
          data: "not json",
          time_created: "2023-11-14T16:53:21.000Z",
        },
        {
          id: "msg_norole",
          session_id: "ses_001",
          data: { id: "msg_norole" }, // missing role
          time_created: "2023-11-14T16:53:21.500Z",
        },
        {
          id: "msg_good",
          session_id: "ses_001",
          data: messageData("msg_good", "ses_001", "user", 1700000002000),
          time_created: "2023-11-14T16:53:22.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_good",
          data: "bad json {{{",
        },
        {
          message_id: "msg_good",
          data: partData("prt_good", "text", { text: "Valid part" }),
        },
        {
          message_id: "msg_good",
          data: { noType: true }, // missing type
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results } = await driver.run(undefined, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(1);
    expect(results[0].canonical.messages[0].content).toBe("Valid part");
  });

  it("tracks watermark as latest message time_created", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
        {
          id: "msg_002",
          session_id: "ses_001",
          data: messageData("msg_002", "ses_001", "assistant", 1700000005000, {
            modelID: "test-model",
            tokens: { input: 50, output: 25 },
          }),
          time_created: "2023-11-14T16:53:25.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text", { text: "Q" }),
        },
        {
          message_id: "msg_002",
          data: partData("prt_002", "text", { text: "A" }),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { cursor } = await driver.run(undefined, ctx);
    // Watermark derived from msg.time.created (ms epoch → ISO)
    expect(cursor.lastTimeCreated).toBe(
      new Date(1700000005000).toISOString(),
    );
  });

  it("preserves cursor inode from actual DB file", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const { stat: statFn } = await import("node:fs/promises");
    const dbStat = await statFn(dbPath);

    const mockDb = createMockDb({ session: [] });
    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { cursor } = await driver.run(undefined, ctx);
    expect(cursor.inode).toBe(dbStat.ino);
  });

  it("closes database even when query throws", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    let closed = false;
    const mockDb: SqliteDb = {
      prepare(): SqliteStatement {
        return {
          all(): unknown[] {
            throw new Error("Query failed");
          },
        };
      },
      close() {
        closed = true;
      },
    };

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    await expect(driver.run(undefined, ctx)).rejects.toThrow("Query failed");
    expect(closed).toBe(true);
  });

  it("handles empty database (no sessions)", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({ session: [], message: [], part: [] });
    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results, rowCount } = await driver.run(undefined, ctx);
    expect(results).toEqual([]);
    expect(rowCount).toBe(0);
  });

  it("handles multiple sessions in single run", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [
        { data: sessionData("ses_001") },
        { data: sessionData("ses_002", { title: "Second session" }) },
      ],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", 1700000001000),
          time_created: "2023-11-14T16:53:21.000Z",
        },
        {
          id: "msg_002",
          session_id: "ses_002",
          data: messageData("msg_002", "ses_002", "user", 1700000002000),
          time_created: "2023-11-14T16:53:22.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text", { text: "Session 1" }),
        },
        {
          message_id: "msg_002",
          data: partData("prt_002", "text", { text: "Session 2" }),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results, rowCount } = await driver.run(undefined, ctx);
    expect(results).toHaveLength(2);
    expect(rowCount).toBe(2);

    const keys = results.map((r) => r.canonical.sessionKey);
    expect(keys).toContain("opencode:ses_001");
    expect(keys).toContain("opencode:ses_002");
  });

  it("returns previous cursor when DB file does not exist", async () => {
    const openDb: OpenDbFn = () => createMockDb({});
    const driver = createOpenCodeSqliteDriver(
      openDb,
      join(tmpDir, "nonexistent.db"),
    );

    const prevCursor: OpenCodeSqliteCursor = {
      inode: 12345,
      lastTimeCreated: "2023-11-14T16:00:00.000Z",
      lastMessageIds: [],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const ctx: SyncContext = {};
    const { cursor } = await driver.run(prevCursor, ctx);
    expect(cursor).toBe(prevCursor);
  });

  it("cursor includes lastMessageIds at boundary timestamp", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    // Both messages share the same time.created epoch → same maxTimeCreated
    const sharedEpoch = 1700000001000;
    const sharedIso = new Date(sharedEpoch).toISOString();

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", sharedEpoch),
          time_created: sharedIso,
        },
        {
          id: "msg_002",
          session_id: "ses_001",
          data: messageData("msg_002", "ses_001", "assistant", sharedEpoch, {
            modelID: "test-model",
            tokens: { input: 50, output: 25 },
          }),
          // Same timestamp as msg_001 — both at boundary
          time_created: sharedIso,
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text", { text: "Q" }),
        },
        {
          message_id: "msg_002",
          data: partData("prt_002", "text", { text: "A" }),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { cursor } = await driver.run(undefined, ctx);
    // Both messages share the boundary timestamp → both IDs in lastMessageIds
    expect(cursor.lastMessageIds).toContain("msg_001");
    expect(cursor.lastMessageIds).toContain("msg_002");
    expect(cursor.lastMessageIds).toHaveLength(2);
  });

  it("deduplicates messages via lastMessageIds on >= watermark but produces full canonical", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const oldEpoch = 1700000001000;
    const newEpoch = 1700000002000;
    const oldIso = new Date(oldEpoch).toISOString();
    const newIso = new Date(newEpoch).toISOString();

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_old",
          session_id: "ses_001",
          data: messageData("msg_old", "ses_001", "user", oldEpoch),
          time_created: oldIso,
        },
        {
          id: "msg_new",
          session_id: "ses_001",
          data: messageData("msg_new", "ses_001", "assistant", newEpoch, {
            modelID: "test-model",
            tokens: { input: 50, output: 25 },
          }),
          time_created: newIso,
        },
      ],
      part: [
        {
          message_id: "msg_old",
          data: partData("prt_001", "text", { text: "Already seen" }),
        },
        {
          message_id: "msg_new",
          data: partData("prt_002", "text", { text: "Brand new" }),
        },
      ],
    });

    const { stat: statFn } = await import("node:fs/promises");
    const dbStat = await statFn(dbPath);

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);

    // Cursor watermark at msg_old's timestamp, with msg_old in lastMessageIds
    const prevCursor: OpenCodeSqliteCursor = {
      inode: dbStat.ino,
      lastTimeCreated: oldIso,
      lastMessageIds: ["msg_old"],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const ctx: SyncContext = {};
    const { results } = await driver.run(prevCursor, ctx);

    // Should produce results (new message detected via watermark)
    expect(results).toHaveLength(1);
    // Full canonical: ALL messages appear (not just new ones)
    expect(results[0].canonical.messages).toHaveLength(2);
    expect(results[0].canonical.messages[0].content).toBe("Already seen");
    expect(results[0].canonical.messages[1].content).toBe("Brand new");
  });

  it("does not skip SQLite session when JSON has fewer messages", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_001") }],
      message: [
        {
          id: "msg_001",
          session_id: "ses_001",
          data: messageData("msg_001", "ses_001", "user", 1700000001000),
          time_created: new Date(1700000001000).toISOString(),
        },
        {
          id: "msg_002",
          session_id: "ses_001",
          data: messageData("msg_002", "ses_001", "assistant", 1700000002000, {
            modelID: "test-model",
            tokens: { input: 50, output: 25 },
          }),
          time_created: new Date(1700000002000).toISOString(),
        },
      ],
      part: [
        {
          message_id: "msg_001",
          data: partData("prt_001", "text", { text: "Q" }),
        },
        {
          message_id: "msg_002",
          data: partData("prt_002", "text", { text: "A" }),
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    // JSON has only 1 message, but SQLite has 2 → should NOT skip
    // session.time.updated = 1700000300000 → lastMessageAt from parser
    const ctx: SyncContext = {
      openCodeSessionState: new Map([
        [
          "opencode:ses_001",
          {
            lastMessageAt: new Date(1700000001000).toISOString(),
            totalMessages: 1,
          },
        ],
      ]),
    };

    const { results } = await driver.run(undefined, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(2);
  });

  it("produces faithful raw source files from original DB row data", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const sessionObj = sessionData("ses_raw");
    const msgObj = messageData("msg_r1", "ses_raw", "user", 1700000001000);
    const partObj = partData("prt_r1", "text", { text: "Raw fidelity" });

    const mockDb = createMockDb({
      session: [{ data: sessionObj }],
      message: [
        {
          id: "msg_r1",
          session_id: "ses_raw",
          data: msgObj,
          time_created: "2023-11-14T16:53:21.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_r1",
          data: partObj,
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results } = await driver.run(undefined, ctx);
    expect(results).toHaveLength(1);

    const sf = results[0].raw.sourceFiles;
    // 1 session + 1 message + 1 part = 3 source files
    expect(sf).toHaveLength(3);

    // All entries have sqlite-export format
    expect(sf.every((f) => f.format === "sqlite-export")).toBe(true);

    // Session row
    expect(sf[0].path).toBe(`${dbPath}#session/ses_raw`);
    expect(JSON.parse(sf[0].content).id).toBe("ses_raw");

    // Message row
    expect(sf[1].path).toBe(`${dbPath}#message/msg_r1`);
    expect(JSON.parse(sf[1].content).role).toBe("user");

    // Part row
    expect(sf[2].path).toBe(`${dbPath}#part/msg_r1/0`);
    expect(JSON.parse(sf[2].content).text).toBe("Raw fidelity");

    // No source file should be a synthetic JSON.stringify of the messages array
    for (const f of sf) {
      const parsed = JSON.parse(f.content);
      expect(Array.isArray(parsed)).toBe(false);
    }
  });

  it("raw source files preserve original data column content verbatim", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    // Use a specific JSON string format (pretty-printed) to verify verbatim preservation
    const sessionJson = JSON.stringify(sessionData("ses_verbatim"), null, 2);
    const msgJson = JSON.stringify(
      messageData("msg_v1", "ses_verbatim", "user", 1700000001000),
      null,
      2,
    );
    const partJson = JSON.stringify(
      partData("prt_v1", "text", { text: "Verbatim check" }),
      null,
      2,
    );

    const mockDb = createMockDb({
      session: [{ data: sessionJson }],
      message: [
        {
          id: "msg_v1",
          session_id: "ses_verbatim",
          data: msgJson,
          time_created: "2023-11-14T16:53:21.000Z",
        },
      ],
      part: [
        {
          message_id: "msg_v1",
          data: partJson,
        },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);
    const ctx: SyncContext = {};

    const { results } = await driver.run(undefined, ctx);
    const sf = results[0].raw.sourceFiles;

    // Content should be the EXACT original data column string
    expect(sf[0].content).toBe(sessionJson);
    expect(sf[1].content).toBe(msgJson);
    expect(sf[2].content).toBe(partJson);
  });

  it("full canonical snapshot includes all messages even with watermark", async () => {
    const dbPath = join(tmpDir, "test.db");
    await writeFile(dbPath, "dummy");

    const { stat: statFn } = await import("node:fs/promises");
    const dbStat = await statFn(dbPath);

    // 3 messages: old, boundary, and new
    const oldEpoch = 1700000001000;
    const boundaryEpoch = 1700000002000;
    const newEpoch = 1700000003000;
    const oldIso = new Date(oldEpoch).toISOString();
    const boundaryIso = new Date(boundaryEpoch).toISOString();
    const newIso = new Date(newEpoch).toISOString();

    const mockDb = createMockDb({
      session: [{ data: sessionData("ses_full") }],
      message: [
        {
          id: "msg_old",
          session_id: "ses_full",
          data: messageData("msg_old", "ses_full", "user", oldEpoch),
          time_created: oldIso,
        },
        {
          id: "msg_boundary",
          session_id: "ses_full",
          data: messageData("msg_boundary", "ses_full", "assistant", boundaryEpoch, {
            modelID: "test-model",
          }),
          time_created: boundaryIso,
        },
        {
          id: "msg_new",
          session_id: "ses_full",
          data: messageData("msg_new", "ses_full", "user", newEpoch),
          time_created: newIso,
        },
      ],
      part: [
        { message_id: "msg_old", data: partData("p1", "text", { text: "Old msg" }) },
        { message_id: "msg_boundary", data: partData("p2", "text", { text: "Boundary msg" }) },
        { message_id: "msg_new", data: partData("p3", "text", { text: "New msg" }) },
      ],
    });

    const openDb: OpenDbFn = () => mockDb;
    const driver = createOpenCodeSqliteDriver(openDb, dbPath);

    // Watermark at boundary — msg_old is before watermark, msg_boundary was already seen
    const prevCursor: OpenCodeSqliteCursor = {
      inode: dbStat.ino,
      lastTimeCreated: boundaryIso,
      lastMessageIds: ["msg_boundary"],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const ctx: SyncContext = {};
    const { results } = await driver.run(prevCursor, ctx);

    expect(results).toHaveLength(1);
    // Full canonical: ALL 3 messages appear, not just msg_new
    expect(results[0].canonical.messages).toHaveLength(3);
    expect(results[0].canonical.messages[0].content).toBe("Old msg");
    expect(results[0].canonical.messages[1].content).toBe("Boundary msg");
    expect(results[0].canonical.messages[2].content).toBe("New msg");

    // Raw also includes all 3 messages + 3 parts + 1 session = 7 source files
    expect(results[0].raw.sourceFiles).toHaveLength(7);
  });
});
