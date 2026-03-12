import { describe, it, expect, vi } from "vitest";
import {
  validateIngestRequest,
  validateWorkerAuth,
  handleSessionIngest,
  checkVersionConflicts,
  type IngestSessionPayload,
  type Env,
} from "./index.js";

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
  options?: { method?: string; headers?: Record<string, string>; body?: unknown },
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
): D1Database {
  let callIndex = 0;
  const results = batchResults ?? [
    [{ results: [] }], // version check: no existing sessions (new)
    [],                 // upsert: success
  ];

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
    }),
    batch: vi.fn().mockImplementation(() => {
      const result = results[callIndex] ?? [];
      callIndex++;
      return Promise.resolve(result);
    }),
  } as unknown as D1Database;
}

// ── Auth validation ────────────────────────────────────────────

describe("validateWorkerAuth", () => {
  it("passes with correct Bearer secret", () => {
    const req = makeRequest("http://worker/ingest/sessions", {
      headers: { Authorization: "Bearer test-secret-123" },
    });
    expect(validateWorkerAuth(req, "test-secret-123")).toBe(true);
  });

  it("fails with wrong secret", () => {
    const req = makeRequest("http://worker/ingest/sessions", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(validateWorkerAuth(req, "test-secret-123")).toBe(false);
  });

  it("fails with missing Authorization header", () => {
    const req = makeRequest("http://worker/ingest/sessions");
    expect(validateWorkerAuth(req, "test-secret-123")).toBe(false);
  });

  it("fails with non-Bearer auth", () => {
    const req = makeRequest("http://worker/ingest/sessions", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(validateWorkerAuth(req, "test-secret-123")).toBe(false);
  });
});

// ── Ingest request validation ──────────────────────────────────

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
    expect(result.errors).toContainEqual(
      expect.stringContaining("sessionKey"),
    );
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
});

// ── checkVersionConflicts ──────────────────────────────────────

describe("checkVersionConflicts", () => {
  it("returns empty for new sessions (no existing rows)", async () => {
    const db = mockD1([
      [{ results: [] }], // no existing row
    ]);
    const conflicts = await checkVersionConflicts(
      "user-1",
      [validSession],
      db,
    );
    expect(conflicts).toEqual([]);
  });

  it("returns empty when incoming version equals existing", async () => {
    const db = mockD1([
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 1, schema_version: 1 }] }],
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
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 1, schema_version: 1 }] }],
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
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 3, schema_version: 1 }] }],
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
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 1, schema_version: 2 }] }],
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
        { results: [{ session_key: "claude:stale-one", parser_revision: 5, schema_version: 1 }] },
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
      BUCKET: {} as unknown as R2Bucket,
      WORKER_SECRET: "secret",
    };
  }

  it("returns 400 for invalid payload", async () => {
    const env = mockEnv();
    const res = await handleSessionIngest(
      { userId: "", sessions: [] },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string[] };
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("inserts new sessions successfully (version check returns empty)", async () => {
    const env = mockEnv([
      [{ results: [] }], // version check: no existing
      [],                 // upsert: ok
    ]);
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(200);

    const body = await res.json() as { ingested: number };
    expect(body.ingested).toBe(1);
    expect(env.DB.batch).toHaveBeenCalledTimes(2); // version check + upsert
  });

  it("returns 409 when incoming version is older than existing", async () => {
    const env = mockEnv([
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 5, schema_version: 1 }] }],
    ]);
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(409);

    const body = await res.json() as { error: string; conflicts: unknown[] };
    expect(body.error).toContain("Version conflict");
    expect(body.conflicts).toHaveLength(1);
    // Upsert batch should NOT have been called
    expect(env.DB.batch).toHaveBeenCalledTimes(1); // only version check
  });

  it("proceeds when incoming version equals existing", async () => {
    const env = mockEnv([
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 1, schema_version: 1 }] }],
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
      [{ results: [{ session_key: "claude:abc-123", parser_revision: 1, schema_version: 1 }] }],
      [], // upsert
    ]);
    const res = await handleSessionIngest(payload, env);
    expect(res.status).toBe(200);
  });

  it("returns 500 when D1 batch fails", async () => {
    const db = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({}) }),
      batch: vi.fn()
        .mockResolvedValueOnce([{ results: [] }]) // version check ok
        .mockRejectedValueOnce(new Error("D1 write quota exceeded")), // upsert fails
    } as unknown as D1Database;

    const env: Env = { DB: db, BUCKET: {} as unknown as R2Bucket, WORKER_SECRET: "secret" };
    const res = await handleSessionIngest(validPayload, env);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("D1 batch failed");
  });
});

// ── Router (default export fetch) ──────────────────────────────

describe("worker fetch handler", () => {
  // Dynamic import to get the default export
  let workerFetch: (request: Request, env: Env) => Promise<Response>;

  function mockEnv(): Env {
    return {
      DB: mockD1(),
      BUCKET: {} as unknown as R2Bucket,
      WORKER_SECRET: "test-secret",
    };
  }

  // Import the default export
  it("setup", async () => {
    const mod = await import("./index.js");
    workerFetch = mod.default.fetch;
    expect(workerFetch).toBeDefined();
  });

  it("rejects non-POST methods with 405", async () => {
    const env = mockEnv();
    const req = new Request("http://worker/ingest/sessions", { method: "GET" });
    const res = await workerFetch(req, env);
    expect(res.status).toBe(405);
  });

  it("rejects missing auth with 401", async () => {
    const env = mockEnv();
    const req = makeRequest("http://worker/ingest/sessions", {
      body: validPayload,
    });
    const res = await workerFetch(req, env);
    expect(res.status).toBe(401);
  });

  it("rejects wrong secret with 401", async () => {
    const env = mockEnv();
    const req = makeRequest("http://worker/ingest/sessions", {
      headers: { Authorization: "Bearer wrong" },
      body: validPayload,
    });
    const res = await workerFetch(req, env);
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON with 400", async () => {
    const env = mockEnv();
    const req = new Request("http://worker/ingest/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret",
        "Content-Type": "text/plain",
      },
      body: "not json",
    });
    const res = await workerFetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown paths", async () => {
    const env = mockEnv();
    const req = makeRequest("http://worker/unknown", {
      headers: { Authorization: "Bearer test-secret" },
      body: validPayload,
    });
    const res = await workerFetch(req, env);
    expect(res.status).toBe(404);
  });

  it("handles valid ingest request end-to-end", async () => {
    const env = mockEnv();
    const req = makeRequest("http://worker/ingest/sessions", {
      headers: { Authorization: "Bearer test-secret" },
      body: validPayload,
    });
    const res = await workerFetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { ingested: number };
    expect(body.ingested).toBe(1);
  });
});
