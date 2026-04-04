/**
 * GET /api/search — full-text search sessions.
 *
 * Proxies to Worker GET /search.
 */
import { createWorkerGetRoute } from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/search");
