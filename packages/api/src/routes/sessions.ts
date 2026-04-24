import { Hono } from "hono";
import {
  workerDeleteHandler,
  workerGetHandler,
  workerPatchHandler,
  workerPostHandler,
  workerPutHandler,
} from "../lib/worker-proxy";

export const sessionsRoute: Hono = new Hono();

// List family
sessionsRoute.get("/", workerGetHandler("/sessions"));
sessionsRoute.get("/filters", workerGetHandler("/sessions/filters"));
sessionsRoute.post(
  "/batch",
  workerPostHandler("/sessions/batch", { successStatus: 200 }),
);

// Per-session resources
const idPath =
  (suffix = "") =>
  (c: import("hono").Context) =>
    `/sessions/${encodeURIComponent(c.req.param("id"))}${suffix}`;

sessionsRoute.get("/:id", workerGetHandler(idPath()));
sessionsRoute.patch("/:id", workerPatchHandler(idPath()));

sessionsRoute.get("/:id/content", workerGetHandler(idPath("/content")));

sessionsRoute.patch("/:id/star", workerPatchHandler(idPath("/star")));
sessionsRoute.patch("/:id/trash", workerPatchHandler(idPath("/trash")));

sessionsRoute.get("/:id/tags", workerGetHandler(idPath("/tags")));
sessionsRoute.put("/:id/tags", workerPutHandler(idPath("/tags")));
sessionsRoute.delete("/:id/tags", workerDeleteHandler(idPath("/tags")));
