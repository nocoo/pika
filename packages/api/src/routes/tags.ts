import { Hono } from "hono";
import {
  workerDeleteHandler,
  workerGetHandler,
  workerPatchHandler,
  workerPostHandler,
} from "../lib/worker-proxy";

export const tagsRoute: Hono = new Hono();

tagsRoute.get("/", workerGetHandler("/tags"));
tagsRoute.post("/", workerPostHandler("/tags"));

tagsRoute.patch(
  "/:tagId",
  workerPatchHandler(
    (c) => `/tags/${encodeURIComponent(c.req.param("tagId") ?? "")}`,
  ),
);

tagsRoute.delete(
  "/:tagId",
  workerDeleteHandler(
    (c) => `/tags/${encodeURIComponent(c.req.param("tagId") ?? "")}`,
  ),
);
