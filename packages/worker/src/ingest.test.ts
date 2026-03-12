import { describe, it, expect } from "vitest";
import {
  validateIngestRequest,
  validateWorkerAuth,
  type IngestSessionPayload,
} from "./ingest.js";

// ── Auth validation ────────────────────────────────────────────

describe("validateWorkerAuth", () => {
  it("passes with correct shared secret", () => {
    const headers = new Headers({
      "x-worker-secret": "test-secret-123",
    });
    expect(validateWorkerAuth(headers, "test-secret-123")).toBe(true);
  });

  it("fails with wrong secret", () => {
    const headers = new Headers({
      "x-worker-secret": "wrong-secret",
    });
    expect(validateWorkerAuth(headers, "test-secret-123")).toBe(false);
  });

  it("fails with missing header", () => {
    const headers = new Headers();
    expect(validateWorkerAuth(headers, "test-secret-123")).toBe(false);
  });

  it("fails with empty secret", () => {
    const headers = new Headers({
      "x-worker-secret": "",
    });
    expect(validateWorkerAuth(headers, "test-secret-123")).toBe(false);
  });
});

// ── Ingest request validation ──────────────────────────────────

describe("validateIngestRequest", () => {
  const validPayload: IngestSessionPayload = {
    userId: "user-123",
    sessions: [
      {
        sessionKey: "claude:abc-123",
        source: "claude-code",
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
      },
    ],
  };

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
      ...validPayload.sessions[0],
      sessionKey: `claude:session-${i}`,
    }));
    const payload = { ...validPayload, sessions };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("50"));
  });

  it("accepts batch of exactly 50", () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      ...validPayload.sessions[0],
      sessionKey: `claude:session-${i}`,
    }));
    const payload = { ...validPayload, sessions };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(true);
  });

  it("validates individual session snapshots", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validPayload.sessions[0], source: "invalid" as any }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("source"));
  });

  it("validates session key format", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validPayload.sessions[0], sessionKey: "no-colon" }],
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
      sessions: [{ ...validPayload.sessions[0], contentHash: "" }],
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
      sessions: [{ ...validPayload.sessions[0], rawHash: "" }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("rawHash"));
  });

  it("validates parser revision >= 1", () => {
    const payload = {
      ...validPayload,
      sessions: [{ ...validPayload.sessions[0], parserRevision: 0 }],
    };
    const result = validateIngestRequest(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("parserRevision"),
    );
  });
});
