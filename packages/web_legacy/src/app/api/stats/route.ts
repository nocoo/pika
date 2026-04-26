/**
 * GET /api/stats — forwards to api.
 *
 * Stage-a transition (docs/16): browsers hit same-origin /api/stats and
 * web forwards to api on API_INTERNAL_URL (defaults to localhost:7023).
 */
import { forwardGet } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = forwardGet;
