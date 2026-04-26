import { Hono } from "hono";

// docs/17 P0.3 — minimal scaffold. Only /api/live; everything else falls
// through to ASSETS (SPA fallback). access-auth / api-key-auth / proxy
// land in P1–P3.

const app = new Hono();

app.get("/api/live", (c) => c.json({ ok: true }));

export default app;
