/**
 * Ingest proxy logic.
 *
 * Pure functions for proxying CLI uploads to the Cloudflare Worker.
 * The Next.js API authenticates the user, then forwards the request
 * with a shared secret and X-User-Id header.
 */

// ── Types ──────────────────────────────────────────────────────

export interface ProxyConfig {
  workerUrl: string;
  workerSecret: string;
}

export interface ProxyResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

// ── Proxy functions ────────────────────────────────────────────

/**
 * Proxy a request to the Cloudflare Worker.
 *
 * - Adds `Authorization: Bearer {WORKER_SECRET}` header
 * - Adds `X-User-Id` header with authenticated user ID
 * - Forwards method, body, and Content-Type
 */
export async function proxyToWorker(
  config: ProxyConfig,
  opts: {
    method: string;
    path: string;
    userId: string;
    body: ReadableStream<Uint8Array> | ArrayBuffer | string | null;
    contentType?: string;
    /** Extra headers to forward to the worker (e.g. X-Content-Hash) */
    extraHeaders?: Record<string, string>;
  },
  fetchFn: typeof fetch = fetch,
): Promise<ProxyResult> {
  const url = `${config.workerUrl}${opts.path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.workerSecret}`,
    "X-User-Id": opts.userId,
  };

  if (opts.contentType) {
    headers["Content-Type"] = opts.contentType;
  }

  // Forward custom headers from the original request
  if (opts.extraHeaders) {
    for (const [key, value] of Object.entries(opts.extraHeaders)) {
      headers[key] = value;
    }
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: opts.method,
      headers,
      body: opts.body,
      // @ts-expect-error — Node/Bun fetch supports duplex for streaming
      duplex: opts.body instanceof ReadableStream ? "half" : undefined,
    });
  } catch (err) {
    return {
      status: 502,
      body: JSON.stringify({
        error: `Worker proxy error: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }

  const responseBody = await response.text();
  return {
    status: response.status,
    body: responseBody,
  };
}

// ── Config from env ────────────────────────────────────────────

export function getProxyConfig(): ProxyConfig {
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerUrl) throw new Error("WORKER_URL is required");
  if (!workerSecret) throw new Error("WORKER_SECRET is required");

  return { workerUrl, workerSecret };
}

// ── Content path parsing ───────────────────────────────────────

/**
 * Parse a content ingest path.
 * Expected format: `/api/ingest/content/{sessionKey}/{type}`
 * where type is "canonical" or "raw".
 *
 * Returns the worker path to forward to.
 */
export function parseContentPath(
  pathSegments: string[],
): { workerPath: string } | { error: string } {
  // pathSegments from [...path] catch-all: e.g. ["claude:abc123", "canonical"]
  if (pathSegments.length < 2) {
    return { error: "Invalid content path: expected /{sessionKey}/{type}" };
  }

  const type = pathSegments[pathSegments.length - 1];
  if (type !== "canonical" && type !== "raw") {
    return { error: `Invalid content type: ${type}. Expected "canonical" or "raw"` };
  }

  const sessionKey = pathSegments.slice(0, -1).join("/");
  return { workerPath: `/ingest/content/${sessionKey}/${type}` };
}

// ── Presign request validation ─────────────────────────────────

export interface PresignRequest {
  sessionKey: string;
  rawHash: string;
}

export interface PresignValidationResult {
  valid: true;
  sessionKey: string;
  rawHash: string;
}

export interface PresignValidationError {
  valid: false;
  error: string;
}

/**
 * Validate a presign request body.
 * Requires sessionKey (non-empty string) and rawHash (non-empty hex string).
 */
export function validatePresignRequest(
  body: unknown,
): PresignValidationResult | PresignValidationError {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.sessionKey !== "string" || !obj.sessionKey) {
    return { valid: false, error: "sessionKey (non-empty string) is required" };
  }

  if (typeof obj.rawHash !== "string" || !obj.rawHash) {
    return { valid: false, error: "rawHash (non-empty string) is required" };
  }

  // Validate rawHash looks like a hex string
  if (!/^[0-9a-f]{8,128}$/i.test(obj.rawHash)) {
    return { valid: false, error: "rawHash must be a hex string (8-128 chars)" };
  }

  return { valid: true, sessionKey: obj.sessionKey, rawHash: obj.rawHash };
}

// ── Confirm raw upload request validation ──────────────────────

export interface ConfirmRawRequest {
  sessionKey: string;
  rawHash: string;
  rawSize: number;
}

export interface ConfirmRawValidationResult {
  valid: true;
  sessionKey: string;
  rawHash: string;
  rawSize: number;
}

export interface ConfirmRawValidationError {
  valid: false;
  error: string;
}

/**
 * Validate a confirm-raw request body.
 * Requires sessionKey, rawHash (hex), and rawSize (positive integer).
 */
export function validateConfirmRawRequest(
  body: unknown,
): ConfirmRawValidationResult | ConfirmRawValidationError {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.sessionKey !== "string" || !obj.sessionKey) {
    return { valid: false, error: "sessionKey (non-empty string) is required" };
  }

  if (typeof obj.rawHash !== "string" || !obj.rawHash) {
    return { valid: false, error: "rawHash (non-empty string) is required" };
  }

  if (!/^[0-9a-f]{8,128}$/i.test(obj.rawHash)) {
    return { valid: false, error: "rawHash must be a hex string (8-128 chars)" };
  }

  if (typeof obj.rawSize !== "number" || obj.rawSize <= 0 || !Number.isInteger(obj.rawSize)) {
    return { valid: false, error: "rawSize (positive integer) is required" };
  }

  return {
    valid: true,
    sessionKey: obj.sessionKey,
    rawHash: obj.rawHash,
    rawSize: obj.rawSize,
  };
}

// ── Confirm raw upload D1 update ───────────────────────────────

export interface ConfirmRawUpdateParams {
  userId: string;
  sessionKey: string;
  rawHash: string;
  rawSize: number;
}

/**
 * Build the R2 key for a raw session archive.
 * Key pattern: `{userId}/{sessionKey}/raw/{rawHash}.json.gz`
 */
export function buildRawR2Key(userId: string, sessionKey: string, rawHash: string): string {
  return `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;
}

/**
 * Verify that a raw upload exists in R2 before updating D1 metadata.
 * Prevents D1 from pointing to a non-existent R2 object.
 *
 * @param r2 - Object with a headObject method (R2Client or test double)
 * @param r2Key - Full R2 object key to check
 * @returns true if the object exists
 */
export async function verifyR2RawExists(
  r2: { headObject(key: string): Promise<boolean> },
  r2Key: string,
): Promise<boolean> {
  return r2.headObject(r2Key);
}

/**
 * Build the D1 SQL update for confirming a direct-to-R2 raw upload.
 * Updates raw_key, raw_size, raw_hash, and updated_at.
 * Only updates if the session belongs to the user.
 */
export function buildConfirmRawUpdate(params: ConfirmRawUpdateParams): {
  sql: string;
  params: unknown[];
} {
  const r2Key = buildRawR2Key(params.userId, params.sessionKey, params.rawHash);

  return {
    sql: `UPDATE sessions
      SET raw_key = ?, raw_size = ?, raw_hash = ?, updated_at = datetime('now')
      WHERE user_id = ? AND session_key = ?`,
    params: [r2Key, params.rawSize, params.rawHash, params.userId, params.sessionKey],
  };
}
