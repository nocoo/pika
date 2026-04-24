/**
 * POST /api/sessions/batch — forwards to api.
 */
import { forwardPost } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = forwardPost;
