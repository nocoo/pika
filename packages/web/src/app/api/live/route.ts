/**
 * GET /api/live — forwards to api `GET /live`.
 *
 * Stage-a transition (docs/16): handler stays as a fetch-forward until prod
 * cuts over to Vite + CF Workers (or a Caddy-equivalent matcher routes
 * `/api/*` directly to api). Once that lands the route can be deleted.
 */

import { forwardGet } from "@/lib/api-forward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = forwardGet;
