/**
 * In-process Hono subapp for /api/stats.
 */

import { Hono } from "hono";
import { handleStats } from "../data/stats";
import type { AppEnv } from "../lib/env";

export const statsApp: Hono<AppEnv> = new Hono<AppEnv>();

statsApp.get("/", (c) => handleStats(c.get("userId") as string, c.env));
