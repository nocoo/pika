/**
 * In-process Hono subapp for /api/search.
 */

import { Hono } from "hono";
import { handleSearch } from "../data/search";
import type { AppEnv } from "../lib/env";

export const searchApp: Hono<AppEnv> = new Hono<AppEnv>();

searchApp.get("/", (c) => {
  const url = new URL(c.req.url);
  return handleSearch(c.get("userId") as string, url.searchParams, c.env);
});
