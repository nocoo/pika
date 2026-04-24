import { Hono } from "hono";
import { workerGetHandler } from "../lib/worker-proxy";

export const projectsRoute: Hono = new Hono();
projectsRoute.get("/", workerGetHandler("/projects"));
projectsRoute.get("/activity", workerGetHandler("/projects/activity"));
