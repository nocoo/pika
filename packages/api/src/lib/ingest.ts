/**
 * Ingest helpers shared by /ingest/* routes.
 *
 * Mirror of the previous web/lib/ingest logic, lifted into the api package
 * so the api server owns the ingest pipeline. The old web/lib/ingest
 * remains until P5 deletes the web wrappers.
 */

export interface ProxyConfig {
  workerUrl: string;
  workerSecret: string;
}

export interface ProxyResult {
  status: number;
  body: string;
}

export async function proxyToWorker(
  config: ProxyConfig,
  opts: {
    method: string;
    path: string;
    userId: string;
    body: ReadableStream<Uint8Array> | ArrayBuffer | string | null;
    contentType?: string;
    extraHeaders?: Record<string, string>;
  },
  fetchFn: typeof fetch = fetch,
): Promise<ProxyResult> {
  const url = `${config.workerUrl}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.workerSecret}`,
    "X-User-Id": opts.userId,
  };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) headers[k] = v;
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

  return { status: response.status, body: await response.text() };
}

export function getProxyConfig(): ProxyConfig {
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;
  if (!workerUrl) throw new Error("WORKER_URL is required");
  if (!workerSecret) throw new Error("WORKER_SECRET is required");
  return { workerUrl, workerSecret };
}

// ── Content path parsing ───────────────────────────────────────

export function parseContentPath(
  pathSegments: string[],
): { workerPath: string } | { error: string } {
  if (pathSegments.length < 2) {
    return { error: "Invalid content path: expected /{sessionKey}/{type}" };
  }
  const type = pathSegments[pathSegments.length - 1];
  if (type !== "canonical" && type !== "raw") {
    return {
      error: `Invalid content type: ${type}. Expected "canonical" or "raw"`,
    };
  }
  const sessionKey = pathSegments.slice(0, -1).join("/");
  return { workerPath: `/ingest/content/${sessionKey}/${type}` };
}

// ── Presign request validation ─────────────────────────────────

export interface PresignValidationOk {
  valid: true;
  sessionKey: string;
  rawHash: string;
}
export interface PresignValidationErr {
  valid: false;
  error: string;
}

export function validatePresignRequest(
  body: unknown,
): PresignValidationOk | PresignValidationErr {
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
    return {
      valid: false,
      error: "rawHash must be a hex string (8-128 chars)",
    };
  }
  return { valid: true, sessionKey: obj.sessionKey, rawHash: obj.rawHash };
}

// ── Confirm-raw request validation ─────────────────────────────

export interface ConfirmRawValidationOk {
  valid: true;
  sessionKey: string;
  rawHash: string;
  rawSize: number;
}
export interface ConfirmRawValidationErr {
  valid: false;
  error: string;
}

export function validateConfirmRawRequest(
  body: unknown,
): ConfirmRawValidationOk | ConfirmRawValidationErr {
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
    return {
      valid: false,
      error: "rawHash must be a hex string (8-128 chars)",
    };
  }
  if (
    typeof obj.rawSize !== "number" ||
    obj.rawSize <= 0 ||
    !Number.isInteger(obj.rawSize)
  ) {
    return { valid: false, error: "rawSize (positive integer) is required" };
  }
  return {
    valid: true,
    sessionKey: obj.sessionKey,
    rawHash: obj.rawHash,
    rawSize: obj.rawSize,
  };
}

// ── R2 key builder ─────────────────────────────────────────────

export function buildRawR2Key(
  userId: string,
  sessionKey: string,
  rawHash: string,
): string {
  return `${userId}/${sessionKey}/raw/${rawHash}.json.gz`;
}
