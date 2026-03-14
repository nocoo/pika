import { describe, it, expect, vi } from "vitest";
import { D1AuthAdapter } from "./auth-adapter";
import type { D1Client } from "./d1";
import type { AdapterAccount } from "next-auth/adapters";

// ── Mock D1 client ─────────────────────────────────────────────

function createMockD1Client(overrides?: Partial<D1Client>): D1Client {
  return {
    query: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0, duration: 0 } }),
    execute: vi.fn().mockResolvedValue({ changes: 1, duration: 0 }),
    firstOrNull: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as D1Client;
}

// ── Tests ──────────────────────────────────────────────────────

describe("D1AuthAdapter", () => {
  describe("createUser", () => {
    it("inserts a user row and returns AdapterUser with id", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      const result = await adapter.createUser!({
        email: "test@example.com",
        name: "Test User",
        image: "https://example.com/avatar.png",
        emailVerified: new Date("2026-01-01T00:00:00Z"),
      } as any);

      expect(result.email).toBe("test@example.com");
      expect(result.name).toBe("Test User");
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(client.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO users"),
        expect.arrayContaining(["test@example.com", "Test User"]),
      );
    });

    it("preserves existing user.id when provided", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      const result = await adapter.createUser!({
        id: "custom-id-123",
        email: "user@e.com",
        name: null,
        image: null,
        emailVerified: null,
      } as any);

      expect(result.id).toBe("custom-id-123");
      expect(client.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO users"),
        expect.arrayContaining(["custom-id-123"]),
      );
    });

    it("handles null optional fields", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      const result = await adapter.createUser!({
        email: "minimal@e.com",
        emailVerified: null,
      } as any);

      expect(result.email).toBe("minimal@e.com");
      const params = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // name, image, emailVerified should be null
      expect(params[2]).toBeNull(); // name
      expect(params[3]).toBeNull(); // image
      expect(params[4]).toBeNull(); // emailVerified
    });
  });

  describe("getUser", () => {
    it("returns AdapterUser when found", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({
          id: "u1",
          email: "u@e.com",
          name: "User",
          image: null,
          email_verified: "2026-01-01T00:00:00Z",
        }),
      });
      const adapter = D1AuthAdapter(client);

      const result = await adapter.getUser!("u1");

      expect(result).toEqual({
        id: "u1",
        email: "u@e.com",
        name: "User",
        image: null,
        emailVerified: new Date("2026-01-01T00:00:00Z"),
      });
    });

    it("returns null when user not found", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      expect(await adapter.getUser!("nonexistent")).toBeNull();
    });
  });

  describe("getUserByEmail", () => {
    it("returns AdapterUser when found", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({
          id: "u1",
          email: "u@e.com",
          name: null,
          image: null,
          email_verified: null,
        }),
      });
      const adapter = D1AuthAdapter(client);

      const result = await adapter.getUserByEmail!("u@e.com");

      expect(result).toEqual({
        id: "u1",
        email: "u@e.com",
        name: null,
        image: null,
        emailVerified: null,
      });
    });

    it("returns null when email not found", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      expect(await adapter.getUserByEmail!("nobody@e.com")).toBeNull();
    });
  });

  describe("getUserByAccount", () => {
    it("returns AdapterUser when provider+account matches", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({
          id: "u1",
          email: "u@e.com",
          name: "User",
          image: "https://img.com/u.png",
          email_verified: null,
        }),
      });
      const adapter = D1AuthAdapter(client);

      const result = await adapter.getUserByAccount!({
        provider: "google",
        providerAccountId: "google-123",
      });

      expect(result).toEqual({
        id: "u1",
        email: "u@e.com",
        name: "User",
        image: "https://img.com/u.png",
        emailVerified: null,
      });
      expect(client.firstOrNull).toHaveBeenCalledWith(
        expect.stringContaining("JOIN accounts"),
        ["google", "google-123"],
      );
    });

    it("returns null when no matching account", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      expect(
        await adapter.getUserByAccount!({
          provider: "google",
          providerAccountId: "unknown",
        }),
      ).toBeNull();
    });
  });

  describe("updateUser", () => {
    it("updates provided fields and returns updated user", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({
          id: "u1",
          email: "new@e.com",
          name: "New Name",
          image: null,
          email_verified: null,
        }),
      });
      const adapter = D1AuthAdapter(client);

      const result = await adapter.updateUser!({
        id: "u1",
        name: "New Name",
        email: "new@e.com",
      } as any);

      expect(result.name).toBe("New Name");
      expect(result.email).toBe("new@e.com");
      expect(client.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users SET"),
        expect.arrayContaining(["New Name", "new@e.com", "u1"]),
      );
    });

    it("returns current user when no fields to update", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({
          id: "u1",
          email: "u@e.com",
          name: null,
          image: null,
          email_verified: null,
        }),
      });
      const adapter = D1AuthAdapter(client);

      const result = await adapter.updateUser!({ id: "u1" } as any);

      expect(result.id).toBe("u1");
      // execute should NOT be called (no fields to update)
      expect(client.execute).not.toHaveBeenCalled();
    });

    it("handles emailVerified update", async () => {
      const client = createMockD1Client({
        firstOrNull: vi.fn().mockResolvedValue({
          id: "u1",
          email: "u@e.com",
          name: null,
          image: null,
          email_verified: "2026-03-01T00:00:00.000Z",
        }),
      });
      const adapter = D1AuthAdapter(client);

      const result = await adapter.updateUser!({
        id: "u1",
        emailVerified: new Date("2026-03-01T00:00:00Z"),
      } as any);

      expect(result.emailVerified).toEqual(new Date("2026-03-01T00:00:00.000Z"));
      expect(client.execute).toHaveBeenCalledWith(
        expect.stringContaining("email_verified = ?"),
        expect.arrayContaining(["2026-03-01T00:00:00.000Z", "u1"]),
      );
    });
  });

  describe("linkAccount", () => {
    it("inserts an account row with all fields", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      const account: AdapterAccount = {
        userId: "u1",
        type: "oauth",
        provider: "google",
        providerAccountId: "google-123",
        access_token: "access-tok",
        refresh_token: "refresh-tok",
        expires_at: 1700000000,
      };

      const result = await adapter.linkAccount!(account);

      expect(result).toEqual(account);
      expect(client.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO accounts"),
        expect.arrayContaining([
          "u1",
          "oauth",
          "google",
          "google-123",
          "access-tok",
          "refresh-tok",
          1700000000,
        ]),
      );
    });

    it("handles null tokens gracefully", async () => {
      const client = createMockD1Client();
      const adapter = D1AuthAdapter(client);

      const account: AdapterAccount = {
        userId: "u1",
        type: "oauth",
        provider: "google",
        providerAccountId: "google-456",
      };

      await adapter.linkAccount!(account);

      const params = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // access_token, refresh_token, expires_at should be null
      expect(params[5]).toBeNull();
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });
});
