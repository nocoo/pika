/**
 * In-process Hono subapp for /api/projects/*.
 */

import { Hono } from "hono";
import { handleListProjects, handleProjectActivity } from "../data/projects";
import type { AppEnv } from "../lib/env";

export const projectsApp: Hono<AppEnv> = new Hono<AppEnv>();

projectsApp.get("/", (c) => {
  const url = new URL(c.req.url);
  return handleListProjects(c.get("userId") as string, url.searchParams, c.env);
});

projectsApp.get("/activity", (c) => {
  const url = new URL(c.req.url);
  return handleProjectActivity(
    c.get("userId") as string,
    url.searchParams,
    c.env,
  );
});
