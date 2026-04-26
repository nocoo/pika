import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import type { UserExecutor } from "../lib/resolve-user";
import { resolveUser } from "./resolve-user";

function makeMemoryExecutor(): UserExecutor & {
  rows: Array<{ id: string; email: string }>;
} {
  const rows: Array<{ id: string; email: string }> = [];
  return {
    rows,
    async query<T>(_sql: string, params: unknown[]): Promise<T[]> {
      const [email] = params as [string];
      const r = rows.find((x) => x.email === email);
      return (r ? [{ id: r.id }] : []) as unknown as T[];
    },
    async run(sql: string, params: unknown[]) {
      if (!sql.startsWith("INSERT INTO users")) return { changes: 0 };
      const [id, email] = params as [string, string];
      if (rows.some((r) => r.email === email)) return { changes: 0 };
      rows.push({ id, email });
      return { changes: 1 };
    },
  };
}

function makeApp(
  opts: { preset?: Partial<AppEnv["Variables"]>; exec?: UserExecutor } = {},
) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (opts.preset?.accessEmail !== undefined)
      c.set("accessEmail", opts.preset.accessEmail);
    if (opts.preset?.userId !== undefined) c.set("userId", opts.preset.userId);
    if (opts.exec) c.set("userExec", opts.exec);
    return next();
  });
  app.use("/api/*", resolveUser);
  app.get("/api/me", (c) =>
    c.json({
      email: c.get("accessEmail") ?? null,
      userId: c.get("userId") ?? null,
    }),
  );
  return app;
}

describe("resolveUser middleware", () => {
  it("no accessEmail → leaves userId unset", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://x/api/me"));
    expect(await res.json()).toEqual({ email: null, userId: null });
  });

  it("userId already set → does not touch executor", async () => {
    const exec = makeMemoryExecutor();
    const app = makeApp({
      preset: { accessEmail: "a@x.com", userId: "preset-id" },
      exec,
    });
    const res = await app.fetch(new Request("https://x/api/me"));
    expect(await res.json()).toEqual({
      email: "a@x.com",
      userId: "preset-id",
    });
    expect(exec.rows).toHaveLength(0);
  });

  it("accessEmail without userId → upsert + assign id", async () => {
    const exec = makeMemoryExecutor();
    const app = makeApp({ preset: { accessEmail: "a@x.com" }, exec });
    const res = await app.fetch(new Request("https://x/api/me"));
    const body = (await res.json()) as { email: string; userId: string };
    expect(body.email).toBe("a@x.com");
    expect(body.userId).toBeTruthy();
    expect(exec.rows).toHaveLength(1);
    expect(exec.rows[0]!.email).toBe("a@x.com");
  });

  it("two requests same email → same userId, single row", async () => {
    const exec = makeMemoryExecutor();
    const app = makeApp({ preset: { accessEmail: "a@x.com" }, exec });
    const r1 = (await (
      await app.fetch(new Request("https://x/api/me"))
    ).json()) as { userId: string };
    const r2 = (await (
      await app.fetch(new Request("https://x/api/me"))
    ).json()) as { userId: string };
    expect(r1.userId).toBe(r2.userId);
    expect(exec.rows).toHaveLength(1);
  });
});
