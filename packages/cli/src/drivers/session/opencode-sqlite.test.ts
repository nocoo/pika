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
import type { SyncContext } from "../types.js";
import {
  createOpenCodeSqliteDriver,
  type SqliteDb,
  type SqliteStatement,
  type OpenDbFn,
} from "./opencode-sqlite.js";

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
                (r) => (r.time_created as string) > watermark,
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
  });

  it("skips sessions already in SyncContext.messageKeys (dedup)", async () => {
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
    // Pre-populate messageKeys as if JSON driver already processed ses_001
    const ctx: SyncContext = {
      messageKeys: new Set(["opencode:ses_001"]),
    };

    const { results } = await driver.run(undefined, ctx);
    // Only ses_002 should be processed
    expect(results).toHaveLength(1);
    expect(results[0].canonical.sessionKey).toBe("opencode:ses_002");
  });

  it("deposits sessionKeys into SyncContext after processing", async () => {
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
    const ctx: SyncContext = { messageKeys: new Set() };

    await driver.run(undefined, ctx);
    expect(ctx.messageKeys!.has("opencode:ses_new")).toBe(true);
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
          all(...params: unknown[]): unknown[] {
            if (sql.includes("FROM session")) {
              return [
                { data: JSON.stringify(sessionData("ses_001")) },
              ];
            }
            if (sql.includes("FROM message")) {
              // With watermark, the query should have 2 params
              // Return empty to simulate "no new messages"
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
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const ctx: SyncContext = {};
    const { cursor } = await driver.run(prevCursor, ctx);
    expect(cursor).toBe(prevCursor);
  });
});
