import type { ApiTokenExecutor, ApiTokenRow } from "@pika/core";
import { hashToken } from "@pika/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import { authTokensApp } from "./auth-tokens";

/** In-memory api_tokens executor with auto-incrementing id. */
function makeExec(): {
  exec: ApiTokenExecutor;
  rows: ApiTokenRow[];
} {
  const rows: ApiTokenRow[] = [];
  let nextId = 1;
  const exec: ApiTokenExecutor = {
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      if (sql.includes("WHERE user_id = ?")) {
        const [userId] = params as [string];
        return rows
          .filter((r) => r.user_id === userId)
          .sort((a, b) =>
            a.created_at < b.created_at ? 1 : -1,
          ) as unknown as T[];
      }
      if (sql.includes("WHERE hashed = ?")) {
        const [hashed, nowIso] = params as [string, string];
        return rows
          .filter(
            (r) =>
              r.hashed === hashed &&
              (r.expires_at === null || r.expires_at > nowIso),
          )
          .slice(0, 1) as unknown as T[];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    async run(sql: string, params: unknown[]) {
      if (sql.trim().startsWith("INSERT INTO api_tokens")) {
        const [
          user_id,
          email,
          token_prefix,
          hashed,
          name,
          created_at,
          expires_at,
        ] = params as [
          string,
          string,
          string,
          string,
          string | null,
          string,
          string | null,
        ];
        const id = nextId++;
        rows.push({
          id,
          user_id,
          email,
          token_prefix,
          hashed,
          name,
          created_at,
          last_used_at: null,
          expires_at,
        });
        return { lastInsertId: id, changes: 1 };
      }
      if (sql.trim().startsWith("DELETE FROM api_tokens")) {
        const [id, userId] = params as [number, string];
        const idx = rows.findIndex((r) => r.id === id && r.user_id === userId);
        if (idx === -1) return { changes: 0 };
        rows.splice(idx, 1);
        return { changes: 1 };
      }
      return { changes: 0 };
    },
  };
  return { exec, rows };
}

function makeApp(opts: {
  userId?: string;
  email?: string;
  exec?: ApiTokenExecutor;
}) {
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    if (opts.userId !== undefined) c.set("userId", opts.userId);
    if (opts.email !== undefined) c.set("accessEmail", opts.email);
    if (opts.exec) c.set("apiTokenExec", opts.exec);
    return next();
  });
  root.route("/api/auth/tokens", authTokensApp);
  return root;
}

const URL_BASE = "https://x/api/auth/tokens";

describe("/api/auth/tokens", () => {
  it("GET requires userId + email", async () => {
    const app = makeApp({});
    const res = await app.fetch(new Request(URL_BASE));
    expect(res.status).toBe(401);
  });

  it("GET lists tokens without leaking the hash", async () => {
    const { exec, rows } = makeExec();
    rows.push({
      id: 1,
      user_id: "u-1",
      email: "u@x.com",
      token_prefix: "pk_abcd",
      hashed: "SECRET-HASH",
      name: "CLI",
      created_at: "2026-01-01T00:00:00Z",
      last_used_at: null,
      expires_at: null,
    });
    const app = makeApp({ userId: "u-1", email: "u@x.com", exec });
    const res = await app.fetch(new Request(URL_BASE));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).not.toHaveProperty("hashed");
    expect(body.tokens[0]).toMatchObject({
      id: 1,
      token_prefix: "pk_abcd",
      name: "CLI",
    });
  });

  it("POST mints a token, returns raw pk_*, persists only the hash", async () => {
    const { exec, rows } = makeExec();
    const app = makeApp({ userId: "u-1", email: "u@x.com", exec });
    const res = await app.fetch(
      new Request(URL_BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "CLI" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      token: string;
      tokenPrefix: string;
      name: string | null;
    };
    expect(body.token).toMatch(/^pk_/);
    expect(body.tokenPrefix).toBe(body.token.slice(0, 8));
    expect(body.name).toBe("CLI");
    expect(rows).toHaveLength(1);
    // hash is not reversible: stored hash matches sha256(raw), but raw is gone
    expect(rows[0]!.hashed).toBe(await hashToken(body.token));
    expect(rows[0]!.hashed).not.toBe(body.token);
  });

  it("POST without body still mints (name=null)", async () => {
    const { exec } = makeExec();
    const app = makeApp({ userId: "u-1", email: "u@x.com", exec });
    const res = await app.fetch(new Request(URL_BASE, { method: "POST" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string | null };
    expect(body.name).toBeNull();
  });

  it("POST with malformed JSON → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(
      new Request(URL_BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST without auth → 401", async () => {
    const app = makeApp({});
    const res = await app.fetch(new Request(URL_BASE, { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("DELETE removes only the caller's own token", async () => {
    const { exec, rows } = makeExec();
    rows.push(
      {
        id: 1,
        user_id: "u-1",
        email: "u@x.com",
        token_prefix: "pk_a",
        hashed: "h-1",
        name: null,
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        expires_at: null,
      },
      {
        id: 2,
        user_id: "u-other",
        email: "o@x.com",
        token_prefix: "pk_b",
        hashed: "h-2",
        name: null,
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        expires_at: null,
      },
    );
    const app = makeApp({ userId: "u-1", email: "u@x.com", exec });
    const ok = await app.fetch(
      new Request(`${URL_BASE}/1`, { method: "DELETE" }),
    );
    expect(ok.status).toBe(204);
    const cross = await app.fetch(
      new Request(`${URL_BASE}/2`, { method: "DELETE" }),
    );
    expect(cross.status).toBe(404);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(2);
  });

  it("DELETE with bad id → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(
      new Request(`${URL_BASE}/abc`, { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });

  it("DELETE without auth → 401", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      new Request(`${URL_BASE}/1`, { method: "DELETE" }),
    );
    expect(res.status).toBe(401);
  });
});
