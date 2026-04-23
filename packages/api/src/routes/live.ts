import { PIKA_VERSION } from "@pika/core";
import { Hono } from "hono";

export const liveRoute = new Hono();

liveRoute.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    status: "ok",
    component: "api",
    version: PIKA_VERSION,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});
