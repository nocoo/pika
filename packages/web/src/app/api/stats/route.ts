/**
 * GET /api/stats — dashboard statistics.
 *
 * Proxies to Worker GET /stats.
 */
import { createWorkerGetRoute } from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/stats");
