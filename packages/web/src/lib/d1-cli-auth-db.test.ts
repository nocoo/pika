import { describe, it, expect, vi } from "vitest";
import { D1CliAuthDb } from "./d1-cli-auth-db.js";
import type { D1Client } from "./d1.js";

function createMockD1Client(overrides?: Partial<D1Client>): D1Client {
  return {
    query: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0, duration: 0 } }),
    execute: vi.fn().mockResolvedValue({ changes: 0, duration: 0 }),
    firstOrNull: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as D1Client;
}

describe("D1CliAuthDb", () => {
  describe("getApiKey", () => {
    it("returns api_key when user has one", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({ api_key: "pk_abc123" }),
      });
      const db = new D1CliAuthDb(client);

      const key = await db.getApiKey("user-1");

      expect(key).toBe("pk_abc123");
      expect(client.firstOrNull).toHaveBeenCalledWith(
        "SELECT api_key FROM users WHERE id = ?",
        ["user-1"],
      );
    });

    it("returns null when user has no api_key", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({ api_key: null }),
      });
      const db = new D1CliAuthDb(client);

      expect(await db.getApiKey("user-1")).toBeNull();
    });

    it("returns null when user not found", async () => {
      const client = createMockD1Client();
      const db = new D1CliAuthDb(client);

      expect(await db.getApiKey("nonexistent")).toBeNull();
    });
  });

  describe("setApiKey", () => {
    it("executes UPDATE with correct params", async () => {
      const client = createMockD1Client({
        execute: vi.fn().mockResolvedValue({ changes: 1, duration: 0 }),
      });
      const db = new D1CliAuthDb(client);

      await db.setApiKey("user-1", "pk_newkey");

      expect(client.execute).toHaveBeenCalledWith(
        "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
        ["pk_newkey", "user-1"],
      );
    });

    it("throws when UPDATE hits 0 rows (user not in D1)", async () => {
      const client = createMockD1Client({
        execute: vi.fn().mockResolvedValue({ changes: 0, duration: 0 }),
      });
      const db = new D1CliAuthDb(client);

      await expect(db.setApiKey("missing-user", "pk_key")).rejects.toThrow(
        /user missing-user not found in D1/,
      );
    });
  });

  describe("getUserByApiKey", () => {
    it("returns user when api_key matches", async () => {
      const client = createMockD1Client({
        firstOrNull: vi
          .fn()
          .mockResolvedValue({ id: "user-1", email: "u@e.com" }),
      });
      const db = new D1CliAuthDb(client);

      const user = await db.getUserByApiKey("pk_abc123");

      expect(user).toEqual({ id: "user-1", email: "u@e.com" });
      expect(client.firstOrNull).toHaveBeenCalledWith(
        "SELECT id, email FROM users WHERE api_key = ?",
        ["pk_abc123"],
      );
    });

    it("returns null when api_key not found", async () => {
      const client = createMockD1Client();
      const db = new D1CliAuthDb(client);

      expect(await db.getUserByApiKey("pk_invalid")).toBeNull();
    });
  });
});
