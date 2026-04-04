/**
 * Worker proxy helpers for Next.js API routes.
 *
 * These helpers simplify migrating routes from D1 direct access to
 * Worker-based access. They handle auth resolution and response proxying.
 */

import { NextResponse } from "next/server";
import { auth } from "./auth";
import { getWorkerClient, WorkerError } from "./worker-client";

/**
 * Resolve the authenticated user from the request.
 *
 * Supports:
 * 1. Session auth (cookie-based, browser dashboard)
 * 2. Bearer pk_... API key (CLI uploads) - validated via Worker /auth/me
 *
 * Returns userId or null if not authenticated.
 */
export async function resolveUserForWorker(
  request: Request,
): Promise<string | null> {
  // 1. Session auth
  const session = await auth();
  if (session?.user?.id) {
    return session.user.id;
  }

  // 2. API key auth - validate via Worker /auth/me
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer pk_")) {
    try {
      const workerUrl = process.env.WORKER_URL;
      if (!workerUrl) return null;

      const response = await fetch(new URL("/auth/me", workerUrl), {
        method: "GET",
        headers: { Authorization: authHeader },
      });

      if (response.ok) {
        const result = (await response.json()) as { userId: string };
        return result.userId;
      }
    } catch {
      // API key validation failed
    }
  }

  return null;
}

/**
 * Handle a WorkerError by converting it to a NextResponse.
 */
export function handleWorkerError(err: unknown): NextResponse {
  if (err instanceof WorkerError) {
    // Try to parse as JSON error
    try {
      const parsed = JSON.parse(err.message);
      return NextResponse.json(parsed, { status: err.status });
    } catch {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { error: `Worker request failed: ${message}` },
    { status: 500 },
  );
}

/**
 * Create a GET route handler that proxies to Worker.
 *
 * @param workerPath - Worker path (e.g., "/sessions")
 * @param extractParams - Optional function to extract URL params
 */
export function createWorkerGetRoute(
  workerPath: string | ((url: URL) => string),
  extractParams?: (url: URL) => Record<string, string>,
) {
  return async (request: Request) => {
    const userId = await resolveUserForWorker(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path =
      typeof workerPath === "function" ? workerPath(url) : workerPath;
    const params = extractParams?.(url) ?? Object.fromEntries(url.searchParams);

    try {
      const client = getWorkerClient();
      const result = await client.get(path, userId, params);

      if (result === null) {
        return new NextResponse(null, { status: 204 });
      }

      return NextResponse.json(result);
    } catch (err) {
      return handleWorkerError(err);
    }
  };
}

/**
 * Create a POST route handler that proxies to Worker.
 */
export function createWorkerPostRoute(
  workerPath: string | ((url: URL) => string),
) {
  return async (request: Request) => {
    const userId = await resolveUserForWorker(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path =
      typeof workerPath === "function" ? workerPath(url) : workerPath;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    try {
      const client = getWorkerClient();
      const result = await client.post(path, userId, body);

      if (result === null) {
        return new NextResponse(null, { status: 204 });
      }

      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      return handleWorkerError(err);
    }
  };
}

/**
 * Create a PATCH route handler that proxies to Worker.
 */
export function createWorkerPatchRoute(
  workerPath: string | ((url: URL) => string),
) {
  return async (request: Request) => {
    const userId = await resolveUserForWorker(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path =
      typeof workerPath === "function" ? workerPath(url) : workerPath;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    try {
      const client = getWorkerClient();
      const result = await client.patch(path, userId, body);

      if (result === null) {
        return new NextResponse(null, { status: 204 });
      }

      return NextResponse.json(result);
    } catch (err) {
      return handleWorkerError(err);
    }
  };
}

/**
 * Create a PUT route handler that proxies to Worker.
 */
export function createWorkerPutRoute(
  workerPath: string | ((url: URL) => string),
) {
  return async (request: Request) => {
    const userId = await resolveUserForWorker(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path =
      typeof workerPath === "function" ? workerPath(url) : workerPath;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    try {
      const client = getWorkerClient();
      const result = await client.put(path, userId, body);

      if (result === null) {
        return new NextResponse(null, { status: 204 });
      }

      return NextResponse.json(result);
    } catch (err) {
      return handleWorkerError(err);
    }
  };
}

/**
 * Create a DELETE route handler that proxies to Worker.
 */
export function createWorkerDeleteRoute(
  workerPath: string | ((url: URL) => string),
) {
  return async (request: Request) => {
    const userId = await resolveUserForWorker(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path =
      typeof workerPath === "function" ? workerPath(url) : workerPath;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // DELETE can have no body
      body = undefined;
    }

    try {
      const client = getWorkerClient();
      const result = await client.delete(path, userId, body);

      if (result === null) {
        return new NextResponse(null, { status: 204 });
      }

      return NextResponse.json(result);
    } catch (err) {
      return handleWorkerError(err);
    }
  };
}
