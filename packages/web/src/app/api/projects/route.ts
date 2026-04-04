/**
 * GET /api/projects — list projects.
 *
 * Proxies to Worker GET /projects.
 */
import { createWorkerGetRoute } from "@/lib/worker-proxy";

export const GET = createWorkerGetRoute("/projects");
