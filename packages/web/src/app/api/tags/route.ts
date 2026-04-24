/**
 * GET/POST /api/tags — forwards to api.
 */
import { forwardGet, forwardPost } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = forwardGet;
export const POST = forwardPost;
