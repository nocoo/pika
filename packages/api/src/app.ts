import { Hono } from "hono";
import {
  type AuthMiddlewareDeps,
  type AuthVariables,
  requireUser,
} from "./middleware/auth";
import { ingestRoute } from "./routes/ingest";
import { createLiveRoute, liveRoute as defaultLiveRoute } from "./routes/live";
import { projectsRoute } from "./routes/projects";
import { searchRoute } from "./routes/search";
import { sessionsRoute } from "./routes/sessions";
import { statsRoute } from "./routes/stats";
import { tagsRoute } from "./routes/tags";

export interface AppDeps {
  liveRoute?: Hono;
  /** Optional auth middleware override (test injection). */
  authMiddleware?: ReturnType<typeof requireUser>;
  /** Deps forwarded to the default `requireUser()` when no override given. */
  authDeps?: AuthMiddlewareDeps;
}

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Public routes (no auth)
  app.route("/live", deps.liveRoute ?? defaultLiveRoute);

  // Authenticated routes
  const auth = deps.authMiddleware ?? requireUser(deps.authDeps);
  app.use("/search/*", auth);
  app.use("/search", auth);
  app.route("/search", searchRoute);

  app.use("/stats/*", auth);
  app.use("/stats", auth);
  app.route("/stats", statsRoute);

  app.use("/projects/*", auth);
  app.use("/projects", auth);
  app.route("/projects", projectsRoute);

  app.use("/tags/*", auth);
  app.use("/tags", auth);
  app.route("/tags", tagsRoute);

  app.use("/sessions/*", auth);
  app.use("/sessions", auth);
  app.route("/sessions", sessionsRoute);

  app.use("/ingest/*", auth);
  app.use("/ingest", auth);
  app.route("/ingest", ingestRoute);

  return app;
}

export { createLiveRoute };
