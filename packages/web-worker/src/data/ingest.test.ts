import { PIKA_VERSION } from "@pika/core";
import { describe, expect, it, vi } from "vitest";
import {
  checkVersionConflicts,
  DecompressionLimitError,
  decompressBody,
  type Env,
  handleCanonicalUpload,
  handleLive,
  handleRawUpload,
  handleSessionIngest,
  type IngestSessionPayload,
  parseContentPath,
  validateIngestRequest,
} from "./ingest";

// ── Test data ──────────────────────────────────────────────────

const validSession = {
  sessionKey: "claude:abc-123",
  source: "claude-code" as const,
  startedAt: "2026-01-15T10:00:00Z",
  lastMessageAt: "2026-01-15T10:30:00Z",
  durationSeconds: 1800,
  userMessages: 5,
  assistantMessages: 5,
  totalMessages: 10,
  totalInputTokens: 1000,
  totalOutputTokens: 2000,
  totalCachedTokens: 500,
  projectRef: null,
  projectName: "my-project",
  model: "claude-sonnet-4-20250514",
  title: "Test session",
  contentHash: "abc123def456",
  rawHash: "789xyz",
  parserRevision: 1,
  schemaVersion: 1,
  snapshotAt: "2026-01-15T10:31:00Z",
};

const validPayload: IngestSessionPayload = {
  userId: "user-123",
  sessions: [validSession],
};

function makeRequest(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Request {
  const { method = "POST", headers = {}, body } = options ?? {};
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ── Mock helpers ───────────────────────────────────────────────

/**
 * Create a mock D1Database.
 *
 * batchResults controls what db.batch() returns for successive calls.
 * First call is the version check (array of {results:[...]}),
 * second call is the upsert batch.
 */
function mockD1(
  batchResults?: unknown[][],
  opts?: {
    firstResult?: unknown;
    runResult?: unknown;
  },
): D1Database {
  let callIndex = 0;
  const results = batchResults ?? [
    [{ results: [] }], // version check: no existing sessions (new)
    [], // upsert: success
  ];

  const mockFirst = vi.fn().mockResolvedValue(opts?.firstResult ?? null);
  const mockRun = vi
    .fn()
    .mockResolvedValue(opts?.runResult ?? { success: true });

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: mockFirst,
        run: mockRun,
      }),
      first: mockFirst,
      run: mockRun,
    }),
    batch: vi.fn().mockImplementation(() => {
      const result = results[callIndex] ?? [];
      callIndex++;
      return Promise.resolve(result);
    }),
  } as unknown as D1Database;
}

function mockR2(): R2Bucket {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    head: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

// ── Gzip helper for tests ─────────────────────────────────────

/** Compress a string to gzip using CompressionStream (available in test runtime) */
async function gzipCompress(input: string): Promise<ArrayBuffer> {
  const blob = new Blob([input]);
  const cs = new CompressionStream("gzip");
  const compressed = blob.stream().pipeThrough(cs);
  const reader = compressed.getReader();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result.buffer;
}

// ── Ingest request validation ──────────────────────────────────
// Auth validation tests have been moved to auth.test.ts

describe("validateIngestRequest", () => {
  it("passes for valid payload", () => {
    const result = validateIngestRequest(validPayload);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing userId", () => {
    const payload = { ...validPayload, userId: "" };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("userId"));
  });

  it("rejects empty sessions array", () => {
    const payload = { ...validPayload, sessions: [] };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("sessions"));
  });

  it("rejects oversized batch (>50)", () => {
    const sessions = Array.from({ length: 51 }, (_, i) => ({
      ...validSession,
      sessionKey: `claude:session-${i}`,
    }));
    const payload = { ...validPayload, sessions };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("50"));
  });

  it("accepts batch of exactly 50", () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      ...validSession,
      sessionKey: `claude:session-${i}`,
    }));
    const payload = { ...validPayload, sessions };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(true);
  });

  it("validates individual session snapshots", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, source: "invalid" as any }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("source"));
  });

  it("validates session key format", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, sessionKey: "no-colon" }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("sessionKey"));
  });

  it("validates content hash is present", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, contentHash: "" }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("contentHash"),
    );
  });

  it("validates raw hash is present", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, rawHash: "" }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("rawHash"));
  });

  it("validates parser revision >= 1", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, parserRevision: 0 }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("parserRevision"),
    );
  });

  it("rejects sessions with zero totalMessages", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, totalMessages: 0 }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("totalMessages must be >= 1"),
    );
  });
});

// ── checkVersionConflicts ──────────────────────────────────────

describe("checkVersionConflicts", () => {
  it("returns empty for new sessions (no existing rows)", async () => {
    const db = mockD1([
      [{ results: [] }], // no existing row
    ]);
    const conflicts = await checkVersionConflicts("user-1", [validSession], db);
    expect(conflicts).toEqual([]);
  });

  it("returns empty when incoming version equals existing", async () => {
    const db = mockD1([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 1,
              schema_version: 1,
            },
          ],
        },
      ],
    ]);
    const conflicts = await checkVersionConflicts(
      "user-1",
      [validSession], // parserRevision: 1, schemaVersion: 1
      db,
    );
    expect(conflicts).toEqual([]);
  });

  it("returns empty when incoming version is newer", async () => {
    const db = mockD1([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 1,
              schema_version: 1,
            },
          ],
        },
      ],
    ]);
    const conflicts = await checkVersionConflicts(
      "user-1",
      [{ ...validSession, parserRevision: 2 }],
      db,
    );
    expect(conflicts).toEqual([]);
  });

  it("detects older parser_revision", async () => {
    const db = mockD1([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 3,
              schema_version: 1,
            },
          ],
        },
      ],
    ]);
    const conflicts = await checkVersionConflicts(
      "user-1",
      [validSession], // parserRevision: 1
      db,
    );
    expect(conflicts).toEqual([
      {
        sessionKey: "claude:abc-123",
        existingParserRevision: 3,
        existingSchemaVersion: 1,
        incomingParserRevision: 1,
        incomingSchemaVersion: 1,
      },
    ]);
  });

  it("detects older schema_version", async () => {
    const db = mockD1([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 1,
              schema_version: 2,
            },
          ],
        },
      ],
    ]);
    const conflicts = await checkVersionConflicts(
      "user-1",
      [validSession], // schemaVersion: 1
      db,
    );
    expect(conflicts).toEqual([
      {
        sessionKey: "claude:abc-123",
        existingParserRevision: 1,
        existingSchemaVersion: 2,
        incomingParserRevision: 1,
        incomingSchemaVersion: 1,
      },
    ]);
  });

  it("handles batch with mixed new and conflicting sessions", async () => {
    const sessions = [
      { ...validSession, sessionKey: "claude:new-one", parserRevision: 1 },
      { ...validSession, sessionKey: "claude:stale-one", parserRevision: 1 },
    ];
    const db = mockD1([
      [
        { results: [] }, // first session: new
        {
          results: [
            {
              session_key: "claude:stale-one",
              parser_revision: 5,
              schema_version: 1,
            },
          ],
        },
      ],
    ]);
    const conflicts = await checkVersionConflicts("user-1", sessions, db);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sessionKey).toBe("claude:stale-one");
  });
});

// ── Handler: handleSessionIngest ───────────────────────────────

describe("handleSessionIngest", () => {
  function mockEnv(batchResults?: unknown[][]): Env {
    return {
      DB: mockD1(batchResults),
      BUCKET: mockR2(),
    };
  }

  it("returns 400 for invalid payload", async () => {
    const env = mockEnv();
    const res = await handleSessionIngest({ userId: "", sessions: [] }, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string[] };
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("inserts new sessions successfully (version check returns empty)", async () => {
    const env = mockEnv([
      [{ results: [] }], // version check: no existing
      [], // upsert: ok
    ]);
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ingested: number };
    expect(body.ingested).toBe(1);
    expect(env.DB.batch).toHaveBeenCalledTimes(2); // version check + upsert
  });

  it("returns 409 when incoming version is older than existing", async () => {
    const env = mockEnv([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 5,
              schema_version: 1,
            },
          ],
        },
      ],
    ]);
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(409);

    const body = (await res.json()) as { error: string; conflicts: unknown[] };
    expect(body.error).toContain("Version conflict");
    expect(body.conflicts).toHaveLength(1);
    // Upsert batch should NOT have been called
    expect(env.DB.batch).toHaveBeenCalledTimes(1); // only version check
  });

  it("proceeds when incoming version equals existing", async () => {
    const env = mockEnv([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 1,
              schema_version: 1,
            },
          ],
        },
      ],
      [], // upsert
    ]);
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(200);
    expect(env.DB.batch).toHaveBeenCalledTimes(2);
  });

  it("proceeds when incoming version is newer than existing", async () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validSession, parserRevision: 3 }],
    };
    const env = mockEnv([
      [
        {
          results: [
            {
              session_key: "claude:abc-123",
              parser_revision: 1,
              schema_version: 1,
            },
          ],
        },
      ],
      [], // upsert
    ]);
    const res = await handleSessionIngest(payload, env);
    expect(res.status).toBe(200);
  });

  it("returns 500 when D1 batch fails", async () => {
    const db = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({}) }),
      batch: vi
        .fn()
        .mockResolvedValueOnce([{ results: [] }]) // version check ok
        .mockRejectedValueOnce(new Error("D1 write quota exceeded")), // upsert fails
    } as unknown as D1Database;

    const env: Env = { DB: db, BUCKET: mockR2() };
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("D1 batch failed");
  });
});

// ── parseContentPath ──────────────────────────────────────────

describe("parseContentPath", () => {
  it("parses canonical path", () => {
    const result = parseContentPath(
      "/ingest/content/claude%3Aabc-123/canonical",
    );
    expect(result).toEqual({ sessionKey: "claude:abc-123", type: "canonical" });
  });

  it("parses raw path", () => {
    const result = parseContentPath("/ingest/content/codex%3Asession-1/raw");
    expect(result).toEqual({ sessionKey: "codex:session-1", type: "raw" });
  });

  it("returns null for invalid path", () => {
    expect(parseContentPath("/ingest/sessions")).toBeNull();
    expect(parseContentPath("/ingest/content/")).toBeNull();
    expect(parseContentPath("/ingest/content/key/invalid")).toBeNull();
    expect(parseContentPath("/other/path")).toBeNull();
  });

  it("handles non-encoded session keys", () => {
    const result = parseContentPath("/ingest/content/simple-key/canonical");
    expect(result).toEqual({ sessionKey: "simple-key", type: "canonical" });
  });
});

// ── decompressBody ────────────────────────────────────────────

describe("decompressBody", () => {
  it("decompresses gzip body to string", async () => {
    const original = JSON.stringify({ hello: "world", messages: [] });
    const compressed = await gzipCompress(original);
    const stream = new Blob([compressed]).stream();
    const result = await decompressBody(stream);
    expect(result).toBe(original);
  });

  it("handles large payloads", async () => {
    const original = "x".repeat(100_000);
    const compressed = await gzipCompress(original);
    const stream = new Blob([compressed]).stream();
    const result = await decompressBody(stream);
    expect(result).toBe(original);
  });

  it("throws DecompressionLimitError when decompressed size exceeds limit", async () => {
    // 10 KB of data compressed — set limit to 100 bytes to trigger
    const original = "y".repeat(10_000);
    const compressed = await gzipCompress(original);
    const stream = new Blob([compressed]).stream();
    await expect(decompressBody(stream, 100)).rejects.toThrow(
      DecompressionLimitError,
    );
  });

  it("allows data within the specified limit", async () => {
    const original = "z".repeat(500);
    const compressed = await gzipCompress(original);
    const stream = new Blob([compressed]).stream();
    const result = await decompressBody(stream, 1024);
    expect(result).toBe(original);
  });
});

// ── handleCanonicalUpload ─────────────────────────────────────

describe("handleCanonicalUpload", () => {
  const canonicalSession = {
    sessionKey: "claude:abc-123",
    source: "claude-code",
    parserRevision: 1,
    schemaVersion: 1,
    startedAt: "2026-01-15T10:00:00Z",
    lastMessageAt: "2026-01-15T10:30:00Z",
    durationSeconds: 1800,
    projectRef: null,
    projectName: "my-project",
    model: "claude-sonnet-4-20250514",
    title: "Test",
    messages: [
      { role: "user", content: "Hello", timestamp: "2026-01-15T10:00:00Z" },
      {
        role: "assistant",
        content: "Hi there!",
        timestamp: "2026-01-15T10:00:05Z",
      },
    ],
    totalInputTokens: 100,
    totalOutputTokens: 200,
    totalCachedTokens: 0,
    snapshotAt: "2026-01-15T10:31:00Z",
  };

  async function makeCanonicalRequest(
    headers?: Record<string, string>,
    body?: string,
  ): Promise<Request> {
    const json = body ?? JSON.stringify(canonicalSession);
    const compressed = await gzipCompress(json);
    return new Request(
      "http://worker/ingest/content/claude%3Aabc-123/canonical",
      {
        method: "PUT",
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "application/octet-stream",
          "X-Content-Hash": "newhash123",
          "X-Parser-Revision": "1",
          "X-Schema-Version": "1",
          ...headers,
        },
        body: compressed,
      },
    );
  }

  function mockEnvForCanonical(sessionRow: unknown): Env {
    const bucket = mockR2();
    const db = mockD1(undefined, { firstResult: sessionRow });
    return { DB: db, BUCKET: bucket };
  }

  it("returns 400 when X-Content-Hash is missing", async () => {
    const req = new Request("http://worker/test", {
      method: "PUT",
      headers: {
        "X-Parser-Revision": "1",
        "X-Schema-Version": "1",
      },
      body: "test",
    });
    const env = mockEnvForCanonical(null);
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("X-Content-Hash");
  });

  it("returns 400 when X-Parser-Revision is invalid", async () => {
    const req = new Request("http://worker/test", {
      method: "PUT",
      headers: {
        "X-Content-Hash": "hash",
        "X-Parser-Revision": "invalid",
        "X-Schema-Version": "1",
      },
      body: "test",
    });
    const env = mockEnvForCanonical(null);
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("X-Parser-Revision");
  });

  it("returns 400 when X-Schema-Version is invalid", async () => {
    const req = new Request("http://worker/test", {
      method: "PUT",
      headers: {
        "X-Content-Hash": "hash",
        "X-Parser-Revision": "1",
        "X-Schema-Version": "0",
      },
      body: "test",
    });
    const env = mockEnvForCanonical(null);
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("X-Schema-Version");
  });

  it("returns 404 when session not found", async () => {
    const req = await makeCanonicalRequest();
    const env = mockEnvForCanonical(null);
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 204 when content_hash is unchanged and content already stored (idempotent no-op)", async () => {
    const req = await makeCanonicalRequest({
      "X-Content-Hash": "existing-hash",
    });
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "existing-hash",
      raw_hash: "raw-1",
      content_key: "user-1/claude:abc-123/canonical.json.gz",
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(204);
    // R2 should not be called
    expect(env.BUCKET.put).not.toHaveBeenCalled();
  });

  it("proceeds when content_hash matches but content_key is null (first-time storage)", async () => {
    const req = await makeCanonicalRequest({
      "X-Content-Hash": "existing-hash",
    });
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "existing-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(200);
    // R2 should have been called to store the content
    expect(env.BUCKET.put).toHaveBeenCalledTimes(1);
  });

  it("proceeds when content_hash differs even if stale content_key exists (hash-change invalidation)", async () => {
    const req = await makeCanonicalRequest({
      "X-Content-Hash": "new-hash-after-resync",
    });
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash-from-previous-version",
      raw_hash: "raw-1",
      content_key: "user-1/claude:abc-123/canonical/old-hash.json.gz",
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    // Should NOT return 204 — hash mismatch means new content must be uploaded
    expect(res.status).toBe(200);
    expect(env.BUCKET.put).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when incoming parser_revision is older", async () => {
    const req = await makeCanonicalRequest({ "X-Parser-Revision": "1" });
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 3,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Version conflict");
  });

  it("successfully ingests canonical content", async () => {
    const req = await makeCanonicalRequest();
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      stored: boolean;
      messages: number;
      chunks: number;
    };
    expect(body.stored).toBe(true);
    expect(body.messages).toBe(2);
    expect(body.chunks).toBe(2); // 2 messages, each fits in 1 chunk

    // D1 batch should have been called:
    // Batch 1: 1 DELETE + 2 INSERTs (messages) + 2 INSERTs (chunks) = 5 statements
    // Batch 2: 1 UPDATE (content_key) — executed last for atomicity
    expect(env.DB.batch).toHaveBeenCalledTimes(2);

    // R2 should have been called
    expect(env.BUCKET.put).toHaveBeenCalledTimes(1);
    const putCall = (env.BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe("user-1/claude:abc-123/canonical.json.gz");
  });

  it("returns 400 when request body is missing", async () => {
    const req = new Request("http://worker/test", {
      method: "PUT",
      headers: {
        "X-Content-Hash": "hash",
        "X-Parser-Revision": "1",
        "X-Schema-Version": "1",
      },
    });
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing request body");
  });

  it("chunks long messages correctly", async () => {
    const longSession = {
      ...canonicalSession,
      messages: [
        { role: "user", content: "Hello", timestamp: "2026-01-15T10:00:00Z" },
        {
          role: "assistant",
          content: "x".repeat(5000),
          timestamp: "2026-01-15T10:00:05Z",
        },
      ],
    };
    const req = await makeCanonicalRequest(
      undefined,
      JSON.stringify(longSession),
    );
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      stored: boolean;
      messages: number;
      chunks: number;
    };
    expect(body.messages).toBe(2);
    expect(body.chunks).toBe(4); // 1 chunk for short msg + 3 chunks for 5000-char msg
  });

  it("includes tool_context in chunks for tool messages", async () => {
    const toolSession = {
      ...canonicalSession,
      messages: [
        {
          role: "tool",
          content: "File content here",
          toolName: "read_file",
          toolInput: '{"path":"src/a.ts"}',
          timestamp: "2026-01-15T10:00:00Z",
        },
      ],
    };
    const req = await makeCanonicalRequest(
      undefined,
      JSON.stringify(toolSession),
    );
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(200);

    // Verify D1 batch was called — check that chunk INSERT includes tool_context
    const batchCalls = (env.DB.batch as ReturnType<typeof vi.fn>).mock.calls;
    expect(batchCalls.length).toBe(2);
    // Batch 1: 1 DELETE + 1 message INSERT + 1 chunk INSERT = 3 stmts
    // Batch 2: 1 UPDATE (content_key) — executed last
    expect(batchCalls[0][0]).toHaveLength(3);
  });

  it("returns 500 when D1 batch fails", async () => {
    const req = await makeCanonicalRequest();
    const bucket = mockR2();
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "session-id-1",
            content_hash: "old-hash",
            raw_hash: "raw-1",
            content_key: null,
            raw_key: null,
            parser_revision: 1,
            schema_version: 1,
          }),
          run: vi.fn(),
        }),
        first: vi.fn(),
        run: vi.fn(),
      }),
      batch: vi.fn().mockRejectedValue(new Error("D1 write quota exceeded")),
    } as unknown as D1Database;
    const env: Env = { DB: db, BUCKET: bucket };
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Canonical ingest failed");
  });

  it("writes R2 before D1 — R2 failure prevents D1 batch", async () => {
    const req = await makeCanonicalRequest();
    const bucket = {
      ...mockR2(),
      put: vi.fn().mockRejectedValue(new Error("R2 service unavailable")),
    } as unknown as R2Bucket;
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "session-id-1",
            content_hash: "old-hash",
            raw_hash: "raw-1",
            content_key: null,
            raw_key: null,
            parser_revision: 1,
            schema_version: 1,
          }),
          run: vi.fn(),
        }),
        first: vi.fn(),
        run: vi.fn(),
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database;
    const env: Env = { DB: db, BUCKET: bucket };
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Canonical ingest failed");
    // D1 batch must NOT have been called — R2 failed first
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("R2 succeeds → D1 fails → R2 object is harmless orphan, returns 500", async () => {
    const req = await makeCanonicalRequest();
    const bucket = mockR2();
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "session-id-1",
            content_hash: "old-hash",
            raw_hash: "raw-1",
            content_key: null,
            raw_key: null,
            parser_revision: 1,
            schema_version: 1,
          }),
          run: vi.fn(),
        }),
        first: vi.fn(),
        run: vi.fn(),
      }),
      batch: vi.fn().mockRejectedValue(new Error("D1 write quota exceeded")),
    } as unknown as D1Database;
    const env: Env = { DB: db, BUCKET: bucket };
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(500);
    // R2 was called (succeeded), then D1 failed
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it("splits D1 batches when statements exceed 500", async () => {
    // 260 messages × 2 stmts each (INSERT message + INSERT chunk) + 1 DELETE = 521 > 500
    const manyMessages = Array.from({ length: 260 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
      timestamp: `2026-01-15T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const largeSession = { ...canonicalSession, messages: manyMessages };
    const req = await makeCanonicalRequest(
      undefined,
      JSON.stringify(largeSession),
    );
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      stored: boolean;
      messages: number;
      chunks: number;
    };
    expect(body.messages).toBe(260);

    // 521 stmts → ceil(521/500) = 2 insert batches + 1 final UPDATE batch = 3
    const batchCalls = (env.DB.batch as ReturnType<typeof vi.fn>).mock.calls;
    expect(batchCalls.length).toBeGreaterThanOrEqual(3);

    // Final batch should contain only the UPDATE statement (content_key)
    const lastBatch = batchCalls[batchCalls.length - 1][0];
    expect(lastBatch).toHaveLength(1);
  });

  it("sets content_key only in final batch after all inserts", async () => {
    const req = await makeCanonicalRequest();
    const env = mockEnvForCanonical({
      id: "session-id-1",
      content_hash: "old-hash",
      raw_hash: "raw-1",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleCanonicalUpload(
      "claude:abc-123",
      "user-1",
      req,
      env,
    );
    expect(res.status).toBe(200);

    // Batch 1: DELETE + INSERT messages + INSERT chunks (all inserts)
    // Batch 2: UPDATE content_key (final)
    const batchCalls = (env.DB.batch as ReturnType<typeof vi.fn>).mock.calls;
    expect(batchCalls.length).toBe(2);

    // Final batch contains exactly 1 statement (the UPDATE)
    const lastBatch = batchCalls[batchCalls.length - 1][0];
    expect(lastBatch).toHaveLength(1);

    // First batch should contain more than 1 statement (DELETE + INSERTs)
    const firstBatch = batchCalls[0][0];
    expect(firstBatch.length).toBeGreaterThan(1);
  });
});

// ── handleRawUpload ───────────────────────────────────────────

describe("handleRawUpload", () => {
  async function makeRawRequest(
    headers?: Record<string, string>,
  ): Promise<Request> {
    const rawContent = JSON.stringify({
      sessionKey: "claude:abc-123",
      source: "claude-code",
      parserRevision: 1,
      collectedAt: "2026-01-15T10:31:00Z",
      sourceFiles: [
        {
          path: "/path/to/file.jsonl",
          format: "jsonl",
          content: "line1\nline2",
        },
      ],
    });
    const compressed = await gzipCompress(rawContent);
    return new Request("http://worker/ingest/content/claude%3Aabc-123/raw", {
      method: "PUT",
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "application/octet-stream",
        "X-Raw-Hash": "newrawhash456",
        ...headers,
      },
      body: compressed,
    });
  }

  function mockEnvForRaw(sessionRow: unknown): Env {
    const bucket = mockR2();
    const db = mockD1(undefined, { firstResult: sessionRow });
    return { DB: db, BUCKET: bucket };
  }

  it("returns 400 when X-Raw-Hash is missing", async () => {
    const rawContent = "compressed data";
    const req = new Request("http://worker/test", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: rawContent,
    });
    const env = mockEnvForRaw(null);
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("X-Raw-Hash");
  });

  it("returns 404 when session not found", async () => {
    const req = await makeRawRequest();
    const env = mockEnvForRaw(null);
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(404);
  });

  it("returns 204 when raw_hash is unchanged and raw already stored (idempotent no-op)", async () => {
    const req = await makeRawRequest({ "X-Raw-Hash": "existing-raw-hash" });
    const env = mockEnvForRaw({
      id: "session-id-1",
      content_hash: "content-1",
      raw_hash: "existing-raw-hash",
      content_key: null,
      raw_key: "user-1/claude:abc-123/raw/existing-raw-hash.json.gz",
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(204);
    expect(env.BUCKET.put).not.toHaveBeenCalled();
  });

  it("proceeds when raw_hash matches but raw_key is null (first-time storage)", async () => {
    const req = await makeRawRequest({ "X-Raw-Hash": "existing-raw-hash" });
    const env = mockEnvForRaw({
      id: "session-id-1",
      content_hash: "content-1",
      raw_hash: "existing-raw-hash",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(200);
    expect(env.BUCKET.put).toHaveBeenCalledTimes(1);
  });

  it("proceeds when raw_hash differs even if stale raw_key exists (hash-change invalidation)", async () => {
    const req = await makeRawRequest({ "X-Raw-Hash": "new-raw-hash" });
    const env = mockEnvForRaw({
      id: "session-id-1",
      content_hash: "content-1",
      raw_hash: "old-raw-hash-from-previous-version",
      content_key: null,
      raw_key: "user-1/claude:abc-123/raw/old-raw-hash.json.gz",
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    // Should NOT return 204 — hash mismatch means new content must be uploaded
    expect(res.status).toBe(200);
    expect(env.BUCKET.put).toHaveBeenCalledTimes(1);
  });

  it("successfully uploads raw content to R2", async () => {
    const req = await makeRawRequest();
    const env = mockEnvForRaw({
      id: "session-id-1",
      content_hash: "content-1",
      raw_hash: "old-raw-hash",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { stored: boolean };
    expect(body.stored).toBe(true);

    // R2 should have been called with content-addressed path
    expect(env.BUCKET.put).toHaveBeenCalledTimes(1);
    const putCall = (env.BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe("user-1/claude:abc-123/raw/newrawhash456.json.gz");
  });

  it("returns 400 when request body is missing", async () => {
    const req = new Request("http://worker/test", {
      method: "PUT",
      headers: { "X-Raw-Hash": "hash" },
    });
    const env = mockEnvForRaw({
      id: "session-id-1",
      content_hash: "content-1",
      raw_hash: "old-hash",
      content_key: null,
      raw_key: null,
      parser_revision: 1,
      schema_version: 1,
    });
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing request body");
  });

  it("returns 500 when R2 put fails", async () => {
    const req = await makeRawRequest();
    const bucket = mockR2();
    (bucket.put as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("R2 write failed"),
    );
    const db = mockD1(undefined, {
      firstResult: {
        id: "session-id-1",
        content_hash: "content-1",
        raw_hash: "old-hash",
        content_key: null,
        raw_key: null,
        parser_revision: 1,
        schema_version: 1,
      },
    });
    const env: Env = { DB: db, BUCKET: bucket };
    const res = await handleRawUpload("claude:abc-123", "user-1", req, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Raw ingest failed");
  });
});
// ── handleLive ─────────────────────────────────────────────────

describe("handleLive", () => {
  it("returns ok with database connected when D1 responds", async () => {
    const env: Env = {
      DB: mockD1(undefined, { firstResult: { "1": 1 } }),
      BUCKET: mockR2(),
    };

    const res = await handleLive(env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      version: string;
      component: string;
      uptime: number;
      timestamp: string;
      database: { connected: boolean };
    };
    expect(body.status).toBe("ok");
    expect(body.version).toBe(PIKA_VERSION);
    expect(body.component).toBe("worker");
    expect(body.database.connected).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.uptime)).toBe(true);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 error when D1 throws", async () => {
    const mockFirst = vi
      .fn()
      .mockRejectedValue(new Error("D1 connection refused"));
    const env: Env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          first: mockFirst,
          bind: vi.fn().mockReturnThis(),
        }),
        batch: vi.fn(),
      } as unknown as D1Database,
      BUCKET: mockR2(),
    };

    const res = await handleLive(env);
    expect(res.status).toBe(503);

    const body = (await res.json()) as {
      status: string;
      database: { connected: boolean; error: string };
      uptime: number;
      timestamp: string;
    };
    expect(body.status).toBe("error");
    expect(body.database.connected).toBe(false);
    expect(body.database.error).toBe("D1 connection refused");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("error response does not contain 'ok'", async () => {
    const mockFirst = vi.fn().mockRejectedValue(new Error("lookup ok failed"));
    const env: Env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          first: mockFirst,
          bind: vi.fn().mockReturnThis(),
        }),
        batch: vi.fn(),
      } as unknown as D1Database,
      BUCKET: mockR2(),
    };

    const res = await handleLive(env);
    const body = await res.text();

    expect(body).not.toContain('"ok"');
    // Verify "ok" was sanitized in the database error message
    const parsed = JSON.parse(body) as { database: { error: string } };
    expect(parsed.database.error).toBe("lookup *** failed");
  });

  it("handles non-Error thrown values", async () => {
    const mockFirst = vi.fn().mockRejectedValue("string failure");
    const env: Env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          first: mockFirst,
          bind: vi.fn().mockReturnThis(),
        }),
        batch: vi.fn(),
      } as unknown as D1Database,
      BUCKET: mockR2(),
    };

    const res = await handleLive(env);
    expect(res.status).toBe(503);

    const body = (await res.json()) as { database: { error: string } };
    expect(body.database.error).toBe("string failure");
  });
});
