/**
 * In-process Hono subapp for /api/tags/* (workspace-level tag CRUD).
 *
 * Per-session tag operations live on /api/sessions/:id/tags (see api/sessions.ts).
 */

import { Hono } from "hono";
import {
  handleCreateTag,
  handleDeleteTag,
  handleListTags,
  handleUpdateTag,
} from "../data/tags";
import type { AppEnv } from "../lib/env";

export const tagsApp: Hono<AppEnv> = new Hono<AppEnv>();

async function readJson(c: import("hono").Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

tagsApp.get("/", (c) => handleListTags(c.get("userId") as string, c.env));

tagsApp.post("/", async (c) => {
  const body = await readJson(c);
  return handleCreateTag(c.get("userId") as string, body, c.env);
});

tagsApp.patch("/:tagId", async (c) => {
  const body = await readJson(c);
  return handleUpdateTag(
    c.get("userId") as string,
    c.req.param("tagId") ?? "",
    body,
    c.env,
  );
});

tagsApp.delete("/:tagId", (c) =>
  handleDeleteTag(c.get("userId") as string, c.req.param("tagId") ?? "", c.env),
);
