import type { ApiTokenExecutor, ApiTokenRow } from "@pika/core";
import { generateRawToken, hashToken } from "@pika/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import { apiKeyAuth } from "./api-key-auth";

function makeExec(seed: ApiTokenRow[] = []): {
  exec: ApiTokenExecutor;
  rows: ApiTokenRow[];
} {
  const rows: ApiTokenRow[] = [...seed];
  return {
    rows,
    exec: {
      async query<T>(_sql: string, params: unknown[]): Promise<T[]> {
        const [hashed, nowIso] = params as [string, string];
        return rows
          .filter(
            (r) =>
              r.hashed === hashed &&
              (r.expires_at === null || r.expires_at > nowIso),
          )
          .slice(0, 1) as unknown as T[];
      },
      async run(sql: string, params: unknown[]) {
        if (sql.trim().startsWith("UPDATE api_tokens SET last_used_at")) {
          const [now, id] = params as [string, number];
          const row = rows.find((r) => r.id === id);
          if (row) row.last_used_at = now;
          return { changes: row ? 1 : 0 };
        }
        return { changes: 0 };
      },
    },
  };
}

function makeApp(
  env: Partial<AppEnv["Bindings"]> = {},
  exec?: ApiTokenExecutor,
) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (exec) c.set("apiTokenExec", exec);
    return next();
  });
  app.use("/api/*", apiKeyAuth);
  app.get("/api/live", (c) => c.json({ ok: true }));
  app.get("/api/me", (c) =>
    c.json({
      email: c.get("accessEmail") ?? null,
      userId: c.get("userId") ?? null,
    }),
  );
  // wrap fetch to inject env
  return {
    fetch: (req: Request) =>
      app.fetch(req, env as unknown as Record<string, unknown>),
  };
}

describe("apiKeyAuth", () => {
  it("/api/live is public", async () => {
    const app = makeApp({ ENVIRONMENT: "production" });
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/live"));
    expect(res.status).toBe(200);
  });

  it("E2E_SKIP_AUTH bypasses outside production", async () => {
    const app = makeApp({
      ENVIRONMENT: "test",
      E2E_SKIP_AUTH: "true",
    });
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/me"));
    expect(res.status).toBe(200);
  });

  it("E2E_SKIP_AUTH sets accessEmail from DEV_USER_EMAIL", async () => {
    const app = makeApp({
      ENVIRONMENT: "test",
      E2E_SKIP_AUTH: "true",
      DEV_USER_EMAIL: "e2e@test.local",
    });
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/me"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ email: "e2e@test.local", userId: null });
  });

  it("E2E_SKIP_AUTH does NOT bypass in production", async () => {
    const app = makeApp({
      ENVIRONMENT: "production",
      E2E_SKIP_AUTH: "true",
    });
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/me"));
    expect(res.status).toBe(401);
  });

  it("localhost without bearer is allowed through", async () => {
    const app = makeApp({ ENVIRONMENT: "development" });
    const res = await app.fetch(
      new Request("http://localhost:7025/api/me", {
        headers: { host: "localhost:7025" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("missing Bearer on prod path → 401", async () => {
    const app = makeApp({ ENVIRONMENT: "production" });
    const res = await app.fetch(new Request("https://pika.hexly.ai/api/me"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("malformed Authorization header → 401", async () => {
    const app = makeApp({ ENVIRONMENT: "production" });
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { Authorization: "NotBearer abc" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("Bearer with no match → 403", async () => {
    const { exec } = makeExec();
    const app = makeApp({ ENVIRONMENT: "production" }, exec);
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { Authorization: "Bearer pk_nope" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid API key" });
  });

  it("happy path: valid Bearer → sets accessEmail + userId", async () => {
    const raw = generateRawToken();
    const hashed = await hashToken(raw);
    const { exec, rows } = makeExec([
      {
        id: 7,
        user_id: "u-real",
        email: "real@example.com",
        token_prefix: raw.slice(0, 8),
        hashed,
        name: "CLI",
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        expires_at: null,
      },
    ]);
    const app = makeApp({ ENVIRONMENT: "production" }, exec);
    const res = await app.fetch(
      new Request("https://pika.hexly.ai/api/me", {
        headers: { Authorization: `Bearer ${raw}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; userId: string };
    expect(body).toEqual({ email: "real@example.com", userId: "u-real" });
    // updateLastUsed is fire-and-forget; wait a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(rows[0].last_used_at).not.toBeNull();
  });

  it("localhost WITH bearer still verifies token", async () => {
    const { exec } = makeExec();
    const app = makeApp({ ENVIRONMENT: "development" }, exec);
    const res = await app.fetch(
      new Request("http://localhost:7025/api/me", {
        headers: {
          host: "localhost:7025",
          Authorization: "Bearer pk_invalid",
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});
