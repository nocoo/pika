/**
 * GET /live — health probe.
 *
 * No auth. Probes Worker `/live` to surface upstream D1 connectivity in the
 * same envelope shape that web previously served. Returns 503 if Worker is
 * unreachable or reports `database.connected === false`.
 *
 * Error messages MUST NOT contain the word "ok" — uptime monitors that
 * grep for "ok" must not see a happy keyword inside an error string.
 */

import { PIKA_VERSION } from "@pika/core";
import { Hono } from "hono";

export interface LiveResponse {
  status: "ok" | "error";
  component: "api";
  version: string;
  timestamp: string;
  uptime: number;
  database: { connected: boolean; error?: string };
}

export type LiveDeps = {
  /** Worker base URL; defaults to `process.env.WORKER_URL`. */
  getWorkerUrl?: () => string | undefined;
  /** Override fetch (test injection). */
  fetch?: typeof fetch;
  /** Process uptime (seconds); defaults to `process.uptime()`. */
  getUptime?: () => number;
  /** Override `now`; defaults to `() => new Date()`. */
  now?: () => Date;
};

const HEADERS = { "Cache-Control": "no-store" } as const;

function sanitize(message: string): string {
  return message.replace(/\bok\b/gi, "***");
}

export function createLiveRoute(deps: LiveDeps = {}): Hono {
  const route = new Hono();
  const getWorkerUrl = deps.getWorkerUrl ?? (() => process.env.WORKER_URL);
  const fetchFn = deps.fetch ?? fetch;
  const getUptime = deps.getUptime ?? (() => process.uptime());
  const now = deps.now ?? (() => new Date());

  route.get("/", async (c) => {
    c.header("Cache-Control", HEADERS["Cache-Control"]);

    const base = {
      component: "api" as const,
      version: PIKA_VERSION,
      timestamp: now().toISOString(),
      uptime: Math.floor(getUptime()),
    };

    const workerUrl = getWorkerUrl();
    if (!workerUrl) {
      return c.json(
        {
          status: "error",
          ...base,
          database: { connected: false, error: "WORKER_URL not configured" },
        } satisfies LiveResponse,
        503,
      );
    }

    try {
      const response = await fetchFn(new URL("/live", workerUrl), {
        headers: { "Cache-Control": "no-cache" },
      });
      const result = (await response.json()) as {
        database?: { connected: boolean; error?: string };
      };
      const dbConnected = result.database?.connected ?? false;

      return c.json(
        {
          status: dbConnected ? "ok" : "error",
          ...base,
          database: result.database ?? { connected: false, error: "Unknown" },
        } satisfies LiveResponse,
        dbConnected ? 200 : 503,
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          status: "error",
          ...base,
          database: {
            connected: false,
            error: `Worker unreachable: ${sanitize(raw)}`,
          },
        } satisfies LiveResponse,
        503,
      );
    }
  });

  return route;
}

/** Default route that reads from `process.env`. */
export const liveRoute: Hono = createLiveRoute();
