import { Hono } from "hono";
import { liveRoute } from "./routes/live";

export function createApp(): Hono {
  const app = new Hono();
  app.route("/live", liveRoute);
  return app;
}
