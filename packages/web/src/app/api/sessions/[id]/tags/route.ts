/**
 * GET/PUT/DELETE /api/sessions/[id]/tags — forwards to api.
 */
import { forwardDelete, forwardGet, forwardPut } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = forwardGet;
export const PUT = forwardPut;
export const DELETE = forwardDelete;
