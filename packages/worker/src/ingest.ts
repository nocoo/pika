import { validateSessionSnapshot } from "@pika/core";
import type { SessionSnapshot } from "@pika/core";
import { METADATA_BATCH_SIZE } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface IngestSessionPayload {
  userId: string;
  sessions: SessionSnapshot[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Auth ───────────────────────────────────────────────────────

export function validateWorkerAuth(
  headers: Headers,
  expectedSecret: string,
): boolean {
  const secret = headers.get("x-worker-secret");
  if (!secret) return false;
  return secret === expectedSecret;
}

// ── Request validation ─────────────────────────────────────────

export function validateIngestRequest(
  payload: IngestSessionPayload,
): ValidationResult {
  const errors: string[] = [];

  if (!payload.userId) {
    errors.push("Missing userId");
  }

  if (!payload.sessions || payload.sessions.length === 0) {
    errors.push("sessions array must not be empty");
  }

  if (payload.sessions && payload.sessions.length > METADATA_BATCH_SIZE) {
    errors.push(
      `sessions batch size exceeds maximum of ${METADATA_BATCH_SIZE} (got ${payload.sessions.length})`,
    );
  }

  // Validate each session snapshot
  if (payload.sessions) {
    for (let i = 0; i < payload.sessions.length; i++) {
      const sessionErrors = validateSessionSnapshot(payload.sessions[i]);
      for (const err of sessionErrors) {
        errors.push(`sessions[${i}]: ${err}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
