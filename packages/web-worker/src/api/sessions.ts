/**
 * In-process Hono subapp for /api/sessions/*.
 *
 * Replaces the old packages/api → service-binding hop. Each route reads the
 * authenticated `userId` from `c.get("userId")` (set by resolveUser) and
 * calls the corresponding `data/sessions.ts` handler with `c.env` (DB+BUCKET).
 */

import { Hono } from "hono";
import {
  handleBatchOperation,
  handleFilters,
  handleGetSession,
  handleGetSessionContent,
  handleListSessions,
  handleSetStar,
  handleTrashSession,
  handleUpdateSession,
} from "../data/sessions";
import {
  handleAddSessionTag,
  handleGetSessionTags,
  handleRemoveSessionTag,
} from "../data/tags";
import type { AppEnv } from "../lib/env";

export const sessionsApp: Hono<AppEnv> = new Hono<AppEnv>();

function userIdOf(c: import("hono").Context<AppEnv>): string {
  return c.get("userId") as string;
}

async function readJson(c: import("hono").Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

sessionsApp.get("/", (c) => {
  const url = new URL(c.req.url);
  return handleListSessions(userIdOf(c), url.searchParams, c.env);
});

sessionsApp.get("/filters", (c) => handleFilters(userIdOf(c), c.env));

sessionsApp.post("/batch", async (c) => {
  const body = await readJson(c);
  return handleBatchOperation(userIdOf(c), body, c.env);
});

sessionsApp.get("/:id", (c) =>
  handleGetSession(userIdOf(c), c.req.param("id") ?? "", c.env),
);

sessionsApp.patch("/:id", async (c) => {
  const body = await readJson(c);
  return handleUpdateSession(userIdOf(c), c.req.param("id") ?? "", body, c.env);
});

sessionsApp.get("/:id/content", (c) =>
  handleGetSessionContent(userIdOf(c), c.req.param("id") ?? "", c.env),
);

sessionsApp.patch("/:id/star", async (c) => {
  const body = await readJson(c);
  return handleSetStar(userIdOf(c), c.req.param("id") ?? "", body, c.env);
});

sessionsApp.patch("/:id/trash", async (c) => {
  const body = await readJson(c);
  return handleTrashSession(userIdOf(c), c.req.param("id") ?? "", body, c.env);
});

sessionsApp.get("/:id/tags", (c) =>
  handleGetSessionTags(userIdOf(c), c.req.param("id") ?? "", c.env),
);

sessionsApp.put("/:id/tags", async (c) => {
  const body = await readJson(c);
  return handleAddSessionTag(userIdOf(c), c.req.param("id") ?? "", body, c.env);
});

sessionsApp.delete("/:id/tags", async (c) => {
  const body = await readJson(c);
  return handleRemoveSessionTag(
    userIdOf(c),
    c.req.param("id") ?? "",
    body,
    c.env,
  );
});
