/**
 * PATCH/DELETE /api/tags/[tagId] — forwards to api.
 */
import { forwardDelete, forwardPatch } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const PATCH = forwardPatch;
export const DELETE = forwardDelete;
