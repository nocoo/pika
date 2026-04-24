import { Hono } from "hono";
import { workerGetHandler, workerPostHandler } from "../lib/worker-proxy";

export const sessionsRoute: Hono = new Hono();

sessionsRoute.get("/", workerGetHandler("/sessions"));
sessionsRoute.get("/filters", workerGetHandler("/sessions/filters"));
sessionsRoute.post(
  "/batch",
  workerPostHandler("/sessions/batch", { successStatus: 200 }),
);
