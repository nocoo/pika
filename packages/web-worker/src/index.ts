import { Hono } from "hono";
import type { AppEnv } from "./lib/env";
import { accessAuth } from "./middleware/access-auth";
import { apiKeyAuth } from "./middleware/api-key-auth";

// docs/17 P1.2 — middleware chain: accessAuth → apiKeyAuth → 401.
// /api/live is public; routes/me/auth-tokens/auth-cli land in P1.3–P1.5.

const app = new Hono<AppEnv>();

app.use("/api/*", accessAuth);
app.use("/api/*", apiKeyAuth);

app.get("/api/live", (c) => c.json({ ok: true }));

export default app;
