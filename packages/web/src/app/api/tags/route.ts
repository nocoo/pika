/**
 * Tags routes — list and create tags.
 *
 * GET /api/tags — list tags
 * POST /api/tags — create tag
 *
 * Proxies to Worker.
 */
import {
  createWorkerGetRoute,
  createWorkerPostRoute,
} from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/tags");
export const POST = createWorkerPostRoute("/tags");
