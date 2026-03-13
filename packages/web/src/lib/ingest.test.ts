import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  proxyToWorker,
  getProxyConfig,
  parseContentPath,
  type ProxyConfig,
} from "./ingest.js";

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
