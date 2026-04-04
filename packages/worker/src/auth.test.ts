/**
 * Worker auth module tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, hashApiKey, validateAuth } from "./auth";

describe("hashApiKey", () => {
  it("returns consistent SHA-256 hex digest", async () => {
    const hash = await hashApiKey("pk_abc123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Same input should produce same hash
    const hash2 = await hashApiKey("pk_abc123");
    expect(hash2).toBe(hash);
  });

  it("produces different hashes for different inputs", async () => {
    const hash1 = await hashApiKey("pk_abc123");
    const hash2 = await hashApiKey("pk_xyz789");
    expect(hash1).not.toBe(hash2);
  });
});

describe("validateAuth", () => {
  const WORKER_SECRET = "test-secret";

  function createMockDb(user: { id: string } | null) {
    return {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(user),
        }),
      }),
    } as unknown as D1Database;
  }

  it("returns invalid for missing Authorization header", async () => {
    const request = new Request("https://example.com", {});
    const db = createMockDb(null);

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result.valid).toBe(false);
  });

  it("returns invalid for non-Bearer auth", async () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Basic abc123" },
    });
    const db = createMockDb(null);

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result.valid).toBe(false);
  });

  it("validates WORKER_SECRET with X-User-Id", async () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
        "X-User-Id": "user-123",
      },
    });
    const db = createMockDb(null);

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result).toEqual({
      valid: true,
      userId: "user-123",
      source: "internal",
    });
  });

  it("returns invalid for WORKER_SECRET without X-User-Id", async () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });
    const db = createMockDb(null);

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result.valid).toBe(false);
  });

  it("validates API key via DB lookup", async () => {
    const apiKey = "pk_abcdef1234567890abcdef1234567890";
    const request = new Request("https://example.com", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const db = createMockDb({ id: "user-456" });

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result).toEqual({
      valid: true,
      userId: "user-456",
      source: "api_key",
    });

    // Verify DB was queried with hashed key
    expect(db.prepare).toHaveBeenCalledWith(
      "SELECT id FROM users WHERE api_key = ?",
    );
  });

  it("returns invalid for unknown API key", async () => {
    const apiKey = "pk_unknown";
    const request = new Request("https://example.com", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const db = createMockDb(null);

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result.valid).toBe(false);
  });

  it("returns invalid for unknown token format", async () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer random-token" },
    });
    const db = createMockDb(null);

    const result = await validateAuth(request, WORKER_SECRET, db);

    expect(result.valid).toBe(false);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Rate limits use a module-level Map, so we test behavior across calls
  });

  it("allows first request", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key, 10, 1000)).toBe(true);
  });

  it("allows requests up to limit", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60000)).toBe(true);
    }
  });

  it("blocks requests over limit", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    // Use up the limit
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, 60000);
    }
    // Next request should be blocked
    expect(checkRateLimit(key, 3, 60000)).toBe(false);
  });

  it("resets after window expires", async () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    // Use up the limit with a very short window
    for (let i = 0; i < 2; i++) {
      checkRateLimit(key, 2, 10); // 10ms window
    }
    expect(checkRateLimit(key, 2, 10)).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 15));

    // Should allow again
    expect(checkRateLimit(key, 2, 10)).toBe(true);
  });
});
