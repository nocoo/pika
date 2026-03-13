/**
 * Health-check logic for /api/live.
 *
 * Extracted from the route handler for testability.
 * Checks D1 connectivity with a lightweight `SELECT 1` query.
 *
 * Contract:
 * - Success: `{ status: "ok", version, d1: { latencyMs } }`
 * - Failure: `{ status: "error", version, d1: { error } }`
 *   (MUST NOT contain the word "ok" anywhere in error responses)
 */

import type { D1Client } from "./d1";
import { APP_VERSION } from "./version";

// ── Types ──────────────────────────────────────────────────────

export interface LiveOk {
  status: "ok";
  version: string;
  uptime: number;
  timestamp: string;
  d1: { latencyMs: number };
}

export interface LiveError {
  status: "error";
  version: string;
  uptime: number;
  timestamp: string;
  d1: { error: string };
}

export type LiveResult = LiveOk | LiveError;

// ── Logic ──────────────────────────────────────────────────────

/**
 * Run the health check against D1.
 *
 * @param db - D1Client instance (injected for testability)
 * @returns LiveResult with status and diagnostics
 */
export async function checkHealth(db: D1Client): Promise<LiveResult> {
  const start = Date.now();

  try {
    await db.query("SELECT 1");
    const latencyMs = Date.now() - start;

    return {
      status: "ok",
      version: APP_VERSION,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      d1: { latencyMs },
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Sanitize "ok" from error messages to prevent keyword-based monitor false positives
    const message = raw.replace(/\bok\b/gi, "***");

    return {
      status: "error",
      version: APP_VERSION,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      d1: { error: message },
    };
  }
}
