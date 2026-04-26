/**
 * GET /api/sessions — forwards to api.
 */
import { forwardGet } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = forwardGet;
