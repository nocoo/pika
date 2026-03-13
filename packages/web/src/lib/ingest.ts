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
