import { describe, expect, it, vi } from "vitest";
import type { D1Client } from "./d1";
import { D1CliAuthDb } from "./d1-cli-auth-db";

function createMockD1Client(overrides?: Partial<D1Client>): D1Client {
  return {
    query: vi
      .fn()
      .mockResolvedValue({ results: [], meta: { changes: 0, duration: 0 } }),
    execute: vi.fn().mockResolvedValue({ changes: 0, duration: 0 }),
    firstOrNull: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as D1Client;
}

describe("D1CliAuthDb", () => {
  describe("setApiKey", () => {
    it("executes UPDATE with correct params (stores hashed key)", async () => {
      const client = createMockD1Client({
        execute: vi.fn().mockResolvedValue({ changes: 1, duration: 0 }),
      });
      const db = new D1CliAuthDb(client);

      const hashedKey = "a".repeat(64); // SHA-256 hex digest
      await db.setApiKey("user-1", hashedKey);

      expect(client.execute).toHaveBeenCalledWith(
        "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
        [hashedKey, "user-1"],
      );
    });

    it("throws when UPDATE hits 0 rows (user not in D1)", async () => {
      const client = createMockD1Client({
        execute: vi.fn().mockResolvedValue({ changes: 0, duration: 0 }),
      });
      const db = new D1CliAuthDb(client);

      await expect(
        db.setApiKey("missing-user", "a".repeat(64)),
      ).rejects.toThrow(/user missing-user not found in D1/);
    });
  });

  describe("getUserByApiKey", () => {
    it("returns user when hashed api_key matches", async () => {
      const client = createMockD1Client({
        firstOrNull: vi
          .fn()
          .mockResolvedValue({ id: "user-1", email: "u@e.com" }),
      });
      const db = new D1CliAuthDb(client);

      const hashedKey = "b".repeat(64);
      const user = await db.getUserByApiKey(hashedKey);

      expect(user).toEqual({ id: "user-1", email: "u@e.com" });
      expect(client.firstOrNull).toHaveBeenCalledWith(
        "SELECT id, email FROM users WHERE api_key = ?",
        [hashedKey],
      );
    });

    it("returns null when hashed api_key not found", async () => {
      const client = createMockD1Client();
      const db = new D1CliAuthDb(client);

      expect(await db.getUserByApiKey("c".repeat(64))).toBeNull();
    });
  });
});
