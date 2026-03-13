import { describe, it, expect, vi, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";
import {
  gzipCompress,
  uploadSessionContent,
  uploadContentBatch,
} from "./content.js";
import type { ContentUploadOptions } from "./content.js";
import { AuthError, RetryExhaustedError, ClientError } from "./engine.js";
import type {
  CanonicalSession,
  RawSessionArchive,
} from "@pika/core";
import {
  INITIAL_BACKOFF_MS,
} from "@pika/core";

// ── Fixtures ───────────────────────────────────────────────────

function makeCanonical(overrides?: Partial<CanonicalSession>): CanonicalSession {
  return {
    sessionKey: "claude-code:test-session-1",
    source: "claude-code",
    parserRevision: 1,
    schemaVersion: 1,
    startedAt: "2026-01-01T00:00:00Z",
    lastMessageAt: "2026-01-01T00:10:00Z",
    durationSeconds: 600,
    projectRef: "abc123",
    projectName: "test-project",
    model: "claude-sonnet-4-20250514",
    title: "Test session",
    messages: [
      { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z" },
      {
        role: "assistant",
        content: "Hi there!",
        timestamp: "2026-01-01T00:00:05Z",
        inputTokens: 10,
        outputTokens: 20,
      },
    ],
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalCachedTokens: 0,
    snapshotAt: "2026-01-01T00:10:00Z",
    ...overrides,
  };
}

function makeRaw(overrides?: Partial<RawSessionArchive>): RawSessionArchive {
  return {
    sessionKey: "claude-code:test-session-1",
    source: "claude-code",
    parserRevision: 1,
    collectedAt: "2026-01-01T00:10:00Z",
    sourceFiles: [
      {
        path: "/home/user/.claude/projects/test/session.jsonl",
        format: "jsonl",
        content: '{"type":"user"}\n',
      },
    ],
    ...overrides,
  };
}

function makeOpts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
  return {
    apiUrl: "https://pika.test",
    apiKey: "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── gzipCompress ───────────────────────────────────────────────

describe("gzipCompress", () => {
  it("compresses a string to gzip buffer", () => {
    const input = '{"hello":"world"}';
    const compressed = gzipCompress(input);
    expect(Buffer.isBuffer(compressed)).toBe(true);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("decompresses back to original string", () => {
    const input = '{"hello":"world"}';
    const compressed = gzipCompress(input);
    const decompressed = gunzipSync(compressed).toString("utf-8");
    expect(decompressed).toBe(input);
  });

  it("compressed output is smaller for large inputs", () => {
    const input = JSON.stringify({ data: "x".repeat(10_000) });
    const compressed = gzipCompress(input);
    expect(compressed.length).toBeLessThan(input.length);
  });

  it("handles empty string", () => {
    const compressed = gzipCompress("");
    const decompressed = gunzipSync(compressed).toString("utf-8");
    expect(decompressed).toBe("");
  });

  it("handles unicode", () => {
    const input = '{"msg":"Hello, world!"}';
    const compressed = gzipCompress(input);
    const decompressed = gunzipSync(compressed).toString("utf-8");
    expect(decompressed).toBe(input);
  });
});

// ── uploadSessionContent ───────────────────────────────────────

describe("uploadSessionContent", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  function okResponse(status = 200): Response {
    return new Response(null, { status });
  }

  function errorResponse(status: number, body = ""): Response {
    return new Response(body, { status });
  }

  // ── Successful upload ──

  it("uploads canonical and raw content", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(201)) // canonical PUT
      .mockResolvedValueOnce(okResponse(201)); // raw PUT

    const result = await uploadSessionContent(canonical, raw, opts());

    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
    expect(result.contentHash).toHaveLength(64);
    expect(result.rawHash).toHaveLength(64);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("sends correct URL for canonical", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    await uploadSessionContent(canonical, raw, opts());

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://pika.test/api/ingest/content/claude-code%3Atest-session-1/canonical",
    );
  });

  it("sends correct URL for raw", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    await uploadSessionContent(canonical, raw, opts());

    const [url] = mockFetch.mock.calls[1];
    expect(url).toBe(
      "https://pika.test/api/ingest/content/claude-code%3Atest-session-1/raw",
    );
  });

  it("sends correct headers for canonical PUT", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    await uploadSessionContent(canonical, raw, opts());

    const init = mockFetch.mock.calls[0][1];
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["Content-Encoding"]).toBe("gzip");
    expect(init.headers.Authorization).toBe("Bearer pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(init.headers["X-Content-Hash"]).toHaveLength(64);
    expect(init.headers["X-Parser-Revision"]).toBe("1");
    expect(init.headers["X-Schema-Version"]).toBe("1");
  });

  it("sends correct headers for raw PUT", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    await uploadSessionContent(canonical, raw, opts());

    const init = mockFetch.mock.calls[1][1];
    expect(init.method).toBe("PUT");
    expect(init.headers["X-Raw-Hash"]).toHaveLength(64);
    // raw PUT should NOT have X-Content-Hash
    expect(init.headers["X-Content-Hash"]).toBeUndefined();
  });

  it("sends gzip-compressed body that decompresses to JSON", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    await uploadSessionContent(canonical, raw, opts());

    // Check canonical body
    const canonicalBody = mockFetch.mock.calls[0][1].body as Buffer;
    const canonicalJson = gunzipSync(canonicalBody).toString("utf-8");
    expect(JSON.parse(canonicalJson)).toEqual(canonical);

    // Check raw body
    const rawBody = mockFetch.mock.calls[1][1].body as Buffer;
    const rawJson = gunzipSync(rawBody).toString("utf-8");
    expect(JSON.parse(rawJson)).toEqual(raw);
  });

  // ── 204 no-op ──

  it("reports canonical not uploaded on 204", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(204)) // canonical no-op
      .mockResolvedValueOnce(okResponse(201)); // raw uploaded

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(false);
    expect(result.rawUploaded).toBe(true);
  });

  it("reports raw not uploaded on 204", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(201)) // canonical uploaded
      .mockResolvedValueOnce(okResponse(204)); // raw no-op

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(false);
  });

  it("reports both not uploaded on double 204", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(204))
      .mockResolvedValueOnce(okResponse(204));

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(false);
    expect(result.rawUploaded).toBe(false);
  });

  // ── Auth error ──

  it("throws AuthError on 401 for canonical PUT", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch.mockResolvedValueOnce(errorResponse(401));

    await expect(uploadSessionContent(canonical, raw, opts())).rejects.toThrow(
      AuthError,
    );
    // Should not attempt raw PUT after auth failure
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws AuthError on 401 for raw PUT", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(201)) // canonical OK
      .mockResolvedValueOnce(errorResponse(401)); // raw auth fail

    await expect(uploadSessionContent(canonical, raw, opts())).rejects.toThrow(
      AuthError,
    );
  });

  // ── 409 conflict ──

  it("throws ClientError on 409 version conflict", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch.mockResolvedValueOnce(
      errorResponse(409, "Version conflict: older revision"),
    );

    const err = await uploadSessionContent(canonical, raw, opts()).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(409);
  });

  // ── 5xx retry ──

  it("retries canonical PUT on 5xx with backoff", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(errorResponse(500)) // canonical retry 1
      .mockResolvedValueOnce(okResponse(201)) // canonical OK
      .mockResolvedValueOnce(okResponse(201)); // raw OK

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledWith(1000);
  });

  it("retries raw PUT on 5xx with backoff", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(201)) // canonical OK
      .mockResolvedValueOnce(errorResponse(502)) // raw retry 1
      .mockResolvedValueOnce(okResponse(201)); // raw OK

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.rawUploaded).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws RetryExhaustedError after max retries", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500));

    await expect(uploadSessionContent(canonical, raw, opts())).rejects.toThrow(
      RetryExhaustedError,
    );
  });

  // ── 429 rate limiting ──

  it("retries on 429 with Retry-After", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const headers429 = new Headers();
    headers429.set("Retry-After", "2");
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: headers429 }))
      .mockResolvedValueOnce(okResponse(201))
      .mockResolvedValueOnce(okResponse(201));

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(mockSleep).toHaveBeenCalledWith(2000);
  });

  // ── 4xx client error ──

  it("throws ClientError on 400", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch.mockResolvedValueOnce(errorResponse(400, "Bad request"));

    const err = await uploadSessionContent(canonical, raw, opts()).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(400);
    expect(err.body).toBe("Bad request");
  });

  // ── Hash determinism ──

  it("produces consistent hashes for same content", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch.mockResolvedValue(okResponse(201));

    const r1 = await uploadSessionContent(canonical, raw, opts());
    const r2 = await uploadSessionContent(canonical, raw, opts());
    expect(r1.contentHash).toBe(r2.contentHash);
    expect(r1.rawHash).toBe(r2.rawHash);
  });

  // ── URL encoding ──

  it("encodes sessionKey with special characters in URL", async () => {
    const canonical = makeCanonical({ sessionKey: "opencode:session/with:colons" });
    const raw = makeRaw({ sessionKey: "opencode:session/with:colons" });

    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    await uploadSessionContent(canonical, raw, opts());

    const canonicalUrl = mockFetch.mock.calls[0][0] as string;
    expect(canonicalUrl).toContain(encodeURIComponent("opencode:session/with:colons"));
    expect(canonicalUrl).not.toContain("opencode:session/with:colons/canonical");
  });
});

// ── uploadContentBatch ─────────────────────────────────────────

describe("uploadContentBatch", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  function okResponse(status = 201): Response {
    return new Response(null, { status });
  }

  function errorResponse(status: number, body = ""): Response {
    return new Response(body, { status });
  }

  it("returns zero results for empty input", async () => {
    const result = await uploadContentBatch([], opts());
    expect(result).toEqual({ uploaded: 0, skipped: 0, errors: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uploads all sessions successfully", async () => {
    const sessions = [
      { canonical: makeCanonical(), raw: makeRaw() },
      {
        canonical: makeCanonical({ sessionKey: "claude-code:session-2" }),
        raw: makeRaw({ sessionKey: "claude-code:session-2" }),
      },
    ];

    // Each session = 2 PUTs (canonical + raw)
    mockFetch.mockResolvedValue(okResponse());

    const result = await uploadContentBatch(sessions, opts());
    expect(result.uploaded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(4); // 2 sessions * 2 PUTs
  });

  it("counts skipped sessions (204 no-op)", async () => {
    const sessions = [{ canonical: makeCanonical(), raw: makeRaw() }];

    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // canonical no-op
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // raw no-op

    const result = await uploadContentBatch(sessions, opts());
    expect(result.uploaded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("counts as uploaded if either canonical or raw was uploaded", async () => {
    const sessions = [{ canonical: makeCanonical(), raw: makeRaw() }];

    mockFetch
      .mockResolvedValueOnce(okResponse()) // canonical uploaded
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // raw no-op

    const result = await uploadContentBatch(sessions, opts());
    expect(result.uploaded).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("collects errors per session and continues", async () => {
    const sessions = [
      { canonical: makeCanonical({ sessionKey: "claude-code:s1" }), raw: makeRaw({ sessionKey: "claude-code:s1" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s2" }), raw: makeRaw({ sessionKey: "claude-code:s2" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s3" }), raw: makeRaw({ sessionKey: "claude-code:s3" }) },
    ];

    mockFetch
      // s1: OK
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse())
      // s2: 409 conflict (will be caught as error)
      .mockResolvedValueOnce(errorResponse(409, "conflict"))
      // s3: OK
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    const result = await uploadContentBatch(sessions, opts());
    expect(result.uploaded).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionKey).toBe("claude-code:s2");
    expect(result.errors[0].error).toContain("409");
  });

  it("propagates AuthError immediately (does not continue)", async () => {
    const sessions = [
      { canonical: makeCanonical({ sessionKey: "claude-code:s1" }), raw: makeRaw({ sessionKey: "claude-code:s1" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s2" }), raw: makeRaw({ sessionKey: "claude-code:s2" }) },
    ];

    mockFetch
      // s1: 401
      .mockResolvedValueOnce(errorResponse(401));

    await expect(uploadContentBatch(sessions, opts())).rejects.toThrow(AuthError);
    // Should not have attempted s2
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("collects RetryExhaustedError per session and continues", async () => {
    const sessions = [
      { canonical: makeCanonical({ sessionKey: "claude-code:s1" }), raw: makeRaw({ sessionKey: "claude-code:s1" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s2" }), raw: makeRaw({ sessionKey: "claude-code:s2" }) },
    ];

    mockFetch
      // s1: all retries fail
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      // s2: OK
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    const result = await uploadContentBatch(sessions, opts());
    expect(result.uploaded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionKey).toBe("claude-code:s1");
  });
});
