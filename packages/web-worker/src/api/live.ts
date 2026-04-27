/**
 * In-process Hono subapp for /api/live (public, no auth).
 */

import { Hono } from "hono";
import { handleLive } from "../data/ingest";
import type { AppEnv } from "../lib/env";

export const liveApp: Hono<AppEnv> = new Hono<AppEnv>();

liveApp.get("/", (c) => handleLive(c.env));
