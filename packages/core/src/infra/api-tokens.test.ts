import { describe, expect, it, vi } from "vitest";
import {
  type ApiTokenExecutor,
  type ApiTokenRow,
  createApiToken,
  findByHashed,
  generateRawToken,
  hashToken,
  listByUser,
  revoke,
  updateLastUsed,
} from "./api-tokens";

function makeMemoryExecutor(): {
  exec: ApiTokenExecutor;
  rows: ApiTokenRow[];
} {
  const rows: ApiTokenRow[] = [];
  let nextId = 1;
  const exec: ApiTokenExecutor = {
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      const trimmed = sql.trim();
      if (trimmed.startsWith("SELECT * FROM api_tokens\n       WHERE hashed")) {
        const [hashed, nowIso] = params as [string, string];
        return rows
          .filter(
            (r) =>
              r.hashed === hashed &&
              (r.expires_at === null || r.expires_at > nowIso),
          )
          .slice(0, 1) as unknown as T[];
      }
      if (
        trimmed.startsWith("SELECT * FROM api_tokens\n       WHERE user_id")
      ) {
        const [userId] = params as [string];
        return rows
          .filter((r) => r.user_id === userId)
          .slice()
          .sort((a, b) =>
            a.created_at < b.created_at ? 1 : -1,
          ) as unknown as T[];
      }
      throw new Error(`unhandled query: ${sql}`);
    },
    async run(sql: string, params: unknown[]) {
      const trimmed = sql.trim();
      if (trimmed.startsWith("INSERT INTO api_tokens")) {
        const [
          user_id,
          email,
          token_prefix,
          hashed,
          name,
          created_at,
          expires_at,
        ] = params as [
          string,
          string,
          string,
          string,
          string | null,
          string,
          string | null,
        ];
        const id = nextId++;
        rows.push({
          id,
          user_id,
          email,
          token_prefix,
          hashed,
          name,
          created_at,
          last_used_at: null,
          expires_at,
        });
        return { lastInsertId: id, changes: 1 };
      }
      if (trimmed.startsWith("DELETE FROM api_tokens")) {
        const [id, userId] = params as [number, string];
        const idx = rows.findIndex((r) => r.id === id && r.user_id === userId);
        if (idx === -1) return { changes: 0 };
        rows.splice(idx, 1);
        return { changes: 1 };
      }
      if (trimmed.startsWith("UPDATE api_tokens SET last_used_at")) {
        const [nowIso, id] = params as [string, number];
        const row = rows.find((r) => r.id === id);
        if (row) row.last_used_at = nowIso;
        return { changes: row ? 1 : 0 };
      }
      throw new Error(`unhandled run: ${sql}`);
    },
  };
  return { exec, rows };
}

describe("api-tokens repo", () => {
  describe("hashToken", () => {
    it("produces stable SHA-256 hex", async () => {
      const a = await hashToken("pk_hello");
      const b = await hashToken("pk_hello");
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("differs for different inputs", async () => {
      const a = await hashToken("pk_a");
      const b = await hashToken("pk_b");
      expect(a).not.toBe(b);
    });
  });

  describe("generateRawToken", () => {
    it("starts with pk_ and is base64url (no padding)", () => {
      const t = generateRawToken();
      expect(t.startsWith("pk_")).toBe(true);
      expect(t.slice(3)).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t).not.toContain("=");
    });

    it("is unique across calls", () => {
      const set = new Set<string>();
      for (let i = 0; i < 64; i++) set.add(generateRawToken());
      expect(set.size).toBe(64);
    });
  });

  describe("createApiToken", () => {
    it("inserts a hashed row and returns raw token once", async () => {
      const { exec, rows } = makeMemoryExecutor();
      const created = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
        name: "CLI",
      });
      expect(created.token.startsWith("pk_")).toBe(true);
      expect(created.id).toBe(1);
      expect(created.tokenPrefix).toBe(created.token.slice(0, 8));
      expect(rows).toHaveLength(1);
      expect(rows[0].hashed).toBe(await hashToken(created.token));
      expect(rows[0].hashed).not.toBe(created.token); // never store raw
      expect(rows[0].name).toBe("CLI");
      expect(rows[0].expires_at).toBeNull();
    });

    it("respects optional expiresAt and defaults name to null", async () => {
      const { exec, rows } = makeMemoryExecutor();
      await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
        expiresAt: "2099-01-01T00:00:00Z",
      });
      expect(rows[0].name).toBeNull();
      expect(rows[0].expires_at).toBe("2099-01-01T00:00:00Z");
    });

    it("throws when executor omits lastInsertId", async () => {
      const broken: ApiTokenExecutor = {
        async query() {
          return [];
        },
        async run() {
          return { changes: 1 };
        },
      };
      await expect(
        createApiToken(broken, { userId: "u1", email: "a@test.com" }),
      ).rejects.toThrow(/lastInsertId/);
    });
  });

  describe("findByHashed", () => {
    it("returns the row when raw token matches", async () => {
      const { exec } = makeMemoryExecutor();
      const created = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      const found = await findByHashed(exec, created.token);
      expect(found?.id).toBe(created.id);
    });

    it("returns null for unknown / empty / expired token", async () => {
      const { exec, rows } = makeMemoryExecutor();
      const created = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      expect(await findByHashed(exec, "")).toBeNull();
      expect(await findByHashed(exec, "pk_doesnotexist")).toBeNull();

      // expire it
      rows[0].expires_at = "2000-01-01T00:00:00Z";
      expect(await findByHashed(exec, created.token)).toBeNull();
    });

    it("hash is one-way — finding by raw of same hash works, by guess does not", async () => {
      const { exec } = makeMemoryExecutor();
      const created = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      // Trying with the prefix only (a guess) must not match
      expect(await findByHashed(exec, created.tokenPrefix)).toBeNull();
    });
  });

  describe("listByUser / revoke / updateLastUsed", () => {
    it("listByUser returns user's rows newest first", async () => {
      const { exec, rows } = makeMemoryExecutor();
      const a = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      // Force ordering by adjusting created_at
      rows[0].created_at = "2026-01-01T00:00:00Z";
      const b = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      rows[1].created_at = "2026-02-01T00:00:00Z";
      await createApiToken(exec, { userId: "u2", email: "b@test.com" });

      const list = await listByUser(exec, "u1");
      expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it("revoke deletes only own row", async () => {
      const { exec } = makeMemoryExecutor();
      const a = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      // Wrong owner: no-op
      expect(await revoke(exec, a.id, "u2")).toBe(false);
      // Correct owner: deleted
      expect(await revoke(exec, a.id, "u1")).toBe(true);
      // Idempotent
      expect(await revoke(exec, a.id, "u1")).toBe(false);
    });

    it("updateLastUsed sets timestamp without mutating other fields", async () => {
      const { exec, rows } = makeMemoryExecutor();
      const created = await createApiToken(exec, {
        userId: "u1",
        email: "a@test.com",
      });
      const before = rows[0].hashed;
      await updateLastUsed(exec, created.id);
      expect(rows[0].last_used_at).toMatch(/T/);
      expect(rows[0].hashed).toBe(before);
    });

    it("updateLastUsed on missing id is a no-op", async () => {
      const { exec } = makeMemoryExecutor();
      await expect(updateLastUsed(exec, 9999)).resolves.toBeUndefined();
    });
  });
});

describe("api-tokens crypto fallback paths", () => {
  it("hashToken propagates subtle errors", async () => {
    const orig = crypto.subtle.digest;
    const spy = vi
      .spyOn(crypto.subtle, "digest")
      .mockRejectedValueOnce(new Error("boom"));
    await expect(hashToken("pk_x")).rejects.toThrow(/boom/);
    spy.mockRestore();
    expect(crypto.subtle.digest).toBe(orig);
  });
});
