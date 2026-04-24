/**
 * PATCH /api/sessions/[id]/trash — forwards to api.
 */
import { forwardPatch } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const PATCH = forwardPatch;
