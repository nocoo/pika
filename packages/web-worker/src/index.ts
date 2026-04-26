import { Hono } from "hono";
import type { AppEnv } from "./lib/env";
import { accessAuth } from "./middleware/access-auth";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { resolveUser } from "./middleware/resolve-user";
import { authCliHandler } from "./routes/auth-cli";
import { authTokensApp } from "./routes/auth-tokens";
import { meHandler } from "./routes/me";

// docs/17 P1 — middleware chain: accessAuth → apiKeyAuth → resolveUser → 401.
// /api/live is public.

const app = new Hono<AppEnv>();

app.use("/api/*", accessAuth);
app.use("/api/*", apiKeyAuth);
app.use("/api/*", resolveUser);

app.get("/api/live", (c) => c.json({ ok: true }));
app.get("/api/me", meHandler);
app.route("/api/auth/tokens", authTokensApp);
app.get("/api/auth/cli", authCliHandler);

export default app;
