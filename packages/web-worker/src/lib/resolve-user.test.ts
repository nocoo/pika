import { describe, expect, it, vi } from "vitest";
import {
  d1UserExecutor,
  resolveUserId,
  type UserExecutor,
} from "./resolve-user";

/** In-memory `users` table: emulates UNIQUE(email) + ON CONFLICT DO NOTHING. */
function makeMemoryExecutor(): UserExecutor & {
  rows: Array<{ id: string; email: string }>;
} {
  const rows: Array<{ id: string; email: string }> = [];
  return {
    rows,
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      if (sql.includes("SELECT id FROM users WHERE email")) {
        const [email] = params as [string];
        const r = rows.find((x) => x.email === email);
        return (r ? [{ id: r.id }] : []) as unknown as T[];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    async run(sql: string, params: unknown[]) {
      if (sql.startsWith("INSERT INTO users")) {
        const [id, email] = params as [string, string];
        if (rows.some((r) => r.email === email)) return { changes: 0 };
        rows.push({ id, email });
        return { changes: 1 };
      }
      throw new Error(`unexpected run: ${sql}`);
    },
  };
}

describe("resolveUserId", () => {
  it("creates a row for a new email and returns its id", async () => {
    const exec = makeMemoryExecutor();
    const id = await resolveUserId(exec, "alice@example.com");
    expect(id).toBeTruthy();
    expect(exec.rows).toHaveLength(1);
    expect(exec.rows[0]).toMatchObject({ id, email: "alice@example.com" });
  });

  it("returns the existing id when the email already exists", async () => {
    const exec = makeMemoryExecutor();
    const first = await resolveUserId(exec, "bob@example.com");
    const second = await resolveUserId(exec, "bob@example.com");
    expect(second).toBe(first);
    expect(exec.rows).toHaveLength(1);
  });

  it("concurrent 10× same email lands exactly one row", async () => {
    const exec = makeMemoryExecutor();
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => resolveUserId(exec, "race@example.com")),
    );
    expect(exec.rows).toHaveLength(1);
    const winner = exec.rows[0]!.id;
    for (const id of ids) expect(id).toBe(winner);
  });

  it("throws when SELECT yields no row after upsert", async () => {
    const exec: UserExecutor = {
      async query() {
        return [];
      },
      async run() {
        return { changes: 0 };
      },
    };
    await expect(resolveUserId(exec, "ghost@example.com")).rejects.toThrow(
      /no row for email/,
    );
  });
});

describe("d1UserExecutor", () => {
  it("query: forwards sql + params and unwraps results", async () => {
    const allMock = vi.fn().mockResolvedValue({ results: [{ id: "u-1" }] });
    const bindMock = vi.fn(() => ({ all: allMock, run: vi.fn() }));
    const prepareMock = vi.fn(() => ({ bind: bindMock }));
    const db = { prepare: prepareMock } as unknown as D1Database;

    const exec = d1UserExecutor(db);
    const rows = await exec.query<{ id: string }>(
      "SELECT id FROM users WHERE email = ?",
      ["x@example.com"],
    );
    expect(prepareMock).toHaveBeenCalledWith(
      "SELECT id FROM users WHERE email = ?",
    );
    expect(bindMock).toHaveBeenCalledWith("x@example.com");
    expect(rows).toEqual([{ id: "u-1" }]);
  });

  it("query: defaults to [] when results missing", async () => {
    const allMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn(() => ({ all: allMock, run: vi.fn() }));
    const prepareMock = vi.fn(() => ({ bind: bindMock }));
    const db = { prepare: prepareMock } as unknown as D1Database;
    const exec = d1UserExecutor(db);
    expect(
      await exec.query("SELECT id FROM users WHERE email = ?", ["x"]),
    ).toEqual([]);
  });

  it("run: returns changes from meta", async () => {
    const runMock = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const bindMock = vi.fn(() => ({ all: vi.fn(), run: runMock }));
    const prepareMock = vi.fn(() => ({ bind: bindMock }));
    const db = { prepare: prepareMock } as unknown as D1Database;
    const exec = d1UserExecutor(db);
    expect(
      await exec.run("INSERT INTO users (id, email) VALUES (?, ?)", [
        "u-1",
        "x",
      ]),
    ).toEqual({ changes: 1 });
  });

  it("run: defaults changes to 0 when meta missing", async () => {
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn(() => ({ all: vi.fn(), run: runMock }));
    const prepareMock = vi.fn(() => ({ bind: bindMock }));
    const db = { prepare: prepareMock } as unknown as D1Database;
    const exec = d1UserExecutor(db);
    expect(
      await exec.run("INSERT INTO users (id, email) VALUES (?, ?)", [
        "u-1",
        "x",
      ]),
    ).toEqual({ changes: 0 });
  });
});
