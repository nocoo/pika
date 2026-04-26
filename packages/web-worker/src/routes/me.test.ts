import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import { meHandler } from "./me";

function makeApp(preset: Partial<AppEnv["Variables"]> = {}) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (preset.accessEmail !== undefined)
      c.set("accessEmail", preset.accessEmail);
    if (preset.userId !== undefined) c.set("userId", preset.userId);
    return next();
  });
  app.get("/api/me", meHandler);
  return app;
}

describe("GET /api/me", () => {
  it("returns nulls when neither var is set", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://x/api/me"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: null, userId: null });
  });

  it("returns set email + userId", async () => {
    const app = makeApp({ accessEmail: "a@x.com", userId: "u-1" });
    const res = await app.fetch(new Request("https://x/api/me"));
    expect(await res.json()).toEqual({ email: "a@x.com", userId: "u-1" });
  });
});
