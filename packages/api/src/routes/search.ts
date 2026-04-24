/**
 * GET /search — full-text search proxy.
 *
 * Pure pass-through to Worker `/search` (the actual search lives in Worker
 * routes/search.ts). The api layer only attaches userId from auth.
 */

import { Hono } from "hono";
import { workerGetHandler } from "../lib/worker-proxy";

export const searchRoute: Hono = new Hono();

searchRoute.get("/", workerGetHandler("/search"));
