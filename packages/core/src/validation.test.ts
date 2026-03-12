import { describe, it, expect } from "vitest";
import {
  isValidSource,
  isValidMessageRole,
  isValidApiKey,
  isValidISOTimestamp,
  isValidSessionKey,
  validateCanonicalMessage,
  validateCanonicalSession,
  validateSessionSnapshot,
  validateParseError,
} from "./validation.js";
import type {
  CanonicalMessage,
  CanonicalSession,
  SessionSnapshot,
  ParseError,
} from "./types.js";

// ── Source validation ──────────────────────────────────────────

describe("isValidSource", () => {
  it("accepts all valid sources", () => {
    expect(isValidSource("claude-code")).toBe(true);
    expect(isValidSource("codex")).toBe(true);
    expect(isValidSource("gemini-cli")).toBe(true);
    expect(isValidSource("opencode")).toBe(true);
    expect(isValidSource("vscode-copilot")).toBe(true);
  });

  it("rejects invalid sources", () => {
    expect(isValidSource("unknown")).toBe(false);
    expect(isValidSource("")).toBe(false);
    expect(isValidSource("Claude-Code")).toBe(false);
  });
});

// ── Role validation ────────────────────────────────────────────

describe("isValidMessageRole", () => {
  it("accepts all valid roles", () => {
    expect(isValidMessageRole("user")).toBe(true);
    expect(isValidMessageRole("assistant")).toBe(true);
    expect(isValidMessageRole("tool")).toBe(true);
    expect(isValidMessageRole("system")).toBe(true);
  });

  it("rejects invalid roles", () => {
    expect(isValidMessageRole("admin")).toBe(false);
    expect(isValidMessageRole("")).toBe(false);
  });
});

// ── API key validation ─────────────────────────────────────────

describe("isValidApiKey", () => {
  it("accepts valid api key", () => {
    expect(isValidApiKey("pk_" + "a".repeat(32))).toBe(true);
    expect(isValidApiKey("pk_" + "0123456789abcdef".repeat(2))).toBe(true);
  });

  it("rejects keys without prefix", () => {
    expect(isValidApiKey("xx_" + "a".repeat(32))).toBe(false);
  });

  it("rejects keys with wrong length", () => {
    expect(isValidApiKey("pk_" + "a".repeat(31))).toBe(false);
    expect(isValidApiKey("pk_" + "a".repeat(33))).toBe(false);
  });

  it("rejects keys with non-hex chars", () => {
    expect(isValidApiKey("pk_" + "g".repeat(32))).toBe(false);
    expect(isValidApiKey("pk_" + "Z".repeat(32))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidApiKey("")).toBe(false);
  });
});

// ── ISO timestamp validation ───────────────────────────────────

describe("isValidISOTimestamp", () => {
  it("accepts valid ISO 8601 timestamps", () => {
    expect(isValidISOTimestamp("2026-01-15T10:30:00Z")).toBe(true);
    expect(isValidISOTimestamp("2026-01-15T10:30:00.000Z")).toBe(true);
    expect(isValidISOTimestamp("2026-01-15T10:30:00+09:00")).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    expect(isValidISOTimestamp("not-a-date")).toBe(false);
    expect(isValidISOTimestamp("")).toBe(false);
    expect(isValidISOTimestamp("2026-13-01T00:00:00Z")).toBe(false);
  });
});

// ── Session key validation ─────────────────────────────────────

describe("isValidSessionKey", () => {
  it("accepts valid session keys", () => {
    expect(isValidSessionKey("claude:abc123")).toBe(true);
    expect(isValidSessionKey("codex:session-id")).toBe(true);
    expect(isValidSessionKey("gemini:uuid-here")).toBe(true);
    expect(isValidSessionKey("opencode:ses_xyz")).toBe(true);
    expect(isValidSessionKey("copilot:session-id")).toBe(true);
  });

  it("rejects keys without colon separator", () => {
    expect(isValidSessionKey("nocolon")).toBe(false);
    expect(isValidSessionKey("")).toBe(false);
  });

  it("rejects keys with empty parts", () => {
    expect(isValidSessionKey(":value")).toBe(false);
    expect(isValidSessionKey("prefix:")).toBe(false);
  });
});

// ── CanonicalMessage validation ────────────────────────────────

describe("validateCanonicalMessage", () => {
  const validMessage: CanonicalMessage = {
    role: "user",
    content: "Hello world",
    timestamp: "2026-01-15T10:30:00Z",
  };

  it("passes for valid message", () => {
    const errors = validateCanonicalMessage(validMessage);
    expect(errors).toEqual([]);
  });

  it("passes for message with optional fields", () => {
    const msg: CanonicalMessage = {
      ...validMessage,
      role: "tool",
      toolName: "Bash",
      toolInput: "ls -la",
      toolResult: "file1.ts\nfile2.ts",
      model: "claude-sonnet-4-20250514",
      inputTokens: 100,
      outputTokens: 200,
      cachedTokens: 50,
    };
    expect(validateCanonicalMessage(msg)).toEqual([]);
  });

  it("reports invalid role", () => {
    const msg = { ...validMessage, role: "invalid" as any };
    const errors = validateCanonicalMessage(msg);
    expect(errors).toContainEqual(expect.stringContaining("role"));
  });

  it("reports empty content", () => {
    const msg = { ...validMessage, content: "" };
    const errors = validateCanonicalMessage(msg);
    expect(errors).toContainEqual(expect.stringContaining("content"));
  });

  it("reports invalid timestamp", () => {
    const msg = { ...validMessage, timestamp: "not-a-date" };
    const errors = validateCanonicalMessage(msg);
    expect(errors).toContainEqual(expect.stringContaining("timestamp"));
  });

  it("reports negative token counts", () => {
    const msg = { ...validMessage, inputTokens: -1 };
    const errors = validateCanonicalMessage(msg);
    expect(errors).toContainEqual(expect.stringContaining("inputTokens"));
  });

  it("reports negative outputTokens", () => {
    const msg = { ...validMessage, outputTokens: -5 };
    const errors = validateCanonicalMessage(msg);
    expect(errors).toContainEqual(expect.stringContaining("outputTokens"));
  });

  it("reports negative cachedTokens", () => {
    const msg = { ...validMessage, cachedTokens: -3 };
    const errors = validateCanonicalMessage(msg);
    expect(errors).toContainEqual(expect.stringContaining("cachedTokens"));
  });
});

// ── CanonicalSession validation ────────────────────────────────

describe("validateCanonicalSession", () => {
  const validSession: CanonicalSession = {
    sessionKey: "claude:test-123",
    source: "claude-code",
    parserRevision: 1,
    schemaVersion: 1,
    startedAt: "2026-01-15T10:00:00Z",
    lastMessageAt: "2026-01-15T10:30:00Z",
    durationSeconds: 1800,
    projectRef: null,
    projectName: null,
    model: "claude-sonnet-4-20250514",
    title: "Test session",
    messages: [
      {
        role: "user",
        content: "Hello",
        timestamp: "2026-01-15T10:00:00Z",
      },
    ],
    totalInputTokens: 100,
    totalOutputTokens: 200,
    totalCachedTokens: 50,
    snapshotAt: "2026-01-15T10:31:00Z",
  };

  it("passes for valid session", () => {
    expect(validateCanonicalSession(validSession)).toEqual([]);
  });

  it("reports invalid source", () => {
    const session = { ...validSession, source: "invalid" as any };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("source"),
    );
  });

  it("reports invalid session key", () => {
    const session = { ...validSession, sessionKey: "" };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("sessionKey"),
    );
  });

  it("reports non-positive parser revision", () => {
    const session = { ...validSession, parserRevision: 0 };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("parserRevision"),
    );
  });

  it("reports non-positive schema version", () => {
    const session = { ...validSession, schemaVersion: 0 };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("schemaVersion"),
    );
  });

  it("reports negative duration", () => {
    const session = { ...validSession, durationSeconds: -1 };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("durationSeconds"),
    );
  });

  it("reports empty messages array", () => {
    const session = { ...validSession, messages: [] };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("messages"),
    );
  });

  it("reports invalid timestamps", () => {
    const session = { ...validSession, startedAt: "bad" };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("startedAt"),
    );
  });

  it("reports invalid lastMessageAt timestamp", () => {
    const session = { ...validSession, lastMessageAt: "bad" };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("lastMessageAt"),
    );
  });

  it("reports invalid snapshotAt timestamp", () => {
    const session = { ...validSession, snapshotAt: "bad" };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("snapshotAt"),
    );
  });

  it("reports negative token totals", () => {
    const session = { ...validSession, totalInputTokens: -1 };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("totalInputTokens"),
    );
  });

  it("reports negative totalOutputTokens", () => {
    const session = { ...validSession, totalOutputTokens: -1 };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("totalOutputTokens"),
    );
  });

  it("reports negative totalCachedTokens", () => {
    const session = { ...validSession, totalCachedTokens: -1 };
    expect(validateCanonicalSession(session)).toContainEqual(
      expect.stringContaining("totalCachedTokens"),
    );
  });

  it("collects nested message errors", () => {
    const session = {
      ...validSession,
      messages: [{ role: "bad" as any, content: "", timestamp: "nope" }],
    };
    const errors = validateCanonicalSession(session);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.includes("messages[0]"))).toBe(true);
  });
});

// ── SessionSnapshot validation ─────────────────────────────────

describe("validateSessionSnapshot", () => {
  const validSnapshot: SessionSnapshot = {
    sessionKey: "claude:test-123",
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
    projectName: null,
    model: "claude-sonnet-4-20250514",
    title: null,
    contentHash: "abc123",
    rawHash: "def456",
    parserRevision: 1,
    schemaVersion: 1,
    snapshotAt: "2026-01-15T10:31:00Z",
  };

  it("passes for valid snapshot", () => {
    expect(validateSessionSnapshot(validSnapshot)).toEqual([]);
  });

  it("reports missing contentHash", () => {
    const snapshot = { ...validSnapshot, contentHash: "" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("contentHash"),
    );
  });

  it("reports missing rawHash", () => {
    const snapshot = { ...validSnapshot, rawHash: "" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("rawHash"),
    );
  });

  it("reports invalid sessionKey", () => {
    const snapshot = { ...validSnapshot, sessionKey: "" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("sessionKey"),
    );
  });

  it("reports invalid startedAt", () => {
    const snapshot = { ...validSnapshot, startedAt: "nope" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("startedAt"),
    );
  });

  it("reports invalid lastMessageAt", () => {
    const snapshot = { ...validSnapshot, lastMessageAt: "nope" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("lastMessageAt"),
    );
  });

  it("reports invalid snapshotAt", () => {
    const snapshot = { ...validSnapshot, snapshotAt: "nope" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("snapshotAt"),
    );
  });

  it("reports negative durationSeconds", () => {
    const snapshot = { ...validSnapshot, durationSeconds: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("durationSeconds"),
    );
  });

  it("reports negative userMessages", () => {
    const snapshot = { ...validSnapshot, userMessages: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("userMessages"),
    );
  });

  it("reports negative assistantMessages", () => {
    const snapshot = { ...validSnapshot, assistantMessages: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("assistantMessages"),
    );
  });

  it("reports negative totalMessages", () => {
    const snapshot = { ...validSnapshot, totalMessages: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("totalMessages"),
    );
  });

  it("reports negative totalInputTokens", () => {
    const snapshot = { ...validSnapshot, totalInputTokens: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("totalInputTokens"),
    );
  });

  it("reports negative totalOutputTokens", () => {
    const snapshot = { ...validSnapshot, totalOutputTokens: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("totalOutputTokens"),
    );
  });

  it("reports negative totalCachedTokens", () => {
    const snapshot = { ...validSnapshot, totalCachedTokens: -1 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("totalCachedTokens"),
    );
  });

  it("reports missing contentHash", () => {
    const snapshot = { ...validSnapshot, contentHash: "" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("contentHash"),
    );
  });

  it("reports missing rawHash", () => {
    const snapshot = { ...validSnapshot, rawHash: "" };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("rawHash"),
    );
  });

  it("reports non-positive parserRevision", () => {
    const snapshot = { ...validSnapshot, parserRevision: 0 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("parserRevision"),
    );
  });

  it("reports non-positive schemaVersion", () => {
    const snapshot = { ...validSnapshot, schemaVersion: 0 };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("schemaVersion"),
    );
  });

  it("reports invalid source", () => {
    const snapshot = { ...validSnapshot, source: "bad" as any };
    expect(validateSessionSnapshot(snapshot)).toContainEqual(
      expect.stringContaining("source"),
    );
  });
});

// ── ParseError validation ──────────────────────────────────────

describe("validateParseError", () => {
  const validError: ParseError = {
    timestamp: "2026-01-15T10:00:00Z",
    source: "claude-code",
    filePath: "/home/user/.claude/projects/test.jsonl",
    error: "Unexpected token",
  };

  it("passes for valid parse error", () => {
    expect(validateParseError(validError)).toEqual([]);
  });

  it("passes with optional fields", () => {
    const err: ParseError = {
      ...validError,
      line: 42,
      sessionKey: "claude:test",
    };
    expect(validateParseError(err)).toEqual([]);
  });

  it("reports invalid timestamp", () => {
    const err = { ...validError, timestamp: "not-a-date" };
    expect(validateParseError(err)).toContainEqual(
      expect.stringContaining("timestamp"),
    );
  });

  it("reports empty filePath", () => {
    const err = { ...validError, filePath: "" };
    expect(validateParseError(err)).toContainEqual(
      expect.stringContaining("filePath"),
    );
  });

  it("reports empty error message", () => {
    const err = { ...validError, error: "" };
    expect(validateParseError(err)).toContainEqual(
      expect.stringContaining("error"),
    );
  });

  it("reports invalid source", () => {
    const err = { ...validError, source: "nope" as any };
    expect(validateParseError(err)).toContainEqual(
      expect.stringContaining("source"),
    );
  });
});
