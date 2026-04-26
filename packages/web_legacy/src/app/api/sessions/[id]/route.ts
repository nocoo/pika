/**
 * GET/PATCH /api/sessions/[id] — forwards to api.
 */
import { forwardGet, forwardPatch } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = forwardGet;
export const PATCH = forwardPatch;
