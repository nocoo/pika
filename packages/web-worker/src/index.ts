import { Hono } from "hono";
import { ingestApp } from "./api/ingest";
import { liveApp } from "./api/live";
import { projectsApp } from "./api/projects";
import { searchApp } from "./api/search";
import { sessionsApp } from "./api/sessions";
import { statsApp } from "./api/stats";
import { tagsApp } from "./api/tags";
import type { AppEnv } from "./lib/env";
import { accessAuth } from "./middleware/access-auth";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { resolveUser } from "./middleware/resolve-user";
import { authCliHandler } from "./routes/auth-cli";
import { authTokensApp } from "./routes/auth-tokens";
import { meHandler } from "./routes/me";

// docs/17 single-worker pivot — middleware chain:
//   accessAuth → apiKeyAuth → resolveUser → 401
// /api/live is public.

const app = new Hono<AppEnv>();

app.use("/api/*", accessAuth);
app.use("/api/*", apiKeyAuth);
app.use("/api/*", resolveUser);

// Public
app.route("/api/live", liveApp);

// Auth-only (resolveUser ensures userId is set; data handlers re-check via env)
app.get("/api/me", meHandler);
app.route("/api/auth/tokens", authTokensApp);
app.get("/api/auth/cli", authCliHandler);

// Resource routes — in-process (no service binding hop)
app.route("/api/sessions", sessionsApp);
app.route("/api/projects", projectsApp);
app.route("/api/search", searchApp);
app.route("/api/stats", statsApp);
app.route("/api/tags", tagsApp);
app.route("/api/ingest", ingestApp);

export default app;
