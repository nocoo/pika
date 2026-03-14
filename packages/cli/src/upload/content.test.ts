import { describe, it, expect, vi, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";
import {
  gzipCompress,
  uploadSessionContent,
  uploadContentBatch,
  requestPresignedUrl,
  uploadToPresignedUrl,
  confirmRawUpload,
  uploadRawDirect,
} from "./content";
import type { ContentUploadOptions } from "./content";
import { AuthError, RetryExhaustedError, ClientError } from "./engine";
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

  function presignOk(): Response {
    return new Response(
      JSON.stringify({ url: "https://r2.example.com/presigned", key: "k" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  function confirmOk(): Response {
    return new Response(JSON.stringify({ confirmed: true }), { status: 200 });
  }

  /** Mock sequence for a successful canonical + presigned raw upload (4 calls) */
  function mockSuccessfulUpload(canonicalStatus = 201, r2Status = 200) {
    mockFetch
      .mockResolvedValueOnce(okResponse(canonicalStatus)) // 1. canonical PUT
      .mockResolvedValueOnce(presignOk())                 // 2. presign request
      .mockResolvedValueOnce(okResponse(r2Status))        // 3. R2 PUT
      .mockResolvedValueOnce(confirmOk());                // 4. confirm
  }

  // ── Successful upload ──

  it("uploads canonical and raw content via presigned flow", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockSuccessfulUpload();

    const result = await uploadSessionContent(canonical, raw, opts());

    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
    expect(result.contentHash).toHaveLength(64);
    expect(result.rawHash).toHaveLength(64);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("sends correct URL for canonical", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockSuccessfulUpload();

    await uploadSessionContent(canonical, raw, opts());

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://pika.test/api/ingest/content/claude-code%3Atest-session-1/canonical",
    );
  });

  it("sends correct headers for canonical PUT", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockSuccessfulUpload();

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

  it("sends gzip-compressed canonical body that decompresses to JSON", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockSuccessfulUpload();

    await uploadSessionContent(canonical, raw, opts());

    // Check canonical body
    const canonicalBody = mockFetch.mock.calls[0][1].body as Buffer;
    const canonicalJson = gunzipSync(canonicalBody).toString("utf-8");
    expect(JSON.parse(canonicalJson)).toEqual(canonical);
  });

  // ── 204 no-op ──

  it("reports canonical not uploaded on 204", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(okResponse(204))  // canonical no-op
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(okResponse(200))
      .mockResolvedValueOnce(confirmOk());

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(false);
    expect(result.rawUploaded).toBe(true);
  });

  // ── Auth error ──

  it("throws AuthError on 401 for canonical PUT", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch.mockResolvedValueOnce(errorResponse(401));

    await expect(uploadSessionContent(canonical, raw, opts())).rejects.toThrow(
      AuthError,
    );
    // Should not attempt raw upload after auth failure
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── 409 conflict ──

  it("throws ClientError on 409 version conflict for canonical", async () => {
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
      .mockResolvedValueOnce(okResponse(201))     // canonical OK
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(okResponse(200))
      .mockResolvedValueOnce(confirmOk());

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(mockSleep).toHaveBeenCalledWith(1000);
  });

  it("throws RetryExhaustedError after max retries on canonical", async () => {
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

  it("retries canonical on 429 with Retry-After", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const headers429 = new Headers();
    headers429.set("Retry-After", "2");
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: headers429 }))
      .mockResolvedValueOnce(okResponse(201))
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(okResponse(200))
      .mockResolvedValueOnce(confirmOk());

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(mockSleep).toHaveBeenCalledWith(2000);
  });

  // ── 4xx client error ──

  it("throws ClientError on 400 for canonical", async () => {
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
    // Override: use mockResolvedValue for all calls — need presign+confirm too
    mockFetch.mockReset();
    mockFetch
      // First call
      .mockResolvedValueOnce(okResponse(201))
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(okResponse(200))
      .mockResolvedValueOnce(confirmOk())
      // Second call
      .mockResolvedValueOnce(okResponse(201))
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(okResponse(200))
      .mockResolvedValueOnce(confirmOk());

    const r1 = await uploadSessionContent(canonical, raw, opts());
    const r2 = await uploadSessionContent(canonical, raw, opts());
    expect(r1.contentHash).toBe(r2.contentHash);
    expect(r1.rawHash).toBe(r2.rawHash);
  });

  // ── URL encoding ──

  it("encodes sessionKey with special characters in URL", async () => {
    const canonical = makeCanonical({ sessionKey: "opencode:session/with:colons" });
    const raw = makeRaw({ sessionKey: "opencode:session/with:colons" });

    mockSuccessfulUpload();

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

  function presignOk(): Response {
    return new Response(
      JSON.stringify({ url: "https://r2.example.com/presigned", key: "k" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  function confirmOk(): Response {
    return new Response(JSON.stringify({ confirmed: true }), { status: 200 });
  }

  /** Mock 4 calls for one successful session upload */
  function mockOneSession(canonicalStatus = 201, r2Status = 200) {
    mockFetch
      .mockResolvedValueOnce(okResponse(canonicalStatus))
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(okResponse(r2Status))
      .mockResolvedValueOnce(confirmOk());
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

    // Each session = 4 calls (canonical + presign + R2 PUT + confirm)
    mockOneSession();
    mockOneSession();

    const result = await uploadContentBatch(sessions, opts(), 1);
    expect(result.uploaded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(8); // 2 sessions * 4 calls
  });

  it("counts skipped sessions (canonical 204 + raw presigned still uploads)", async () => {
    const sessions = [{ canonical: makeCanonical(), raw: makeRaw() }];

    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // canonical no-op
      .mockResolvedValueOnce(presignOk())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(confirmOk());

    const result = await uploadContentBatch(sessions, opts(), 1);
    // raw was uploaded via presign, so it counts as uploaded (not skipped)
    expect(result.uploaded).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("collects errors per session and continues", async () => {
    const sessions = [
      { canonical: makeCanonical({ sessionKey: "claude-code:s1" }), raw: makeRaw({ sessionKey: "claude-code:s1" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s2" }), raw: makeRaw({ sessionKey: "claude-code:s2" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s3" }), raw: makeRaw({ sessionKey: "claude-code:s3" }) },
    ];

    // s1: OK (4 calls)
    mockOneSession();
    // s2: 409 conflict on canonical
    mockFetch.mockResolvedValueOnce(errorResponse(409, "conflict"));
    // s3: OK (4 calls)
    mockOneSession();

    const result = await uploadContentBatch(sessions, opts(), 1);
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
      // s1: 401 on canonical
      .mockResolvedValueOnce(errorResponse(401));

    await expect(uploadContentBatch(sessions, opts(), 1)).rejects.toThrow(AuthError);
    // Should not have attempted s2
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("collects RetryExhaustedError per session and continues", async () => {
    const sessions = [
      { canonical: makeCanonical({ sessionKey: "claude-code:s1" }), raw: makeRaw({ sessionKey: "claude-code:s1" }) },
      { canonical: makeCanonical({ sessionKey: "claude-code:s2" }), raw: makeRaw({ sessionKey: "claude-code:s2" }) },
    ];

    mockFetch
      // s1: all canonical retries fail
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500));
    // s2: OK
    mockOneSession();

    const result = await uploadContentBatch(sessions, opts(), 1);
    expect(result.uploaded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionKey).toBe("claude-code:s1");
  });

  it("uploads concurrently with multiple workers", async () => {
    // Track concurrent execution via timestamps
    const callOrder: string[] = [];
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      canonical: makeCanonical({ sessionKey: `claude-code:s${i}` }),
      raw: makeRaw({ sessionKey: `claude-code:s${i}` }),
    }));

    // Use a custom fetch that records call order and resolves immediately
    const concurrentFetch = vi.fn().mockImplementation((url: string) => {
      const path = new URL(url).pathname;
      callOrder.push(path);
      if (path.endsWith("/presign")) {
        return Promise.resolve(
          new Response(JSON.stringify({ url: "https://r2.example.com/p", key: "k" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (path.endsWith("/confirm-raw")) {
        return Promise.resolve(new Response(JSON.stringify({ confirmed: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 201 }));
    });

    const result = await uploadContentBatch(
      sessions,
      { apiUrl: "https://pika.test", apiKey: "pk_test", fetch: concurrentFetch, sleep: mockSleep },
      4,
    );
    expect(result.uploaded).toBe(4);
    expect(result.errors).toEqual([]);
    expect(concurrentFetch).toHaveBeenCalledTimes(16); // 4 sessions * 4 calls
  });
});

// ── requestPresignedUrl ────────────────────────────────────────

describe("requestPresignedUrl", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, ...overrides });
  }

  it("sends correct request and returns url + key", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://r2.example.com/presigned", key: "u1/key/raw/abc.json.gz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await requestPresignedUrl("claude-code:s1", "abc123ff", opts());

    expect(result.url).toBe("https://r2.example.com/presigned");
    expect(result.key).toBe("u1/key/raw/abc.json.gz");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://pika.test/api/ingest/presign");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toContain("Bearer");
    expect(JSON.parse(init.body)).toEqual({ sessionKey: "claude-code:s1", rawHash: "abc123ff" });
  });

  it("throws AuthError on 401", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(requestPresignedUrl("key", "hash1234", opts())).rejects.toThrow(AuthError);
  });

  it("throws ClientError on 400", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Bad request", { status: 400 }));
    const err = await requestPresignedUrl("key", "hash1234", opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(400);
  });

  it("throws ClientError when response is missing url", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: "k" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const err = await requestPresignedUrl("key", "hash1234", opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.body).toContain("missing url or key");
  });
});

// ── uploadToPresignedUrl ───────────────────────────────────────

describe("uploadToPresignedUrl", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  it("PUTs body to presigned URL with correct headers", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const body = gzipCompress('{"test":true}');

    await uploadToPresignedUrl("https://r2.example.com/presigned", body, opts());

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://r2.example.com/presigned");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/gzip");
    // No Authorization header — presigned URL handles auth
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("succeeds on 201", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));
    await expect(uploadToPresignedUrl("https://r2.example.com/p", Buffer.from("data"), opts())).resolves.toBeUndefined();
  });

  it("retries on 5xx with backoff", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await uploadToPresignedUrl("https://r2.example.com/p", Buffer.from("data"), opts());

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(INITIAL_BACKOFF_MS);
  });

  it("throws ClientError on 4xx", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const err = await uploadToPresignedUrl("https://r2.example.com/p", Buffer.from("data"), opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(403);
  });

  it("throws RetryExhaustedError after max retries", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(
      uploadToPresignedUrl("https://r2.example.com/p", Buffer.from("data"), opts()),
    ).rejects.toThrow(RetryExhaustedError);
  });
});

// ── confirmRawUpload ───────────────────────────────────────────

describe("confirmRawUpload", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, ...overrides });
  }

  it("sends correct confirm request", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
    );

    await confirmRawUpload("claude-code:s1", "hash1234", 2048, opts());

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://pika.test/api/ingest/confirm-raw");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toContain("Bearer");
    expect(JSON.parse(init.body)).toEqual({
      sessionKey: "claude-code:s1",
      rawHash: "hash1234",
      rawSize: 2048,
    });
  });

  it("throws AuthError on 401", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(confirmRawUpload("key", "hash", 100, opts())).rejects.toThrow(AuthError);
  });

  it("throws ClientError on 404", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const err = await confirmRawUpload("key", "hash", 100, opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(404);
  });
});

// ── uploadRawDirect ────────────────────────────────────────────

describe("uploadRawDirect", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  it("completes full presigned upload flow", async () => {
    const rawGzip = gzipCompress('{"raw":true}');

    // 1. presign request
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://r2.example.com/presigned", key: "k" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // 2. R2 PUT
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // 3. confirm
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
    );

    const result = await uploadRawDirect("claude-code:s1", "hash1234", rawGzip, opts());
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify sequence: presign → R2 PUT → confirm
    expect(mockFetch.mock.calls[0][0]).toBe("https://pika.test/api/ingest/presign");
    expect(mockFetch.mock.calls[1][0]).toBe("https://r2.example.com/presigned");
    expect(mockFetch.mock.calls[2][0]).toBe("https://pika.test/api/ingest/confirm-raw");
  });

  it("propagates AuthError from presign", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(
      uploadRawDirect("key", "hash1234", Buffer.from("data"), opts()),
    ).rejects.toThrow(AuthError);
  });

  it("propagates AuthError from confirm", async () => {
    // presign OK
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://r2/p", key: "k" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // R2 PUT OK
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // confirm 401
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(
      uploadRawDirect("key", "hash1234", Buffer.from("data"), opts()),
    ).rejects.toThrow(AuthError);
  });
});

// ── uploadSessionContent with presigned URL ────────────────────

describe("uploadSessionContent (presigned flow)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(overrides?: Partial<ContentUploadOptions>): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  it("uses presigned URL for raw upload", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      // 1. canonical proxy PUT
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      // 2. presign request
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://r2/presigned", key: "k" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      // 3. R2 PUT
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      // 4. confirm
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
      );

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("falls back to proxy when presigned URL fails", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      // 1. canonical proxy PUT
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      // 2. presign request fails (500)
      .mockResolvedValueOnce(new Response("Internal error", { status: 500 }))
      // 3. fallback: raw proxy PUT
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const result = await uploadSessionContent(canonical, raw, opts());
    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
    // 3 calls: canonical + presign fail + fallback raw
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("propagates AuthError from presigned flow", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      // 1. canonical proxy PUT
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      // 2. presign returns 401
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(uploadSessionContent(canonical, raw, opts())).rejects.toThrow(AuthError);
  });
});
