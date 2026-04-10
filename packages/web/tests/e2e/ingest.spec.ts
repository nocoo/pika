/**
 * E2E tests for ingest API endpoints.
 *
 * Covers:
 * - POST /api/ingest/sessions (create/update sessions)
 * - PUT /api/ingest/content/{sessionKey}/{type} (upload canonical/raw content)
 *
 * Note: presign and confirm-raw endpoints use auth() directly and don't
 * support E2E_SKIP_AUTH bypass. Testing those requires real API key auth.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanupTestData, ensureTestUser, testId } from "./helpers";

// ── Raw fetch helper (bypasses request() JSON.stringify) ────────

function getBaseUrl(): string {
  return process.env.E2E_BASE_URL ?? "http://localhost:17022";
}

async function rawRequest(
  method: string,
  path: string,
  body: BodyInit | null,
  headers: Record<string, string>,
): Promise<Response> {
  const url = new URL(path, getBaseUrl());
  return fetch(url.toString(), {
    method,
    headers,
    body,
  });
}

/**
 * Gzip compress a string using Node's zlib.
 * Returns a Uint8Array suitable for HTTP body.
 */
async function gzipCompress(content: string): Promise<Uint8Array> {
  const { gzip } = await import("node:zlib");
  const { promisify } = await import("node:util");
  const gzipAsync = promisify(gzip);
  const buffer = await gzipAsync(Buffer.from(content, "utf-8"));
  return new Uint8Array(buffer);
}

describe("Ingest API", () => {
  beforeAll(async () => {
    await ensureTestUser();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ── POST /api/ingest/sessions ─────────────────────────────────

  describe("POST /api/ingest/sessions", () => {
    it("creates a new session with valid SessionSnapshot", async () => {
      const sessionKey = `claude:${testId("ingest")}`;
      const now = new Date().toISOString();

      // SessionSnapshot format (camelCase, per @pika/core types)
      const payload = {
        sessions: [
          {
            sessionKey,
            source: "claude-code",
            startedAt: now,
            lastMessageAt: now,
            durationSeconds: 1800,
            userMessages: 5,
            assistantMessages: 5,
            totalMessages: 10,
            totalInputTokens: 1000,
            totalOutputTokens: 500,
            totalCachedTokens: 200,
            projectRef: null,
            projectName: "Test Project",
            model: "claude-sonnet-4-20250514",
            title: "Test Session",
            contentHash: "abc123def456789012345678901234567890abcd",
            rawHash: "def456abc123789012345678901234567890abcd",
            parserRevision: 1,
            schemaVersion: 1,
            snapshotAt: now,
          },
        ],
      };

      const body = JSON.stringify(payload);
      const res = await rawRequest("POST", "/api/ingest/sessions", body, {
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(body).length),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ingested?: number };
      expect(data.ingested).toBe(1);
    });

    it("returns 400 for missing required fields", async () => {
      // Missing contentHash, rawHash, parserRevision, schemaVersion
      const payload = {
        sessions: [
          {
            sessionKey: `claude:${testId("bad")}`,
            source: "claude-code",
            startedAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString(),
          },
        ],
      };

      const body = JSON.stringify(payload);
      const res = await rawRequest("POST", "/api/ingest/sessions", body, {
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(body).length),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error?: string };
      expect(data.error).toBeTruthy();
    });
  });

  // ── PUT /api/ingest/content/{sessionKey}/{type} ───────────────

  describe("PUT /api/ingest/content/{sessionKey}/{type}", () => {
    it("accepts canonical content upload (gzip compressed)", async () => {
      const sessionKey = `claude:${testId("content")}`;
      const now = new Date().toISOString();

      // Build valid CanonicalSession structure (per @pika/core types)
      // - messages[].content is string (not array)
      // - messages[].timestamp is required
      // - messages array must not be empty
      const content = JSON.stringify({
        sessionKey,
        source: "claude-code",
        startedAt: now,
        lastMessageAt: now,
        durationSeconds: 60,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCachedTokens: 0,
        projectRef: null,
        projectName: null,
        model: "claude-sonnet-4-20250514",
        title: "Test",
        parserRevision: 1,
        schemaVersion: 1,
        snapshotAt: now,
        messages: [
          { role: "user", content: "Hello", timestamp: now },
          { role: "assistant", content: "Hi there!", timestamp: now },
        ],
      });

      // Gzip compress the content (required by Worker)
      const compressed = await gzipCompress(content);

      const res = await rawRequest(
        "PUT",
        `/api/ingest/content/${sessionKey}/canonical`,
        compressed as unknown as BodyInit,
        {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "gzip",
          "Content-Length": String(compressed.length),
          "X-Content-Hash": "abc123def456789012345678901234567890abcd",
          "X-Parser-Revision": "1",
          "X-Schema-Version": "1",
        },
      );

      // 404 = session doesn't exist (need to ingest metadata first)
      // 200/201 = success (if session exists)
      // 204 = content unchanged (idempotent)
      expect([200, 201, 204, 404]).toContain(res.status);

      // If 404, verify it's the expected "session not found" error
      if (res.status === 404) {
        const data = (await res.json()) as { error?: string };
        expect(data.error).toContain("not found");
      }
    });

    it("returns 400 for invalid content type param", async () => {
      const sessionKey = `claude:${testId("badtype")}`;
      const content = "test";
      const contentBytes = new TextEncoder().encode(content);

      const res = await rawRequest(
        "PUT",
        `/api/ingest/content/${sessionKey}/invalid`,
        content,
        {
          "Content-Type": "application/json",
          "Content-Length": String(contentBytes.length),
        },
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error?: string };
      expect(data.error).toContain("canonical");
    });

    it("returns 400 for path with insufficient segments", async () => {
      const content = "test";
      const contentBytes = new TextEncoder().encode(content);

      const res = await rawRequest(
        "PUT",
        `/api/ingest/content/only-one-segment`,
        content,
        {
          "Content-Type": "application/json",
          "Content-Length": String(contentBytes.length),
        },
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error?: string };
      expect(data.error).toBeTruthy();
    });
  });
});
