import {
  SOURCES,
  MESSAGE_ROLES,
  type Source,
  type MessageRole,
  type CanonicalMessage,
  type CanonicalSession,
  type SessionSnapshot,
  type ParseError,
} from "./types.js";
import { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from "./constants.js";

// ── Primitive validators ───────────────────────────────────────

export function isValidSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

export function isValidMessageRole(value: string): value is MessageRole {
  return (MESSAGE_ROLES as readonly string[]).includes(value);
}

export function isValidApiKey(value: string): boolean {
  if (!value.startsWith(API_KEY_PREFIX)) return false;
  const hex = value.slice(API_KEY_PREFIX.length);
  if (hex.length !== API_KEY_HEX_LENGTH) return false;
  return /^[0-9a-f]+$/.test(hex);
}

export function isValidISOTimestamp(value: string): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (isNaN(date.getTime())) return false;
  // Reject strings that parse to a valid date but aren't really ISO format
  // e.g., "2026-13-01T00:00:00Z" -> Date might parse but month 13 is invalid
  const isoRegex =
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-][0-2]\d:[0-5]\d)$/;
  return isoRegex.test(value);
}

export function isValidSessionKey(value: string): boolean {
  if (!value) return false;
  const colonIndex = value.indexOf(":");
  if (colonIndex <= 0 || colonIndex === value.length - 1) return false;
  return true;
}

// ── Composite validators ───────────────────────────────────────

export function validateCanonicalMessage(msg: CanonicalMessage): string[] {
  const errors: string[] = [];

  if (!isValidMessageRole(msg.role)) {
    errors.push(`Invalid role: "${msg.role}"`);
  }
  if (!msg.content) {
    errors.push("Empty content");
  }
  if (!isValidISOTimestamp(msg.timestamp)) {
    errors.push(`Invalid timestamp: "${msg.timestamp}"`);
  }
  if (msg.inputTokens !== undefined && msg.inputTokens < 0) {
    errors.push(`Negative inputTokens: ${msg.inputTokens}`);
  }
  if (msg.outputTokens !== undefined && msg.outputTokens < 0) {
    errors.push(`Negative outputTokens: ${msg.outputTokens}`);
  }
  if (msg.cachedTokens !== undefined && msg.cachedTokens < 0) {
    errors.push(`Negative cachedTokens: ${msg.cachedTokens}`);
  }

  return errors;
}

export function validateCanonicalSession(session: CanonicalSession): string[] {
  const errors: string[] = [];

  if (!isValidSessionKey(session.sessionKey)) {
    errors.push(`Invalid sessionKey: "${session.sessionKey}"`);
  }
  if (!isValidSource(session.source)) {
    errors.push(`Invalid source: "${session.source}"`);
  }
  if (session.parserRevision < 1) {
    errors.push(
      `parserRevision must be >= 1, got ${session.parserRevision}`,
    );
  }
  if (session.schemaVersion < 1) {
    errors.push(
      `schemaVersion must be >= 1, got ${session.schemaVersion}`,
    );
  }
  if (!isValidISOTimestamp(session.startedAt)) {
    errors.push(`Invalid startedAt: "${session.startedAt}"`);
  }
  if (!isValidISOTimestamp(session.lastMessageAt)) {
    errors.push(`Invalid lastMessageAt: "${session.lastMessageAt}"`);
  }
  if (!isValidISOTimestamp(session.snapshotAt)) {
    errors.push(`Invalid snapshotAt: "${session.snapshotAt}"`);
  }
  if (session.durationSeconds < 0) {
    errors.push(
      `Negative durationSeconds: ${session.durationSeconds}`,
    );
  }
  if (session.messages.length === 0) {
    errors.push("messages array must not be empty");
  }
  if (session.totalInputTokens < 0) {
    errors.push(
      `Negative totalInputTokens: ${session.totalInputTokens}`,
    );
  }
  if (session.totalOutputTokens < 0) {
    errors.push(
      `Negative totalOutputTokens: ${session.totalOutputTokens}`,
    );
  }
  if (session.totalCachedTokens < 0) {
    errors.push(
      `Negative totalCachedTokens: ${session.totalCachedTokens}`,
    );
  }

  // Validate nested messages
  for (let i = 0; i < session.messages.length; i++) {
    const msgErrors = validateCanonicalMessage(session.messages[i]);
    for (const err of msgErrors) {
      errors.push(`messages[${i}]: ${err}`);
    }
  }

  return errors;
}

export function validateSessionSnapshot(snapshot: SessionSnapshot): string[] {
  const errors: string[] = [];

  if (!isValidSessionKey(snapshot.sessionKey)) {
    errors.push(`Invalid sessionKey: "${snapshot.sessionKey}"`);
  }
  if (!isValidSource(snapshot.source)) {
    errors.push(`Invalid source: "${snapshot.source}"`);
  }
  if (!isValidISOTimestamp(snapshot.startedAt)) {
    errors.push(`Invalid startedAt: "${snapshot.startedAt}"`);
  }
  if (!isValidISOTimestamp(snapshot.lastMessageAt)) {
    errors.push(`Invalid lastMessageAt: "${snapshot.lastMessageAt}"`);
  }
  if (!isValidISOTimestamp(snapshot.snapshotAt)) {
    errors.push(`Invalid snapshotAt: "${snapshot.snapshotAt}"`);
  }
  if (snapshot.durationSeconds < 0) {
    errors.push(
      `Negative durationSeconds: ${snapshot.durationSeconds}`,
    );
  }
  if (snapshot.userMessages < 0) {
    errors.push(`Negative userMessages: ${snapshot.userMessages}`);
  }
  if (snapshot.assistantMessages < 0) {
    errors.push(
      `Negative assistantMessages: ${snapshot.assistantMessages}`,
    );
  }
  if (snapshot.totalMessages < 0) {
    errors.push(`Negative totalMessages: ${snapshot.totalMessages}`);
  }
  if (snapshot.totalInputTokens < 0) {
    errors.push(
      `Negative totalInputTokens: ${snapshot.totalInputTokens}`,
    );
  }
  if (snapshot.totalOutputTokens < 0) {
    errors.push(
      `Negative totalOutputTokens: ${snapshot.totalOutputTokens}`,
    );
  }
  if (snapshot.totalCachedTokens < 0) {
    errors.push(
      `Negative totalCachedTokens: ${snapshot.totalCachedTokens}`,
    );
  }
  if (!snapshot.contentHash) {
    errors.push("Missing contentHash");
  }
  if (!snapshot.rawHash) {
    errors.push("Missing rawHash");
  }
  if (snapshot.parserRevision < 1) {
    errors.push(
      `parserRevision must be >= 1, got ${snapshot.parserRevision}`,
    );
  }
  if (snapshot.schemaVersion < 1) {
    errors.push(
      `schemaVersion must be >= 1, got ${snapshot.schemaVersion}`,
    );
  }

  return errors;
}

export function validateParseError(error: ParseError): string[] {
  const errors: string[] = [];

  if (!isValidISOTimestamp(error.timestamp)) {
    errors.push(`Invalid timestamp: "${error.timestamp}"`);
  }
  if (!isValidSource(error.source)) {
    errors.push(`Invalid source: "${error.source}"`);
  }
  if (!error.filePath) {
    errors.push("Missing filePath");
  }
  if (!error.error) {
    errors.push("Missing error message");
  }

  return errors;
}
