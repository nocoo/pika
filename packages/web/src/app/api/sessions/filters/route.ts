/**
 * GET /api/sessions/filters — get available filter values.
 *
 * Proxies to Worker GET /sessions/filters.
 */
import { createWorkerGetRoute } from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/sessions/filters");
