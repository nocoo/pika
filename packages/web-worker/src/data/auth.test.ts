/**
 * Worker auth module tests.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, validateAuth } from "./auth";

describe("validateAuth", () => {
  const WORKER_SECRET = "test-secret";

  it("returns invalid for missing Authorization header", async () => {
    const request = new Request("https://example.com", {});

    const result = await validateAuth(request, WORKER_SECRET);

    expect(result.valid).toBe(false);
  });

  it("returns invalid for non-Bearer auth", async () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Basic abc123" },
    });

    const result = await validateAuth(request, WORKER_SECRET);

    expect(result.valid).toBe(false);
  });

  it("validates WORKER_SECRET with X-User-Id", async () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
        "X-User-Id": "user-123",
      },
    });

    const result = await validateAuth(request, WORKER_SECRET);

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

    const result = await validateAuth(request, WORKER_SECRET);

    expect(result.valid).toBe(false);
  });

  it("returns invalid for unknown token", async () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer random-token" },
    });

    const result = await validateAuth(request, WORKER_SECRET);

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
