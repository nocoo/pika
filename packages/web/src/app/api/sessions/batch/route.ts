/**
 * POST /api/sessions/batch — batch operations on sessions.
 *
 * Proxies to Worker POST /sessions/batch.
 */
import { createWorkerPostRoute } from "@/lib/worker-proxy";

export const POST = createWorkerPostRoute("/sessions/batch");
