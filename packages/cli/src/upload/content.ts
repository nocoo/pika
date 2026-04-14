/**
 * Content upload — gzip compress and upload canonical + raw session content.
 *
 * Each session has two content uploads:
 * 1. PUT /api/ingest/content/{sessionKey}/canonical
 *    Headers: Content-Encoding: gzip, X-Content-Hash, X-Parser-Revision, X-Schema-Version
 *    Body: gzip-compressed canonical JSON
 *
 * 2. Raw content: two strategies:
 *    a. Presigned URL (default): POST /api/ingest/presign → PUT directly to R2 → POST /api/ingest/confirm-raw
 *    b. Proxy fallback: PUT /api/ingest/content/{sessionKey}/raw (through Next.js → Worker)
 *
 * Same retry strategy as metadata upload.
 */

import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { CanonicalSession, RawSessionArchive } from "@pika/core";
import {
  CONTENT_UPLOAD_CONCURRENCY,
  INITIAL_BACKOFF_MS,
  MAX_UPLOAD_RETRIES,
} from "@pika/core";
import type { PrecomputedHashes } from "./engine";
import {
  AuthError,
  ClientError,
  parseRetryAfter,
  RetryExhaustedError,
  sha256,
} from "./engine";

const gzipAsync = promisify(gzip);

// ── Constants ─────────────────────────────────────────────────

/** Per-request timeout for content uploads (60s — Workers have 30s wall time) */
const FETCH_TIMEOUT_MS = 60_000;

// ── Types ──────────────────────────────────────────────────────

export interface ContentUploadOptions {
  apiUrl: string;
  apiKey: string;
  /** Override fetch for testing */
  fetch?: typeof globalThis.fetch;
  /** Override sleep for testing */
  sleep?: (ms: number) => Promise<void>;
}

export interface ContentUploadResult {
  /** Whether the canonical content was uploaded (false if server returned no-op) */
  canonicalUploaded: boolean;
  /** Whether the raw content was uploaded (false if server returned no-op) */
  rawUploaded: boolean;
  /** Content hash of canonical JSON */
  contentHash: string;
  /** Raw hash of raw JSON */
  rawHash: string;
}

// ── Gzip helper ────────────────────────────────────────────────

/** Gzip compress a string, returning a Buffer (async, non-blocking) */
export async function gzipCompress(input: string): Promise<Buffer> {
  return gzipAsync(Buffer.from(input, "utf-8")) as Promise<Buffer>;
}

// ── Sleep helper ───────────────────────────────────────────────

/* v8 ignore start */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/* v8 ignore stop */

// ── Single PUT with retry ──────────────────────────────────────

/**
 * PUT a gzip-compressed body to a URL with retry logic.
 * Returns the response status and whether the upload was performed.
 *
 * Status semantics:
 * - 200/201: uploaded successfully
 * - 204: no-op (content unchanged, hashes match)
 * - 401: auth error
 * - 409: version conflict (older revision)
 * - 429: rate limited
 * - 5xx: server error, retryable
 */
async function putWithRetry(
  url: string,
  body: Buffer,
  headers: Record<string, string>,
  opts: ContentUploadOptions,
): Promise<{ uploaded: boolean }> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const sleepFn = opts.sleep ?? defaultSleep;

  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "gzip",
          Authorization: `Bearer ${opts.apiKey}`,
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (_err) {
      // Timeout or network error — retry with backoff
      if (attempt < MAX_UPLOAD_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * 2 ** attempt;
        await sleepFn(backoff);
        continue;
      }
      throw new RetryExhaustedError(0, MAX_UPLOAD_RETRIES + 1);
    }

    lastStatus = response.status;

    // 200/201 — uploaded successfully
    if (response.status === 200 || response.status === 201) {
      return { uploaded: true };
    }

    // 204 — no-op (content unchanged)
    if (response.status === 204) {
      return { uploaded: false };
    }

    // 401 — auth failure
    if (response.status === 401) {
      throw new AuthError();
    }

    // 409 — version conflict, treat as non-retryable error
    if (response.status === 409) {
      const text = await response.text();
      throw new ClientError(409, text);
    }

    // 429 — rate limited
    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      await sleepFn(retryAfter);
      continue;
    }

    // 4xx — client error, fail immediately
    if (response.status >= 400 && response.status < 500) {
      const text = await response.text();
      throw new ClientError(response.status, text);
    }

    // 5xx — retry with exponential backoff
    if (response.status >= 500) {
      if (attempt < MAX_UPLOAD_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * 2 ** attempt;
        await sleepFn(backoff);
      }
    }
  }

  throw new RetryExhaustedError(lastStatus, MAX_UPLOAD_RETRIES + 1);
}

// ── Presigned URL direct upload ────────────────────────────────

export interface PresignResponse {
  url: string;
  key: string;
}

/**
 * Request a presigned PUT URL from the API for direct-to-R2 raw upload.
 * POST /api/ingest/presign with { sessionKey, rawHash }.
 */
export async function requestPresignedUrl(
  sessionKey: string,
  rawHash: string,
  opts: ContentUploadOptions,
): Promise<PresignResponse> {
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const response = await fetchFn(`${opts.apiUrl}/api/ingest/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ sessionKey, rawHash }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status === 401) throw new AuthError();

  if (!response.ok) {
    const text = await response.text();
    throw new ClientError(response.status, text);
  }

  const data = (await response.json()) as PresignResponse;
  if (!data.url || !data.key) {
    throw new ClientError(
      response.status,
      "Invalid presign response: missing url or key",
    );
  }

  return data;
}

/**
 * Upload raw content directly to R2 via presigned PUT URL.
 * The presigned URL is pre-authorized — no Bearer token needed.
 */
export async function uploadToPresignedUrl(
  presignedUrl: string,
  body: Buffer,
  opts: ContentUploadOptions,
): Promise<void> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const sleepFn = opts.sleep ?? defaultSleep;

  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchFn(presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/gzip",
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (_err) {
      // Timeout or network error — retry with backoff
      if (attempt < MAX_UPLOAD_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * 2 ** attempt;
        await sleepFn(backoff);
        continue;
      }
      throw new RetryExhaustedError(0, MAX_UPLOAD_RETRIES + 1);
    }

    lastStatus = response.status;

    // 200/201 — uploaded successfully
    if (response.status === 200 || response.status === 201) {
      return;
    }

    // 5xx — retry with exponential backoff
    if (response.status >= 500) {
      if (attempt < MAX_UPLOAD_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * 2 ** attempt;
        await sleepFn(backoff);
        continue;
      }
    }

    // 4xx — non-retryable
    if (response.status >= 400 && response.status < 500) {
      const text = await response.text();
      throw new ClientError(response.status, text);
    }
  }

  throw new RetryExhaustedError(lastStatus, MAX_UPLOAD_RETRIES + 1);
}

/**
 * Confirm a direct-to-R2 raw upload by updating D1 metadata.
 * POST /api/ingest/confirm-raw with { sessionKey, rawHash, rawSize }.
 */
export async function confirmRawUpload(
  sessionKey: string,
  rawHash: string,
  rawSize: number,
  opts: ContentUploadOptions,
): Promise<void> {
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const response = await fetchFn(`${opts.apiUrl}/api/ingest/confirm-raw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ sessionKey, rawHash, rawSize }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status === 401) throw new AuthError();

  if (!response.ok) {
    const text = await response.text();
    throw new ClientError(response.status, text);
  }
}

/**
 * Upload raw content via presigned URL flow:
 * 1. Request presigned PUT URL
 * 2. PUT gzip body directly to R2
 * 3. Confirm upload (update D1 metadata)
 *
 * Returns true if uploaded, false if presign is not available (caller should fall back).
 */
export async function uploadRawDirect(
  sessionKey: string,
  rawHash: string,
  rawGzip: Buffer,
  opts: ContentUploadOptions,
): Promise<boolean> {
  // 1. Request presigned URL
  const presign = await requestPresignedUrl(sessionKey, rawHash, opts);

  // 2. Upload directly to R2
  await uploadToPresignedUrl(presign.url, rawGzip, opts);

  // 3. Confirm upload (update D1 metadata)
  await confirmRawUpload(sessionKey, rawHash, rawGzip.length, opts);

  return true;
}

// ── Upload session content ─────────────────────────────────────

/**
 * Upload canonical + raw content for a single session.
 *
 * 1. Serialize to JSON and compute hashes
 * 2. Gzip compress both payloads
 * 3. PUT canonical via proxy (Worker needs to process + insert D1 chunks)
 * 4. Upload raw via presigned URL (direct to R2, bypasses proxy)
 *    Falls back to proxy if presigned URL fails with non-auth error
 *
 * Returns hashes and upload status for each.
 */
export async function uploadSessionContent(
  canonical: CanonicalSession,
  raw: RawSessionArchive,
  opts: ContentUploadOptions,
  precomputed?: PrecomputedHashes,
): Promise<ContentUploadResult> {
  const canonicalJson = precomputed?.canonicalJson ?? JSON.stringify(canonical);
  const rawJson = precomputed?.rawJson ?? JSON.stringify(raw);

  const contentHash = precomputed?.contentHash ?? sha256(canonicalJson);
  const rawHash = precomputed?.rawHash ?? sha256(rawJson);

  // Compress both payloads in parallel (async, non-blocking)
  const [canonicalGzip, rawGzip] = await Promise.all([
    gzipCompress(canonicalJson),
    gzipCompress(rawJson),
  ]);

  const sessionKey = encodeURIComponent(canonical.sessionKey);

  // Upload canonical and raw in parallel — they have no dependency on each other
  const canonicalPromise = putWithRetry(
    `${opts.apiUrl}/api/ingest/content/${sessionKey}/canonical`,
    canonicalGzip,
    {
      "X-Content-Hash": contentHash,
      "X-Parser-Revision": String(canonical.parserRevision),
      "X-Schema-Version": String(canonical.schemaVersion),
    },
    opts,
  );

  const rawPromise = (async () => {
    try {
      return await uploadRawDirect(
        canonical.sessionKey,
        rawHash,
        rawGzip,
        opts,
      );
    } catch (err) {
      if (err instanceof AuthError) throw err;
      // Fall back to proxy for any other error
      const rawResult = await putWithRetry(
        `${opts.apiUrl}/api/ingest/content/${sessionKey}/raw`,
        rawGzip,
        { "X-Raw-Hash": rawHash },
        opts,
      );
      return rawResult.uploaded;
    }
  })();

  const [canonicalResult, rawUploaded] = await Promise.all([
    canonicalPromise,
    rawPromise,
  ]);

  return {
    canonicalUploaded: canonicalResult.uploaded,
    rawUploaded,
    contentHash,
    rawHash,
  };
}

// ── Batch content upload ───────────────────────────────────────

export interface BatchContentUploadResult {
  uploaded: number;
  skipped: number;
  errors: Array<{ sessionKey: string; error: string }>;
}

/**
 * Upload content for multiple sessions.
 * Uses a concurrency pool (default 8) to upload sessions in parallel.
 * Continues on error for individual sessions (collects errors).
 * AuthError propagates immediately and aborts all inflight work.
 */
export async function uploadContentBatch(
  sessions: Array<{
    canonical: CanonicalSession;
    raw: RawSessionArchive;
    precomputed?: PrecomputedHashes;
  }>,
  opts: ContentUploadOptions,
  concurrency: number = CONTENT_UPLOAD_CONCURRENCY,
): Promise<BatchContentUploadResult> {
  const result: BatchContentUploadResult = {
    uploaded: 0,
    skipped: 0,
    errors: [],
  };

  if (sessions.length === 0) return result;

  // Simple concurrency pool using a shared index counter
  let nextIndex = 0;
  let authError: AuthError | null = null;

  async function worker(): Promise<void> {
    while (!authError) {
      const idx = nextIndex++;
      if (idx >= sessions.length) break;

      const { canonical, raw, precomputed } = sessions[idx];
      try {
        const contentResult = await uploadSessionContent(
          canonical,
          raw,
          opts,
          precomputed,
        );
        if (contentResult.canonicalUploaded || contentResult.rawUploaded) {
          result.uploaded++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        if (err instanceof AuthError) {
          authError = err;
          return;
        }
        result.errors.push({
          sessionKey: canonical.sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, sessions.length) },
    () => worker(),
  );
  await Promise.all(workers);

  if (authError) throw authError;

  return result;
}
