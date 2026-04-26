import type { ApiTokenExecutor, ApiTokenRow } from "@pika/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import { authCliHandler } from "./auth-cli";

function makeExec(): { exec: ApiTokenExecutor; rows: ApiTokenRow[] } {
  const rows: ApiTokenRow[] = [];
  let nextId = 1;
  const exec: ApiTokenExecutor = {
    async query() {
      return [];
    },
    async run(sql, params) {
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
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (opts.userId !== undefined) c.set("userId", opts.userId);
    if (opts.email !== undefined) c.set("accessEmail", opts.email);
    if (opts.exec) c.set("apiTokenExec", opts.exec);
    return next();
  });
  app.get("/api/auth/cli", authCliHandler);
  return app;
}

describe("GET /api/auth/cli", () => {
  it("unauthenticated → 401", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=http://127.0.0.1:9000/cb&state=s",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("missing callback_url → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(new Request("https://x/api/auth/cli?state=s"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing callback_url" });
  });

  it("missing state → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=http://127.0.0.1:9000/cb",
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing state" });
  });

  it("malformed callback_url → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=%E4%B8%80%E4%B8%AA%E5%9D%8F%E7%9A%84URL&state=s",
      ),
    );
    // Some URL parsers accept fragments; assert 400 from invalid scheme/host
    expect(res.status).toBe(400);
  });

  it("non-loopback host rejected (https://attacker.example) → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=https%3A%2F%2Fattacker.example%2Fcb&state=s",
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "callback_url must be http" });
  });

  it("non-loopback host rejected (http://evil.example) → 400", async () => {
    const app = makeApp({ userId: "u-1", email: "u@x.com" });
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=http%3A%2F%2Fevil.example%2Fcb&state=s",
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "callback_url must be loopback",
    });
  });

  it("happy path 127.0.0.1: mints token + 302 with api_key & echoed state", async () => {
    const { exec, rows } = makeExec();
    const app = makeApp({ userId: "u-1", email: "u@x.com", exec });
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=http%3A%2F%2F127.0.0.1%3A9999%2Fcb&state=xyz",
      ),
      { redirect: "manual" } as RequestInit,
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const u = new URL(loc!);
    expect(u.hostname).toBe("127.0.0.1");
    expect(u.port).toBe("9999");
    expect(u.pathname).toBe("/cb");
    expect(u.searchParams.get("state")).toBe("xyz");
    const apiKey = u.searchParams.get("api_key");
    expect(apiKey).toMatch(/^pk_/);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe("u-1");
    expect(rows[0]!.email).toBe("u@x.com");
    expect(rows[0]!.name).toBe("CLI (loopback)");
  });

  it("happy path localhost", async () => {
    const { exec } = makeExec();
    const app = makeApp({ userId: "u-1", email: "u@x.com", exec });
    const res = await app.fetch(
      new Request(
        "https://x/api/auth/cli?callback_url=http%3A%2F%2Flocalhost%3A8080%2Fcb&state=s",
      ),
    );
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get("location")!);
    expect(u.hostname).toBe("localhost");
    expect(u.searchParams.get("api_key")).toMatch(/^pk_/);
  });
});
