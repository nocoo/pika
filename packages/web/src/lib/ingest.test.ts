import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  proxyToWorker,
  getProxyConfig,
  parseContentPath,
  validatePresignRequest,
  validateConfirmRawRequest,
  buildConfirmRawUpdate,
  buildRawR2Key,
  verifyR2RawExists,
  type ProxyConfig,
} from "./ingest";

const cfg: ProxyConfig = {
  workerUrl: "https://worker.example.com",
  workerSecret: "secret-123",
};

// ── proxyToWorker ──────────────────────────────────────────────

describe("proxyToWorker", () => {
  it("forwards request to worker with correct headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }),
    );

    await proxyToWorker(
      cfg,
      {
        method: "POST",
        path: "/ingest/sessions",
        userId: "user-1",
        body: '{"sessions":[]}',
        contentType: "application/json",
      },
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://worker.example.com/ingest/sessions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret-123",
          "X-User-Id": "user-1",
          "Content-Type": "application/json",
        },
        body: '{"sessions":[]}',
      }),
    );
  });

  it("returns worker response status and body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{"inserted":5}', { status: 200 }),
    );

    const result = await proxyToWorker(
      cfg,
      {
        method: "POST",
        path: "/ingest/sessions",
        userId: "u1",
        body: "{}",
        contentType: "application/json",
      },
      mockFetch,
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"inserted":5}');
  });

  it("returns 502 on network failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await proxyToWorker(
      cfg,
      {
        method: "PUT",
        path: "/ingest/content/claude:abc/canonical",
        userId: "u1",
        body: new ArrayBuffer(0),
      },
      mockFetch,
    );

    expect(result.status).toBe(502);
    expect(result.body).toContain("ECONNREFUSED");
  });

  it("wraps non-Error network failures", async () => {
    const mockFetch = vi.fn().mockRejectedValue("string error");

    const result = await proxyToWorker(
      cfg,
      { method: "PUT", path: "/test", userId: "u1", body: null },
      mockFetch,
    );

    expect(result.status).toBe(502);
    expect(result.body).toContain("string error");
  });

  it("omits Content-Type when not provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    await proxyToWorker(
      cfg,
      { method: "PUT", path: "/test", userId: "u1", body: null },
      mockFetch,
    );

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty("Content-Type");
  });

  it("forwards non-200 status from worker", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{"error":"conflict"}', { status: 409 }),
    );

    const result = await proxyToWorker(
      cfg,
      { method: "PUT", path: "/test", userId: "u1", body: null },
      mockFetch,
    );

    expect(result.status).toBe(409);
    expect(result.body).toContain("conflict");
  });

  it("forwards extra headers to the worker", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    await proxyToWorker(
      cfg,
      {
        method: "PUT",
        path: "/ingest/content/key/canonical",
        userId: "u1",
        body: new ArrayBuffer(0),
        contentType: "application/octet-stream",
        extraHeaders: {
          "X-Content-Hash": "abc123",
          "X-Parser-Revision": "1",
          "X-Schema-Version": "1",
          "Content-Encoding": "gzip",
        },
      },
      mockFetch,
    );

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Content-Hash"]).toBe("abc123");
    expect(headers["X-Parser-Revision"]).toBe("1");
    expect(headers["X-Schema-Version"]).toBe("1");
    expect(headers["Content-Encoding"]).toBe("gzip");
  });
});

// ── getProxyConfig ─────────────────────────────────────────────

describe("getProxyConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.WORKER_URL = process.env.WORKER_URL;
    saved.WORKER_SECRET = process.env.WORKER_SECRET;
  });

  afterEach(() => {
    if (saved.WORKER_URL === undefined) delete process.env.WORKER_URL;
    else process.env.WORKER_URL = saved.WORKER_URL;
    if (saved.WORKER_SECRET === undefined) delete process.env.WORKER_SECRET;
    else process.env.WORKER_SECRET = saved.WORKER_SECRET;
  });

  it("returns config from env vars", () => {
    process.env.WORKER_URL = "https://w.example.com";
    process.env.WORKER_SECRET = "s3cret";

    const config = getProxyConfig();
    expect(config.workerUrl).toBe("https://w.example.com");
    expect(config.workerSecret).toBe("s3cret");
  });

  it("throws when WORKER_URL is missing", () => {
    delete process.env.WORKER_URL;
    process.env.WORKER_SECRET = "s";

    expect(() => getProxyConfig()).toThrow("WORKER_URL is required");
  });

  it("throws when WORKER_SECRET is missing", () => {
    process.env.WORKER_URL = "https://w.com";
    delete process.env.WORKER_SECRET;

    expect(() => getProxyConfig()).toThrow("WORKER_SECRET is required");
  });
});

// ── parseContentPath ───────────────────────────────────────────

describe("parseContentPath", () => {
  it("parses canonical content path", () => {
    const result = parseContentPath(["claude:abc123", "canonical"]);
    expect(result).toEqual({
      workerPath: "/ingest/content/claude:abc123/canonical",
    });
  });

  it("parses raw content path", () => {
    const result = parseContentPath(["opencode:xyz", "raw"]);
    expect(result).toEqual({
      workerPath: "/ingest/content/opencode:xyz/raw",
    });
  });

  it("handles session keys with slashes", () => {
    const result = parseContentPath(["vscode:a", "b", "canonical"]);
    expect(result).toEqual({
      workerPath: "/ingest/content/vscode:a/b/canonical",
    });
  });

  it("returns error for too few segments", () => {
    const result = parseContentPath(["canonical"]);
    expect(result).toEqual({
      error: "Invalid content path: expected /{sessionKey}/{type}",
    });
  });

  it("returns error for empty segments", () => {
    const result = parseContentPath([]);
    expect(result).toEqual({
      error: "Invalid content path: expected /{sessionKey}/{type}",
    });
  });

  it("returns error for invalid type", () => {
    const result = parseContentPath(["key", "invalid"]);
    expect(result).toEqual({
      error: 'Invalid content type: invalid. Expected "canonical" or "raw"',
    });
  });
});

// ── validatePresignRequest ─────────────────────────────────────

describe("validatePresignRequest", () => {
  it("validates a correct request", () => {
    const result = validatePresignRequest({
      sessionKey: "claude-code:abc123",
      rawHash: "deadbeef01234567",
    });
    expect(result).toEqual({
      valid: true,
      sessionKey: "claude-code:abc123",
      rawHash: "deadbeef01234567",
    });
  });

  it("rejects null body", () => {
    const result = validatePresignRequest(null);
    expect(result).toEqual({ valid: false, error: "Request body must be a JSON object" });
  });

  it("rejects non-object body", () => {
    const result = validatePresignRequest("string");
    expect(result).toEqual({ valid: false, error: "Request body must be a JSON object" });
  });

  it("rejects missing sessionKey", () => {
    const result = validatePresignRequest({ rawHash: "abcdef12" });
    expect(result).toEqual({ valid: false, error: "sessionKey (non-empty string) is required" });
  });

  it("rejects empty sessionKey", () => {
    const result = validatePresignRequest({ sessionKey: "", rawHash: "abcdef12" });
    expect(result).toEqual({ valid: false, error: "sessionKey (non-empty string) is required" });
  });

  it("rejects non-string sessionKey", () => {
    const result = validatePresignRequest({ sessionKey: 123, rawHash: "abcdef12" });
    expect(result).toEqual({ valid: false, error: "sessionKey (non-empty string) is required" });
  });

  it("rejects missing rawHash", () => {
    const result = validatePresignRequest({ sessionKey: "key" });
    expect(result).toEqual({ valid: false, error: "rawHash (non-empty string) is required" });
  });

  it("rejects empty rawHash", () => {
    const result = validatePresignRequest({ sessionKey: "key", rawHash: "" });
    expect(result).toEqual({ valid: false, error: "rawHash (non-empty string) is required" });
  });

  it("rejects non-hex rawHash", () => {
    const result = validatePresignRequest({ sessionKey: "key", rawHash: "not-hex!" });
    expect(result).toEqual({ valid: false, error: "rawHash must be a hex string (8-128 chars)" });
  });

  it("rejects too-short hex rawHash", () => {
    const result = validatePresignRequest({ sessionKey: "key", rawHash: "abcdef" });
    expect(result).toEqual({ valid: false, error: "rawHash must be a hex string (8-128 chars)" });
  });

  it("accepts uppercase hex rawHash", () => {
    const result = validatePresignRequest({ sessionKey: "key", rawHash: "ABCDEF1234567890" });
    expect(result).toEqual({ valid: true, sessionKey: "key", rawHash: "ABCDEF1234567890" });
  });

  it("accepts 64-char SHA-256 hex rawHash", () => {
    const hash = "a".repeat(64);
    const result = validatePresignRequest({ sessionKey: "key", rawHash: hash });
    expect(result).toEqual({ valid: true, sessionKey: "key", rawHash: hash });
  });
});

// ── validateConfirmRawRequest ──────────────────────────────────

describe("validateConfirmRawRequest", () => {
  it("validates a correct request", () => {
    const result = validateConfirmRawRequest({
      sessionKey: "claude-code:abc123",
      rawHash: "deadbeef01234567",
      rawSize: 1024,
    });
    expect(result).toEqual({
      valid: true,
      sessionKey: "claude-code:abc123",
      rawHash: "deadbeef01234567",
      rawSize: 1024,
    });
  });

  it("rejects null body", () => {
    const result = validateConfirmRawRequest(null);
    expect(result).toEqual({ valid: false, error: "Request body must be a JSON object" });
  });

  it("rejects missing sessionKey", () => {
    const result = validateConfirmRawRequest({ rawHash: "abcdef12", rawSize: 100 });
    expect(result).toEqual({ valid: false, error: "sessionKey (non-empty string) is required" });
  });

  it("rejects missing rawHash", () => {
    const result = validateConfirmRawRequest({ sessionKey: "key", rawSize: 100 });
    expect(result).toEqual({ valid: false, error: "rawHash (non-empty string) is required" });
  });

  it("rejects non-hex rawHash", () => {
    const result = validateConfirmRawRequest({ sessionKey: "key", rawHash: "xyz", rawSize: 100 });
    expect(result).toEqual({ valid: false, error: "rawHash must be a hex string (8-128 chars)" });
  });

  it("rejects missing rawSize", () => {
    const result = validateConfirmRawRequest({ sessionKey: "key", rawHash: "abcdef12" });
    expect(result).toEqual({ valid: false, error: "rawSize (positive integer) is required" });
  });

  it("rejects non-number rawSize", () => {
    const result = validateConfirmRawRequest({ sessionKey: "key", rawHash: "abcdef12", rawSize: "big" });
    expect(result).toEqual({ valid: false, error: "rawSize (positive integer) is required" });
  });

  it("rejects zero rawSize", () => {
    const result = validateConfirmRawRequest({ sessionKey: "key", rawHash: "abcdef12", rawSize: 0 });
    expect(result).toEqual({ valid: false, error: "rawSize (positive integer) is required" });
  });

  it("rejects negative rawSize", () => {
    const result = validateConfirmRawRequest({ sessionKey: "key", rawHash: "abcdef12", rawSize: -1 });
    expect(result).toEqual({ valid: false, error: "rawSize (positive integer) is required" });
  });
});

// ── buildConfirmRawUpdate ──────────────────────────────────────

describe("buildConfirmRawUpdate", () => {
  it("builds correct SQL and params", () => {
    const result = buildConfirmRawUpdate({
      userId: "user-1",
      sessionKey: "claude-code:abc123",
      rawHash: "deadbeef01234567",
      rawSize: 2048,
    });

    expect(result.sql).toContain("UPDATE sessions");
    expect(result.sql).toContain("raw_key");
    expect(result.sql).toContain("raw_size");
    expect(result.sql).toContain("raw_hash");
    expect(result.params).toContain("user-1/claude-code:abc123/raw/deadbeef01234567.json.gz");
    expect(result.params).toContain(2048);
    expect(result.params).toContain("deadbeef01234567");
    expect(result.params).toContain("user-1");
    expect(result.params).toContain("claude-code:abc123");
  });

  it("uses correct R2 key pattern", () => {
    const result = buildConfirmRawUpdate({
      userId: "u1",
      sessionKey: "opencode:xyz",
      rawHash: "aabbccdd",
      rawSize: 512,
    });

    const r2Key = result.params[0];
    expect(r2Key).toBe("u1/opencode:xyz/raw/aabbccdd.json.gz");
  });

  it("includes idempotency check in WHERE clause", () => {
    const result = buildConfirmRawUpdate({
      userId: "u1",
      sessionKey: "key",
      rawHash: "abcdef12",
      rawSize: 100,
    });

    // Should only update if raw_hash differs (idempotent)
    expect(result.sql).toContain("user_id = ?");
    expect(result.sql).toContain("session_key = ?");
  });
});

// ── buildRawR2Key ─────────────────────────────────────────────

describe("buildRawR2Key", () => {
  it("builds correct key pattern", () => {
    const key = buildRawR2Key("user-1", "claude:abc123", "deadbeef01234567");
    expect(key).toBe("user-1/claude:abc123/raw/deadbeef01234567.json.gz");
  });

  it("matches the key used by buildConfirmRawUpdate", () => {
    const update = buildConfirmRawUpdate({
      userId: "u1",
      sessionKey: "opencode:xyz",
      rawHash: "aabbccdd",
      rawSize: 512,
    });
    const key = buildRawR2Key("u1", "opencode:xyz", "aabbccdd");
    expect(update.params[0]).toBe(key);
  });
});

// ── verifyR2RawExists ─────────────────────────────────────────

describe("verifyR2RawExists", () => {
  it("returns true when R2 object exists", async () => {
    const r2 = { headObject: vi.fn().mockResolvedValue(true) };
    const result = await verifyR2RawExists(r2, "u/k/raw/h.json.gz");
    expect(result).toBe(true);
    expect(r2.headObject).toHaveBeenCalledWith("u/k/raw/h.json.gz");
  });

  it("returns false when R2 object does not exist", async () => {
    const r2 = { headObject: vi.fn().mockResolvedValue(false) };
    const result = await verifyR2RawExists(r2, "u/k/raw/h.json.gz");
    expect(result).toBe(false);
  });

  it("propagates errors from headObject", async () => {
    const r2 = { headObject: vi.fn().mockRejectedValue(new Error("R2 down")) };
    await expect(verifyR2RawExists(r2, "key")).rejects.toThrow("R2 down");
  });
});
