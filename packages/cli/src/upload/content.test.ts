import { gunzipSync } from "node:zlib";
import type { CanonicalSession, RawSessionArchive } from "@pika/core";
import { INITIAL_BACKOFF_MS } from "@pika/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentUploadOptions } from "./content";
import {
  confirmRawUpload,
  gzipCompress,
  requestPresignedUrl,
  uploadContentBatch,
  uploadRawDirect,
  uploadSessionContent,
  uploadToPresignedUrl,
} from "./content";
import { AuthError, ClientError, RetryExhaustedError, sha256 } from "./engine";

// ── Fixtures ───────────────────────────────────────────────────

function makeCanonical(
  overrides?: Partial<CanonicalSession>,
): CanonicalSession {
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

function makeOpts(
  overrides?: Partial<ContentUploadOptions>,
): ContentUploadOptions {
  return {
    apiUrl: "https://pika.test",
    apiKey: "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── gzipCompress ───────────────────────────────────────────────

describe("gzipCompress", () => {
  it("compresses a string to gzip buffer", async () => {
    const input = '{"hello":"world"}';
    const compressed = await gzipCompress(input);
    expect(Buffer.isBuffer(compressed)).toBe(true);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("decompresses back to original string", async () => {
    const input = '{"hello":"world"}';
    const compressed = await gzipCompress(input);
    const decompressed = gunzipSync(compressed).toString("utf-8");
    expect(decompressed).toBe(input);
  });

  it("compressed output is smaller for large inputs", async () => {
    const input = JSON.stringify({ data: "x".repeat(10_000) });
    const compressed = await gzipCompress(input);
    expect(compressed.length).toBeLessThan(input.length);
  });

  it("handles empty string", async () => {
    const compressed = await gzipCompress("");
    const decompressed = gunzipSync(compressed).toString("utf-8");
    expect(decompressed).toBe("");
  });

  it("handles unicode", async () => {
    const input = '{"msg":"Hello, world!"}';
    const compressed = await gzipCompress(input);
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

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
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
      .mockResolvedValueOnce(presignOk()) // 2. presign request
      .mockResolvedValueOnce(okResponse(r2Status)) // 3. R2 PUT
      .mockResolvedValueOnce(confirmOk()); // 4. confirm
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
    expect(init.headers.Authorization).toBe(
      "Bearer pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
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
      .mockResolvedValueOnce(okResponse(204)) // canonical no-op
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

    // Both canonical and raw start in parallel, so provide mock responses for both
    mockFetch
      .mockResolvedValueOnce(errorResponse(401)) // canonical 401
      .mockResolvedValueOnce(presignOk()) // raw presign (may fire concurrently)
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // R2 PUT
      .mockResolvedValueOnce(confirmOk()); // confirm

    await expect(uploadSessionContent(canonical, raw, opts())).rejects.toThrow(
      AuthError,
    );
  });

  // ── 409 conflict ──

  it("throws ClientError on 409 version conflict for canonical", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    mockFetch
      .mockResolvedValueOnce(
        errorResponse(409, "Version conflict: older revision"),
      )
      .mockResolvedValueOnce(presignOk()) // raw presign (concurrent)
      .mockResolvedValueOnce(okResponse(200)) // raw R2 PUT (concurrent)
      .mockResolvedValueOnce(confirmOk()); // raw confirm (concurrent)

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

    // Use URL-based router since canonical and raw fire concurrently
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/canonical")) {
        return Promise.resolve(errorResponse(500));
      }
      // Raw requests may fire concurrently — let them succeed
      if (url.includes("/presign")) {
        return Promise.resolve(presignOk());
      }
      if (url.includes("/confirm-raw")) {
        return Promise.resolve(confirmOk());
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await expect(
      uploadSessionContent(canonical, raw, { ...opts(), fetch: routerFetch }),
    ).rejects.toThrow(RetryExhaustedError);
  });

  // ── 429 rate limiting ──

  it("retries canonical on 429 with Retry-After", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const headers429 = new Headers();
    headers429.set("Retry-After", "2");
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: headers429 }),
      )
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

    mockFetch
      .mockResolvedValueOnce(errorResponse(400, "Bad request"))
      .mockResolvedValueOnce(presignOk()) // raw presign (concurrent)
      .mockResolvedValueOnce(okResponse(200)) // raw R2 PUT (concurrent)
      .mockResolvedValueOnce(confirmOk()); // raw confirm (concurrent)

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
    const canonical = makeCanonical({
      sessionKey: "opencode:session/with:colons",
    });
    const raw = makeRaw({ sessionKey: "opencode:session/with:colons" });

    mockSuccessfulUpload();

    await uploadSessionContent(canonical, raw, opts());

    const canonicalUrl = mockFetch.mock.calls[0][0] as string;
    expect(canonicalUrl).toContain(
      encodeURIComponent("opencode:session/with:colons"),
    );
    expect(canonicalUrl).not.toContain(
      "opencode:session/with:colons/canonical",
    );
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

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
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
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s1" }),
        raw: makeRaw({ sessionKey: "claude-code:s1" }),
      },
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s2" }),
        raw: makeRaw({ sessionKey: "claude-code:s2" }),
      },
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s3" }),
        raw: makeRaw({ sessionKey: "claude-code:s3" }),
      },
    ];

    // Use URL-based router to handle parallel canonical + raw per session
    let s2CanonicalCalled = false;
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      // s2 canonical → 409 conflict
      if (url.includes("s2") && url.includes("/canonical")) {
        s2CanonicalCalled = true;
        return Promise.resolve(errorResponse(409, "conflict"));
      }
      // s2 raw presign → also fail (session will error anyway from 409)
      if (url.includes("/presign") && s2CanonicalCalled) {
        // presign for s2 — will error but be caught since canonical already errored
        s2CanonicalCalled = false;
        return Promise.resolve(presignOk());
      }
      // All other canonical/presign/R2/confirm calls succeed
      if (url.includes("/presign")) {
        return Promise.resolve(presignOk());
      }
      if (url.includes("/confirm-raw")) {
        return Promise.resolve(confirmOk());
      }
      // canonical PUT and R2 PUT both return 201
      return Promise.resolve(okResponse(201));
    });

    const result = await uploadContentBatch(
      sessions,
      { ...opts(), fetch: routerFetch },
      1,
    );
    expect(result.uploaded).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionKey).toBe("claude-code:s2");
    expect(result.errors[0].error).toContain("409");
  });

  it("propagates AuthError immediately (does not continue)", async () => {
    const sessions = [
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s1" }),
        raw: makeRaw({ sessionKey: "claude-code:s1" }),
      },
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s2" }),
        raw: makeRaw({ sessionKey: "claude-code:s2" }),
      },
    ];

    // canonical and raw fire in parallel, both may hit the mock
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/canonical")) {
        return Promise.resolve(errorResponse(401));
      }
      if (url.includes("/presign")) {
        return Promise.resolve(errorResponse(401));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await expect(
      uploadContentBatch(sessions, { ...opts(), fetch: routerFetch }, 1),
    ).rejects.toThrow(AuthError);
  });

  it("collects RetryExhaustedError per session and continues", async () => {
    const sessions = [
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s1" }),
        raw: makeRaw({ sessionKey: "claude-code:s1" }),
      },
      {
        canonical: makeCanonical({ sessionKey: "claude-code:s2" }),
        raw: makeRaw({ sessionKey: "claude-code:s2" }),
      },
    ];

    // Use URL-based router
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      // s1 canonical always fails
      if (url.includes("s1") && url.includes("/canonical")) {
        return Promise.resolve(errorResponse(500));
      }
      // All presign/confirm/other requests succeed
      if (url.includes("/presign")) {
        return Promise.resolve(presignOk());
      }
      if (url.includes("/confirm-raw")) {
        return Promise.resolve(confirmOk());
      }
      return Promise.resolve(okResponse(201));
    });

    const result = await uploadContentBatch(
      sessions,
      { ...opts(), fetch: routerFetch },
      1,
    );
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
          new Response(
            JSON.stringify({ url: "https://r2.example.com/p", key: "k" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      if (path.endsWith("/confirm-raw")) {
        return Promise.resolve(
          new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 201 }));
    });

    const result = await uploadContentBatch(
      sessions,
      {
        apiUrl: "https://pika.test",
        apiKey: "pk_test",
        fetch: concurrentFetch,
        sleep: mockSleep,
      },
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

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, ...overrides });
  }

  it("sends correct request and returns url + key", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          url: "https://r2.example.com/presigned",
          key: "u1/key/raw/abc.json.gz",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await requestPresignedUrl(
      "claude-code:s1",
      "abc123ff",
      opts(),
    );

    expect(result.url).toBe("https://r2.example.com/presigned");
    expect(result.key).toBe("u1/key/raw/abc.json.gz");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://pika.test/api/ingest/presign");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toContain("Bearer");
    expect(JSON.parse(init.body)).toEqual({
      sessionKey: "claude-code:s1",
      rawHash: "abc123ff",
    });
  });

  it("throws AuthError on 401", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(
      requestPresignedUrl("key", "hash1234", opts()),
    ).rejects.toThrow(AuthError);
  });

  it("throws ClientError on 400", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad request", { status: 400 }),
    );
    const err = await requestPresignedUrl("key", "hash1234", opts()).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(400);
  });

  it("throws ClientError when response is missing key (only url present)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: "https://r2.example.com/presigned" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const err = await requestPresignedUrl("key", "hash1234", opts()).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ClientError);
    expect(err.body).toContain("missing url or key");
  });

  it("throws ClientError when response is missing url", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: "k" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const err = await requestPresignedUrl("key", "hash1234", opts()).catch(
      (e) => e,
    );
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

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  it("PUTs body to presigned URL with correct headers", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const body = await gzipCompress('{"test":true}');

    await uploadToPresignedUrl(
      "https://r2.example.com/presigned",
      body,
      opts(),
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://r2.example.com/presigned");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/gzip");
    // No Authorization header — presigned URL handles auth
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("succeeds on 201", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));
    await expect(
      uploadToPresignedUrl(
        "https://r2.example.com/p",
        Buffer.from("data"),
        opts(),
      ),
    ).resolves.toBeUndefined();
  });

  it("retries on network error (fetch throws)", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await uploadToPresignedUrl(
      "https://r2.example.com/p",
      Buffer.from("data"),
      opts(),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(INITIAL_BACKOFF_MS);
  });

  it("throws RetryExhaustedError when network error exhausts retries", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"));

    await expect(
      uploadToPresignedUrl(
        "https://r2.example.com/p",
        Buffer.from("data"),
        opts(),
      ),
    ).rejects.toThrow(RetryExhaustedError);
  });

  it("retries on 5xx with backoff", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await uploadToPresignedUrl(
      "https://r2.example.com/p",
      Buffer.from("data"),
      opts(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(INITIAL_BACKOFF_MS);
  });

  it("throws ClientError on 4xx", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const err = await uploadToPresignedUrl(
      "https://r2.example.com/p",
      Buffer.from("data"),
      opts(),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(403);
  });

  it("throws RetryExhaustedError after max retries", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(
      uploadToPresignedUrl(
        "https://r2.example.com/p",
        Buffer.from("data"),
        opts(),
      ),
    ).rejects.toThrow(RetryExhaustedError);
  });
});

// ── confirmRawUpload ───────────────────────────────────────────

describe("confirmRawUpload", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
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
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(confirmRawUpload("key", "hash", 100, opts())).rejects.toThrow(
      AuthError,
    );
  });

  it("throws ClientError on 404", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const err = await confirmRawUpload("key", "hash", 100, opts()).catch(
      (e) => e,
    );
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

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  it("completes full presigned upload flow", async () => {
    const rawGzip = await gzipCompress('{"raw":true}');

    // 1. presign request
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: "https://r2.example.com/presigned", key: "k" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    // 2. R2 PUT
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // 3. confirm
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
    );

    const result = await uploadRawDirect(
      "claude-code:s1",
      "hash1234",
      rawGzip,
      opts(),
    );
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify sequence: presign → R2 PUT → confirm
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://pika.test/api/ingest/presign",
    );
    expect(mockFetch.mock.calls[1][0]).toBe("https://r2.example.com/presigned");
    expect(mockFetch.mock.calls[2][0]).toBe(
      "https://pika.test/api/ingest/confirm-raw",
    );
  });

  it("propagates AuthError from presign", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

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
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

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

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
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
        new Response(
          JSON.stringify({ url: "https://r2/presigned", key: "k" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
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

    // With parallel canonical + raw, both fire concurrently
    // Use a URL-based router to handle both paths
    const callLog: string[] = [];
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      callLog.push(url);
      if (url.includes("/canonical")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (url.includes("/presign")) {
        return Promise.resolve(new Response("Internal error", { status: 500 }));
      }
      if (url.includes("/raw")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await uploadSessionContent(canonical, raw, {
      ...opts(),
      fetch: routerFetch,
    });
    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
    // canonical + presign fail + fallback raw = 3 calls
    expect(routerFetch).toHaveBeenCalledTimes(3);
  });

  it("propagates AuthError from presigned flow", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    // Both canonical and raw fire concurrently
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/canonical")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (url.includes("/presign")) {
        return Promise.resolve(new Response("Unauthorized", { status: 401 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await expect(
      uploadSessionContent(canonical, raw, { ...opts(), fetch: routerFetch }),
    ).rejects.toThrow(AuthError);
  });
});

// ── uploadSessionContent with precomputed hashes ──────────────

describe("uploadSessionContent (precomputed hashes)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(
    overrides?: Partial<ContentUploadOptions>,
  ): ContentUploadOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  it("uses precomputed hashes instead of recomputing", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const canonicalJson = JSON.stringify(canonical);
    const rawJson = JSON.stringify(raw);
    const contentHash = sha256(canonicalJson);
    const rawHash = sha256(rawJson);

    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 201 })) // canonical PUT
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ url: "https://r2/presigned", key: "k" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) // presign
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // R2 PUT
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
      ); // confirm

    const result = await uploadSessionContent(canonical, raw, opts(), {
      canonicalJson,
      rawJson,
      contentHash,
      rawHash,
    });

    expect(result.contentHash).toBe(contentHash);
    expect(result.rawHash).toBe(rawHash);
    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);

    // Verify the X-Content-Hash header matches precomputed hash
    const canonicalInit = mockFetch.mock.calls[0][1];
    expect(canonicalInit.headers["X-Content-Hash"]).toBe(contentHash);
  });
});

// ── putWithRetry — network error retry (via uploadSessionContent) ──

describe("putWithRetry (network error via uploadSessionContent)", () => {
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  it("retries canonical PUT on network error then succeeds", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const callLog: string[] = [];
    let canonicalAttempt = 0;

    const routerFetch = vi.fn().mockImplementation((url: string) => {
      callLog.push(url);
      if (url.includes("/canonical")) {
        canonicalAttempt++;
        if (canonicalAttempt === 1) {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (url.includes("/presign")) {
        return Promise.resolve(
          new Response(JSON.stringify({ url: "https://r2/p", key: "k" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/confirm-raw")) {
        return Promise.resolve(
          new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const result = await uploadSessionContent(canonical, raw, {
      ...makeOpts({ sleep: mockSleep }),
      fetch: routerFetch,
    });

    expect(result.canonicalUploaded).toBe(true);
    expect(mockSleep).toHaveBeenCalledWith(INITIAL_BACKOFF_MS);
  });
});

// ── uploadContentBatch — both canonical+raw 204 ──────────────

describe("uploadContentBatch (both 204 — fully skipped)", () => {
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  it("counts session as skipped when both canonical and raw return 204", async () => {
    const sessions = [{ canonical: makeCanonical(), raw: makeRaw() }];

    // canonical 204 + raw presign succeeds but R2 returns 204-equivalent
    // For raw: presign → R2 PUT (200) → confirm OK, so raw is uploaded
    // To get both skipped, the raw proxy fallback must also 204
    // Actually: canonical 204 = not uploaded, raw uses presigned flow which returns true
    // For both to be "not uploaded", we need canonical 204 AND raw presigned flow to fail
    // then fallback proxy also 204
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/canonical")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/presign")) {
        // Presign fails with non-auth error → triggers proxy fallback
        return Promise.resolve(new Response("Server error", { status: 500 }));
      }
      if (url.includes("/raw")) {
        // Proxy fallback also returns 204 (no-op)
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const result = await uploadContentBatch(
      sessions,
      { ...makeOpts({ sleep: mockSleep }), fetch: routerFetch },
      1,
    );
    // Neither canonical nor raw was uploaded → skipped
    expect(result.skipped).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

// ── uploadSessionContent — raw presigned fallback to proxy on non-auth error ──

describe("uploadSessionContent (raw proxy fallback on non-auth error)", () => {
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  it("falls back to proxy when presign returns 500", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const callLog: string[] = [];
    const routerFetch = vi.fn().mockImplementation((url: string) => {
      callLog.push(url);
      if (url.includes("/canonical")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (url.includes("/presign")) {
        return Promise.resolve(new Response("Internal error", { status: 500 }));
      }
      if (url.includes("/raw")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const result = await uploadSessionContent(canonical, raw, {
      ...makeOpts({ sleep: mockSleep }),
      fetch: routerFetch,
    });

    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
    // Should have called: canonical, presign (fail), raw proxy fallback
    expect(callLog.some((u) => u.includes("/presign"))).toBe(true);
    expect(callLog.some((u) => u.includes("/raw"))).toBe(true);
  });

  it("falls back to proxy when R2 PUT fails with ClientError", async () => {
    const canonical = makeCanonical();
    const raw = makeRaw();

    const routerFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/canonical")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (url.includes("/presign")) {
        return Promise.resolve(
          new Response(JSON.stringify({ url: "https://r2/p", key: "k" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("r2")) {
        // R2 PUT fails with 403
        return Promise.resolve(new Response("Forbidden", { status: 403 }));
      }
      if (url.includes("/raw")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (url.includes("/confirm-raw")) {
        return Promise.resolve(
          new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const result = await uploadSessionContent(canonical, raw, {
      ...makeOpts({ sleep: mockSleep }),
      fetch: routerFetch,
    });

    expect(result.canonicalUploaded).toBe(true);
    expect(result.rawUploaded).toBe(true);
  });
});
