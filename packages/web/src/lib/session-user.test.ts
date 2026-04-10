/**
 * Tests for session-user helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("session-user", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getSessionUser", () => {
    it("returns E2E test user when E2E_SKIP_AUTH=true and NODE_ENV=development", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "true";
      (process.env as Record<string, string>).NODE_ENV = "development";

      // Mock auth to return null (should not be called in E2E mode)
      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue(null),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user).toEqual({
        id: "e2e-test-user-id",
        email: "e2e@test.local",
        name: "E2E Test User",
      });
    });

    it("returns null when not authenticated and not in E2E mode", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "false";
      (process.env as Record<string, string>).NODE_ENV = "production";

      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue(null),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user).toBeNull();
    });

    it("returns user from auth session", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "false";
      (process.env as Record<string, string>).NODE_ENV = "production";

      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue({
          user: {
            id: "user-123",
            email: "user@example.com",
            name: "Test User",
          },
        }),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user).toEqual({
        id: "user-123",
        email: "user@example.com",
        name: "Test User",
      });
    });

    it("handles user with null email and name", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "false";
      (process.env as Record<string, string>).NODE_ENV = "production";

      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue({
          user: {
            id: "user-456",
            email: null,
            name: null,
          },
        }),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user).toEqual({
        id: "user-456",
        email: undefined,
        name: undefined,
      });
    });

    it("returns null when auth returns session without user id", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "false";
      (process.env as Record<string, string>).NODE_ENV = "production";

      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue({ user: {} }),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user).toBeNull();
    });

    it("does not use E2E bypass when E2E_SKIP_AUTH is not true", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "false";
      (process.env as Record<string, string>).NODE_ENV = "development";

      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue({
          user: { id: "real-user", email: "real@user.com" },
        }),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user?.id).toBe("real-user");
    });

    it("does not use E2E bypass when NODE_ENV is not development", async () => {
      (process.env as Record<string, string>).E2E_SKIP_AUTH = "true";
      (process.env as Record<string, string>).NODE_ENV = "production";

      vi.doMock("./auth", () => ({
        auth: vi.fn().mockResolvedValue({
          user: { id: "prod-user", email: "prod@user.com" },
        }),
      }));

      const { getSessionUser } = await import("./session-user");
      const user = await getSessionUser();

      expect(user?.id).toBe("prod-user");
    });
  });
});
