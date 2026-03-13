import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sha256,
  toSessionSnapshot,
  splitBatches,
  parseRetryAfter,
  uploadMetadataBatches,
  AuthError,
  RetryExhaustedError,
  ClientError,
} from "./engine";
import type { UploadEngineOptions } from "./engine";
import type {
  CanonicalSession,
  RawSessionArchive,
  SessionSnapshot,
} from "@pika/core";
import {
  METADATA_BATCH_SIZE,
  MAX_UPLOAD_RETRIES,
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
      {
        role: "user",
        content: "Hello",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        role: "assistant",
        content: "Hi there!",
        timestamp: "2026-01-01T00:00:05Z",
        inputTokens: 10,
        outputTokens: 20,
      },
      {
        role: "user",
        content: "How are you?",
        timestamp: "2026-01-01T00:05:00Z",
      },
      {
        role: "assistant",
        content: "I'm doing well!",
        timestamp: "2026-01-01T00:05:05Z",
        inputTokens: 15,
        outputTokens: 25,
      },
      {
        role: "tool",
        content: "Tool result",
        toolName: "read_file",
        timestamp: "2026-01-01T00:07:00Z",
      },
    ],
    totalInputTokens: 25,
    totalOutputTokens: 45,
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
        content: '{"type":"user","message":"Hello"}\n{"type":"assistant","message":"Hi there!"}\n',
      },
    ],
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  const canonical = makeCanonical();
  const raw = makeRaw();
  const base = toSessionSnapshot(canonical, raw);
  return { ...base, ...overrides };
}

function makeOpts(overrides?: Partial<UploadEngineOptions>): UploadEngineOptions {
  return {
    apiUrl: "https://pika.test",
    apiKey: "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    userId: "user-123",
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── sha256 ─────────────────────────────────────────────────────

describe("sha256", () => {
  it("returns hex digest of input string", () => {
    const hash = sha256("hello");
    expect(hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("returns different hashes for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("returns same hash for same input (deterministic)", () => {
    expect(sha256("test")).toBe(sha256("test"));
  });

  it("handles empty string", () => {
    const hash = sha256("");
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("handles unicode input", () => {
    const hash = sha256("Hello, world!");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });
});

// ── toSessionSnapshot ──────────────────────────────────────────

describe("toSessionSnapshot", () => {
  it("transforms canonical + raw into snapshot with correct fields", () => {
    const canonical = makeCanonical();
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);

    expect(snapshot.sessionKey).toBe("claude-code:test-session-1");
    expect(snapshot.source).toBe("claude-code");
    expect(snapshot.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(snapshot.lastMessageAt).toBe("2026-01-01T00:10:00Z");
    expect(snapshot.durationSeconds).toBe(600);
    expect(snapshot.projectRef).toBe("abc123");
    expect(snapshot.projectName).toBe("test-project");
    expect(snapshot.model).toBe("claude-sonnet-4-20250514");
    expect(snapshot.title).toBe("Test session");
    expect(snapshot.parserRevision).toBe(1);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.snapshotAt).toBe("2026-01-01T00:10:00Z");
  });

  it("counts message roles correctly", () => {
    const canonical = makeCanonical();
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);

    expect(snapshot.userMessages).toBe(2);
    expect(snapshot.assistantMessages).toBe(2);
    expect(snapshot.totalMessages).toBe(5); // 2 user + 2 assistant + 1 tool
  });

  it("computes contentHash as SHA-256 of canonical JSON", () => {
    const canonical = makeCanonical();
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);

    const expectedHash = sha256(JSON.stringify(canonical));
    expect(snapshot.contentHash).toBe(expectedHash);
    expect(snapshot.contentHash).toHaveLength(64);
  });

  it("computes rawHash as SHA-256 of raw JSON", () => {
    const canonical = makeCanonical();
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);

    const expectedHash = sha256(JSON.stringify(raw));
    expect(snapshot.rawHash).toBe(expectedHash);
    expect(snapshot.rawHash).toHaveLength(64);
  });

  it("different canonical content produces different contentHash", () => {
    const raw = makeRaw();
    const s1 = toSessionSnapshot(makeCanonical({ title: "A" }), raw);
    const s2 = toSessionSnapshot(makeCanonical({ title: "B" }), raw);
    expect(s1.contentHash).not.toBe(s2.contentHash);
  });

  it("different raw content produces different rawHash", () => {
    const canonical = makeCanonical();
    const r1 = makeRaw({ collectedAt: "2026-01-01T00:00:00Z" });
    const r2 = makeRaw({ collectedAt: "2026-01-02T00:00:00Z" });
    const s1 = toSessionSnapshot(canonical, r1);
    const s2 = toSessionSnapshot(canonical, r2);
    expect(s1.rawHash).not.toBe(s2.rawHash);
    // contentHash should be the same since canonical is identical
    expect(s1.contentHash).toBe(s2.contentHash);
  });

  it("propagates token totals", () => {
    const canonical = makeCanonical({
      totalInputTokens: 100,
      totalOutputTokens: 200,
      totalCachedTokens: 50,
    });
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);
    expect(snapshot.totalInputTokens).toBe(100);
    expect(snapshot.totalOutputTokens).toBe(200);
    expect(snapshot.totalCachedTokens).toBe(50);
  });

  it("handles null optional fields", () => {
    const canonical = makeCanonical({
      projectRef: null,
      projectName: null,
      model: null,
      title: null,
    });
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);
    expect(snapshot.projectRef).toBeNull();
    expect(snapshot.projectName).toBeNull();
    expect(snapshot.model).toBeNull();
    expect(snapshot.title).toBeNull();
  });

  it("counts zero for roles not present", () => {
    const canonical = makeCanonical({
      messages: [
        { role: "system", content: "System message", timestamp: "2026-01-01T00:00:00Z" },
      ],
    });
    const raw = makeRaw();
    const snapshot = toSessionSnapshot(canonical, raw);
    expect(snapshot.userMessages).toBe(0);
    expect(snapshot.assistantMessages).toBe(0);
    expect(snapshot.totalMessages).toBe(1);
  });
});

// ── splitBatches ───────────────────────────────────────────────

describe("splitBatches", () => {
  it("returns empty array for empty input", () => {
    expect(splitBatches([], 50)).toEqual([]);
  });

  it("returns single batch when items fit", () => {
    const items = [1, 2, 3];
    const batches = splitBatches(items, 50);
    expect(batches).toEqual([[1, 2, 3]]);
  });

  it("splits items into correct batch sizes", () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const batches = splitBatches(items, 50);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(50);
    expect(batches[1]).toHaveLength(50);
    expect(batches[2]).toHaveLength(20);
  });

  it("handles exact batch size", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const batches = splitBatches(items, 50);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(50);
  });

  it("handles single item", () => {
    const batches = splitBatches(["a"], 50);
    expect(batches).toEqual([["a"]]);
  });

  it("handles batch size of 1", () => {
    const batches = splitBatches([1, 2, 3], 1);
    expect(batches).toEqual([[1], [2], [3]]);
  });
});

// ── parseRetryAfter ────────────────────────────────────────────

describe("parseRetryAfter", () => {
  it("returns default for null", () => {
    expect(parseRetryAfter(null)).toBe(INITIAL_BACKOFF_MS);
  });

  it("parses integer seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
  });

  it("parses zero seconds", () => {
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("parses HTTP-date", () => {
    const futureDate = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(futureDate);
    // Should be approximately 10 seconds (allow 2s tolerance)
    expect(ms).toBeGreaterThan(8000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  it("returns 0 for past HTTP-date", () => {
    const pastDate = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBe(0);
  });

  it("returns default for unparseable value", () => {
    expect(parseRetryAfter("not-a-value")).toBe(INITIAL_BACKOFF_MS);
  });
});

// ── uploadMetadataBatches ──────────────────────────────────────

describe("uploadMetadataBatches", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  function opts(overrides?: Partial<UploadEngineOptions>): UploadEngineOptions {
    return makeOpts({ fetch: mockFetch, sleep: mockSleep, ...overrides });
  }

  function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  function textResponse(body: string, status: number, headers?: Record<string, string>): Response {
    return new Response(body, {
      status,
      headers: { "Content-Type": "text/plain", ...headers },
    });
  }

  // ── Empty input ──

  it("returns zero results for empty snapshots array", async () => {
    const result = await uploadMetadataBatches([], opts());
    expect(result).toEqual({
      totalIngested: 0,
      totalConflicts: 0,
      totalBatches: 0,
      errors: [],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Successful upload ──

  it("uploads a single batch successfully", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    const result = await uploadMetadataBatches(snapshots, opts());

    expect(result.totalIngested).toBe(1);
    expect(result.totalConflicts).toBe(0);
    expect(result.totalBatches).toBe(1);
    expect(result.errors).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sends correct request format", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    await uploadMetadataBatches(snapshots, opts());

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://pika.test/api/ingest/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe(
      "Bearer pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    const body = JSON.parse(init.body);
    expect(body.userId).toBe("user-123");
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionKey).toBe("claude-code:test-session-1");
  });

  it("splits into multiple batches at METADATA_BATCH_SIZE boundary", async () => {
    const snapshots = Array.from({ length: 75 }, (_, i) =>
      makeSnapshot({ sessionKey: `claude-code:session-${i}` }),
    );

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ingested: 50 }))
      .mockResolvedValueOnce(jsonResponse({ ingested: 25 }));

    const result = await uploadMetadataBatches(snapshots, opts());

    expect(result.totalIngested).toBe(75);
    expect(result.totalBatches).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first batch has 50 sessions
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstBody.sessions).toHaveLength(50);

    // Verify second batch has 25 sessions
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.sessions).toHaveLength(25);
  });

  it("handles exactly METADATA_BATCH_SIZE items as single batch", async () => {
    const snapshots = Array.from({ length: METADATA_BATCH_SIZE }, (_, i) =>
      makeSnapshot({ sessionKey: `claude-code:session-${i}` }),
    );

    mockFetch.mockResolvedValueOnce(jsonResponse({ ingested: METADATA_BATCH_SIZE }));

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalBatches).toBe(1);
    expect(result.totalIngested).toBe(METADATA_BATCH_SIZE);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── 409 version conflicts ──

  it("handles 409 version conflict gracefully", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Version conflict",
          conflicts: [{ sessionKey: "claude-code:test-session-1" }],
        },
        409,
      ),
    );

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(0);
    expect(result.totalConflicts).toBe(1);
    expect(result.errors).toEqual([]);
  });

  // ── 401 auth error ──

  it("throws AuthError on 401", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));

    const err = await uploadMetadataBatches(snapshots, opts()).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toContain("pika login --force");
  });

  // ── 4xx client errors ──

  it("throws ClientError on 400", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(
      textResponse('{"error":"bad request"}', 400),
    );

    await expect(uploadMetadataBatches(snapshots, opts())).rejects.toThrow(
      ClientError,
    );
  });

  it("throws ClientError on 422", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(
      textResponse("Unprocessable", 422),
    );

    const err = await uploadMetadataBatches(snapshots, opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(422);
    expect(err.body).toBe("Unprocessable");
  });

  // ── 5xx retry with exponential backoff ──

  it("retries on 5xx with exponential backoff", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 502))
      .mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    const result = await uploadMetadataBatches(snapshots, opts());

    expect(result.totalIngested).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify backoff delays: 1000ms (2^0), 2000ms (2^1)
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenNthCalledWith(1, 1000);
    expect(mockSleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it("throws RetryExhaustedError after max retries on 5xx", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 500));

    const err = await uploadMetadataBatches(snapshots, opts()).catch((e) => e);
    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect(err.statusCode).toBe(500);
    expect(err.attempts).toBe(MAX_UPLOAD_RETRIES + 1);

    // 1 initial + 2 retries = 3 attempts, 2 sleeps
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it("recovers on last retry attempt", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 503))
      .mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ── 429 rate limiting ──

  it("retries on 429 with Retry-After header (seconds)", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ error: "Rate limited" }, 429, { "Retry-After": "3" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(1);
    expect(mockSleep).toHaveBeenCalledWith(3000);
  });

  it("retries on 429 with default backoff when no Retry-After", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(1);
    expect(mockSleep).toHaveBeenCalledWith(INITIAL_BACKOFF_MS);
  });

  it("exhausts retries on repeated 429", async () => {
    const snapshots = [makeSnapshot()];
    // 1 initial + MAX_UPLOAD_RETRIES retries = all 429
    for (let i = 0; i <= MAX_UPLOAD_RETRIES; i++) {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Rate limited" }, 429, { "Retry-After": "1" }),
      );
    }

    const err = await uploadMetadataBatches(snapshots, opts()).catch((e) => e);
    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect(err.statusCode).toBe(429);
  });

  // ── Mixed 5xx and 429 ──

  it("handles mixed 5xx and 429 retries", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Internal" }, 500))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Rate limited" }, 429, { "Retry-After": "2" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ingested: 1 }));

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // First sleep: 1000ms (5xx backoff 2^0)
    // Second sleep: 2000ms (429 Retry-After)
    expect(mockSleep).toHaveBeenNthCalledWith(1, 1000);
    expect(mockSleep).toHaveBeenNthCalledWith(2, 2000);
  });

  // ── Multi-batch with partial failure ──

  it("stops on auth error mid-batch", async () => {
    const snapshots = Array.from({ length: 75 }, (_, i) =>
      makeSnapshot({ sessionKey: `claude-code:session-${i}` }),
    );

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ingested: 50 })) // batch 1 OK
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401)); // batch 2 fails

    await expect(uploadMetadataBatches(snapshots, opts())).rejects.toThrow(
      AuthError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("accumulates results across multiple successful batches", async () => {
    const snapshots = Array.from({ length: 120 }, (_, i) =>
      makeSnapshot({ sessionKey: `claude-code:session-${i}` }),
    );

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ingested: 50 }))
      .mockResolvedValueOnce(jsonResponse({ ingested: 50 }))
      .mockResolvedValueOnce(jsonResponse({ ingested: 20 }));

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(120);
    expect(result.totalBatches).toBe(3);
  });

  it("accumulates conflicts across batches", async () => {
    const snapshots = Array.from({ length: 75 }, (_, i) =>
      makeSnapshot({ sessionKey: `claude-code:session-${i}` }),
    );

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ingested: 50 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Version conflict",
            conflicts: Array.from({ length: 25 }, (_, i) => ({
              sessionKey: `claude-code:session-${50 + i}`,
            })),
          },
          409,
        ),
      );

    const result = await uploadMetadataBatches(snapshots, opts());
    expect(result.totalIngested).toBe(50);
    expect(result.totalConflicts).toBe(25);
    expect(result.totalBatches).toBe(2);
  });

  // ── Network error ──

  it("propagates network errors (fetch throws)", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockRejectedValueOnce(new Error("Network unreachable"));

    await expect(uploadMetadataBatches(snapshots, opts())).rejects.toThrow(
      "Network unreachable",
    );
  });

  // ── Edge: 409 without conflicts array ──

  it("handles 409 without conflicts array in body", async () => {
    const snapshots = [makeSnapshot()];
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "Version conflict" }, 409),
    );

    const result = await uploadMetadataBatches(snapshots, opts());
    // Falls back to snapshots.length when conflicts array is missing
    expect(result.totalConflicts).toBe(1);
  });
});
