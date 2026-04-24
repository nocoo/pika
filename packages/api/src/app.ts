import { Hono } from "hono";
import { createLiveRoute, liveRoute as defaultLiveRoute } from "./routes/live";

export interface AppDeps {
  liveRoute?: Hono;
}

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();
  app.route("/live", deps.liveRoute ?? defaultLiveRoute);
  return app;
}

export { createLiveRoute };
