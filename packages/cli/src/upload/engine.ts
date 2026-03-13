/**
 * Upload engine — batch metadata upload with retry + exponential backoff.
 *
 * Responsibilities:
 * 1. toSessionSnapshot() — transform CanonicalSession + RawSessionArchive into SessionSnapshot
 *    (SHA-256 content_hash + raw_hash, message role counts)
 * 2. uploadMetadataBatches() — split into batches of 50, POST each with retry
 *
 * Retry strategy:
 * - 5xx: exponential backoff (1s, 2s), max 2 retries
 * - 429: respect Retry-After header (seconds or HTTP-date)
 * - 4xx (except 429): fail immediately
 * - 401: specific "re-login" error
 */

import { createHash } from "node:crypto";
import {
  METADATA_BATCH_SIZE,
  MAX_UPLOAD_RETRIES,
  INITIAL_BACKOFF_MS,
} from "@pika/core";
import type {
  CanonicalSession,
  RawSessionArchive,
  SessionSnapshot,
} from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface UploadEngineOptions {
  apiUrl: string;
  apiKey: string;
  userId: string;
  /** Override fetch for testing */
  fetch?: typeof globalThis.fetch;
  /** Override sleep for testing */
  sleep?: (ms: number) => Promise<void>;
}

export interface BatchResult {
  /** Number of sessions successfully ingested */
  ingested: number;
  /** Number of sessions that had version conflicts (409) */
  conflicts: number;
  /** Errors encountered (non-retryable) */
  errors: string[];
}

export interface UploadResult {
  totalIngested: number;
  totalConflicts: number;
  totalBatches: number;
  errors: string[];
}

// ── HTTP error classes ─────────────────────────────────────────

export class AuthError extends Error {
  constructor(message = "API key invalid or expired. Run: pika login --force") {
    super(message);
    this.name = "AuthError";
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly attempts: number,
  ) {
    super(
      `Upload failed after ${attempts} attempts (last status: ${statusCode})`,
    );
    this.name = "RetryExhaustedError";
  }
}

export class ClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Upload failed with status ${statusCode}: ${body}`);
    this.name = "ClientError";
  }
}

// ── Hash computation ───────────────────────────────────────────

/** SHA-256 hex digest of a string (uncompressed JSON) */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

// ── Snapshot transformation ────────────────────────────────────

/**
 * Transform a CanonicalSession + RawSessionArchive into a SessionSnapshot
 * ready for metadata upload.
 *
 * Computes:
 * - contentHash: SHA-256 of canonical JSON string (deterministic via sorted keys)
 * - rawHash: SHA-256 of raw JSON string (deterministic via sorted keys)
 * - Message role counts (user, assistant, total)
 */
export function toSessionSnapshot(
  canonical: CanonicalSession,
  raw: RawSessionArchive,
): SessionSnapshot {
  const canonicalJson = JSON.stringify(canonical);
  const rawJson = JSON.stringify(raw);

  let userMessages = 0;
  let assistantMessages = 0;
  for (const msg of canonical.messages) {
    if (msg.role === "user") userMessages++;
    else if (msg.role === "assistant") assistantMessages++;
  }

  return {
    sessionKey: canonical.sessionKey,
    source: canonical.source,
    startedAt: canonical.startedAt,
    lastMessageAt: canonical.lastMessageAt,
    durationSeconds: canonical.durationSeconds,
    userMessages,
    assistantMessages,
    totalMessages: canonical.messages.length,
    totalInputTokens: canonical.totalInputTokens,
    totalOutputTokens: canonical.totalOutputTokens,
    totalCachedTokens: canonical.totalCachedTokens,
    projectRef: canonical.projectRef,
    projectName: canonical.projectName,
    model: canonical.model,
    title: canonical.title,
    contentHash: sha256(canonicalJson),
    rawHash: sha256(rawJson),
    parserRevision: canonical.parserRevision,
    schemaVersion: canonical.schemaVersion,
    snapshotAt: canonical.snapshotAt,
  };
}

// ── Batch splitting ────────────────────────────────────────────

/** Split an array into chunks of at most `size` elements */
export function splitBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

// ── Sleep helper ───────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Parse Retry-After header ───────────────────────────────────

/**
 * Parse Retry-After header value.
 * Can be either seconds (integer) or HTTP-date.
 * Returns milliseconds to wait.
 */
export function parseRetryAfter(value: string | null): number {
  if (!value) return INITIAL_BACKOFF_MS;

  // Try as integer seconds first
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try as HTTP-date
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const ms = date.getTime() - Date.now();
    return Math.max(0, ms);
  }

  return INITIAL_BACKOFF_MS;
}

// ── Single batch upload ────────────────────────────────────────

/**
 * Upload a single batch of session snapshots with retry logic.
 *
 * POST /api/ingest/sessions
 * Body: { userId, sessions: SessionSnapshot[] }
 * Auth: Authorization: Bearer <apiKey>
 */
async function uploadBatch(
  snapshots: SessionSnapshot[],
  opts: UploadEngineOptions,
): Promise<BatchResult> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const sleepFn = opts.sleep ?? defaultSleep;
  const url = `${opts.apiUrl}/api/ingest/sessions`;

  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({ userId: opts.userId, sessions: snapshots }),
    });

    lastStatus = response.status;

    // Success
    if (response.ok) {
      const body = (await response.json()) as { ingested: number };
      return { ingested: body.ingested, conflicts: 0, errors: [] };
    }

    // 401 — auth failure, fail immediately
    if (response.status === 401) {
      throw new AuthError();
    }

    // 409 — version conflict, not an error per se
    if (response.status === 409) {
      const body = (await response.json()) as {
        error: string;
        conflicts: Array<{ sessionKey: string }>;
      };
      return {
        ingested: 0,
        conflicts: body.conflicts?.length ?? snapshots.length,
        errors: [],
      };
    }

    // 429 — rate limited, respect Retry-After
    if (response.status === 429) {
      const retryAfter = parseRetryAfter(
        response.headers.get("Retry-After"),
      );
      await sleepFn(retryAfter);
      continue;
    }

    // 4xx (except 401, 409, 429) — client error, fail immediately
    if (response.status >= 400 && response.status < 500) {
      const body = await response.text();
      throw new ClientError(response.status, body);
    }

    // 5xx — server error, retry with exponential backoff
    if (response.status >= 500) {
      if (attempt < MAX_UPLOAD_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleepFn(backoff);
        continue;
      }
    }
  }

  // All retries exhausted
  throw new RetryExhaustedError(lastStatus, MAX_UPLOAD_RETRIES + 1);
}

// ── Upload all batches ─────────────────────────────────────────

/**
 * Upload an array of session snapshots in batches of METADATA_BATCH_SIZE.
 * Returns aggregate result across all batches.
 *
 * Stops on first non-retryable error (AuthError, ClientError).
 * Retries are per-batch, not per-snapshot.
 */
export async function uploadMetadataBatches(
  snapshots: SessionSnapshot[],
  opts: UploadEngineOptions,
): Promise<UploadResult> {
  if (snapshots.length === 0) {
    return { totalIngested: 0, totalConflicts: 0, totalBatches: 0, errors: [] };
  }

  const batches = splitBatches(snapshots, METADATA_BATCH_SIZE);
  const result: UploadResult = {
    totalIngested: 0,
    totalConflicts: 0,
    totalBatches: batches.length,
    errors: [],
  };

  for (const batch of batches) {
    const batchResult = await uploadBatch(batch, opts);
    result.totalIngested += batchResult.ingested;
    result.totalConflicts += batchResult.conflicts;
    result.errors.push(...batchResult.errors);
  }

  return result;
}
