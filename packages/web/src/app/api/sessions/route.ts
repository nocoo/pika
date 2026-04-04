/**
 * GET /api/sessions — list sessions with filters and pagination.
 *
 * Proxies to Worker GET /sessions.
 */
import { createWorkerGetRoute } from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/sessions");
