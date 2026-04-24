/**
 * Worker proxy helpers for Hono routes.
 *
 * Each handler:
 *  - reads the authenticated `userId` from the request (set by the auth
 *    middleware via `c.set("userId", ...)`).
 *  - forwards the call to the Worker via `WorkerClient`.
 *  - converts `WorkerError` into the same JSON error envelope web used.
 *
 * The WorkerClient is supplied via Hono context (`c.get("workerClient")`)
 * so tests can inject a stub client without touching `process.env`.
 */

import {
  WorkerClient,
  type WorkerClientConfig,
  WorkerError,
} from "@pika/core/infra/worker-client";
import type { Context, Handler } from "hono";

export type WorkerProxyVariables = {
  workerClient: WorkerClient;
};

let _client: WorkerClient | null = null;

/** Read WORKER_URL/WORKER_SECRET from process.env and cache the client. */
export function getDefaultWorkerClient(): WorkerClient {
  if (_client) return _client;
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;
  if (!workerUrl) throw new Error("WORKER_URL is required");
  if (!workerSecret) throw new Error("WORKER_SECRET is required");
  const config: WorkerClientConfig = { workerUrl, workerSecret };
  _client = new WorkerClient(config);
  return _client;
}

/** Reset the cached default client (test-only). */
export function resetDefaultWorkerClient(): void {
  _client = null;
}

/**
 * Resolve the WorkerClient for a request. Prefers the one stashed on the
 * context (test injection); falls back to the env-driven default.
 */
function resolveClient(c: Context): WorkerClient {
  const fromCtx = c.get("workerClient" as never) as WorkerClient | undefined;
  return fromCtx ?? getDefaultWorkerClient();
}

function userIdOf(c: Context): string {
  return c.get("userId" as never) as string;
}

function paramsOf(c: Context): Record<string, string> {
  const params: Record<string, string> = {};
  const url = new URL(c.req.url);
  for (const [k, v] of url.searchParams.entries()) {
    params[k] = v;
  }
  return params;
}

async function readJsonBody(c: Context): Promise<unknown | "invalid"> {
  try {
    return await c.req.json();
  } catch {
    return "invalid";
  }
}

function workerErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof WorkerError) {
    try {
      const parsed = JSON.parse(err.message);
      return c.json(parsed, err.status as 400);
    } catch {
      return c.json({ error: err.message }, err.status as 400);
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: `Worker request failed: ${message}` }, 500);
}

export type WorkerPathArg = string | ((c: Context) => string);

function resolvePath(arg: WorkerPathArg, c: Context): string {
  return typeof arg === "function" ? arg(c) : arg;
}

/**
 * GET handler that proxies query params to Worker.
 *
 * @param workerPath Worker path (string or callback that derives it from ctx).
 * @param extractParams Optional override for query-param extraction.
 */
export function workerGetHandler(
  workerPath: WorkerPathArg,
  extractParams?: (c: Context) => Record<string, string>,
): Handler {
  return async (c) => {
    const userId = userIdOf(c);
    const path = resolvePath(workerPath, c);
    const params = extractParams ? extractParams(c) : paramsOf(c);
    try {
      const client = resolveClient(c);
      const result = await client.get(path, userId, params);
      if (result === null) return new Response(null, { status: 204 });
      return c.json(result as object);
    } catch (err) {
      return workerErrorResponse(c, err);
    }
  };
}

/**
 * POST handler — body parsed as JSON; `successStatus` defaults to 201.
 */
export function workerPostHandler(
  workerPath: WorkerPathArg,
  options?: { successStatus?: number },
): Handler {
  const successStatus = options?.successStatus ?? 201;
  return async (c) => {
    const userId = userIdOf(c);
    const path = resolvePath(workerPath, c);
    const body = await readJsonBody(c);
    if (body === "invalid") {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      const client = resolveClient(c);
      const result = await client.post(path, userId, body);
      if (result === null) return new Response(null, { status: 204 });
      return c.json(result as object, successStatus as 200);
    } catch (err) {
      return workerErrorResponse(c, err);
    }
  };
}

export function workerPatchHandler(workerPath: WorkerPathArg): Handler {
  return async (c) => {
    const userId = userIdOf(c);
    const path = resolvePath(workerPath, c);
    const body = await readJsonBody(c);
    if (body === "invalid") {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      const client = resolveClient(c);
      const result = await client.patch(path, userId, body);
      if (result === null) return new Response(null, { status: 204 });
      return c.json(result as object);
    } catch (err) {
      return workerErrorResponse(c, err);
    }
  };
}

export function workerPutHandler(workerPath: WorkerPathArg): Handler {
  return async (c) => {
    const userId = userIdOf(c);
    const path = resolvePath(workerPath, c);
    const body = await readJsonBody(c);
    if (body === "invalid") {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      const client = resolveClient(c);
      const result = await client.put(path, userId, body);
      if (result === null) return new Response(null, { status: 204 });
      return c.json(result as object);
    } catch (err) {
      return workerErrorResponse(c, err);
    }
  };
}

export function workerDeleteHandler(workerPath: WorkerPathArg): Handler {
  return async (c) => {
    const userId = userIdOf(c);
    const path = resolvePath(workerPath, c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined; // DELETE may have no body
    }
    try {
      const client = resolveClient(c);
      const result = await client.delete(path, userId, body);
      if (result === null) return new Response(null, { status: 204 });
      return c.json(result as object);
    } catch (err) {
      return workerErrorResponse(c, err);
    }
  };
}
