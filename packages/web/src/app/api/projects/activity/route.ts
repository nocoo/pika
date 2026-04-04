/**
 * GET /api/projects/activity — get project activity heatmap.
 *
 * Proxies to Worker GET /projects/activity.
 */
import { createWorkerGetRoute } from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/projects/activity");
