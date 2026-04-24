import { Hono } from "hono";
import { workerGetHandler } from "../lib/worker-proxy";

export const statsRoute: Hono = new Hono();
statsRoute.get("/", workerGetHandler("/stats"));
