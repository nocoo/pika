import { createApiToken } from "@pika/core";
import type { Context } from "hono";
import { d1ApiTokenExecutor } from "../lib/d1-api-tokens";
import type { AppEnv } from "../lib/env";

/**
 * `GET /api/auth/cli?callback=...&state=...`
 *
 * Loopback OAuth-style mint. The CLI starts a local listener on
 * `http://127.0.0.1:<port>` (or `localhost`), opens this URL, and we
 * 302 the browser back with `?api_key=pk_*&email=<owner>&state=<echoed>`.
 *
 * The query param name `callback` and the `email` field in the response
 * are part of the CLI wire contract — see `@nocoo/cli-base` `performLogin`
 * and `packages/cli/src/commands/login-flow.test.ts`.
 *
 * Anti-abuse:
 *   - `callback` must be an absolute http URL with hostname
 *     `127.0.0.1` or `localhost` (no `http://attacker.example/`).
 *   - `state` must be a non-empty string (the CLI echoes it back to
 *     verify the response came from its own request, not a CSRF).
 *   - Caller must already be authenticated (CF Access JWT or a prior
 *     pk_* token). Unauth → 401.
 */
export async function authCliHandler(c: Context<AppEnv>) {
  const userId = c.get("userId");
  const email = c.get("accessEmail");
  if (!userId || !email) return c.json({ error: "Unauthorized" }, 401);

  const callbackRaw = c.req.query("callback");
  const state = c.req.query("state");

  if (!callbackRaw) return c.json({ error: "Missing callback" }, 400);
  if (!state) return c.json({ error: "Missing state" }, 400);

  let callback: URL;
  try {
    callback = new URL(callbackRaw);
  } catch {
    return c.json({ error: "Invalid callback" }, 400);
  }
  if (callback.protocol !== "http:") {
    return c.json({ error: "callback must be http" }, 400);
  }
  if (callback.hostname !== "127.0.0.1" && callback.hostname !== "localhost") {
    return c.json({ error: "callback must be loopback" }, 400);
  }

  const exec = c.get("apiTokenExec") ?? d1ApiTokenExecutor(c.env.DB);
  const created = await createApiToken(exec, {
    userId,
    email,
    name: "CLI (loopback)",
  });

  callback.searchParams.set("api_key", created.token);
  callback.searchParams.set("email", email);
  callback.searchParams.set("state", state);
  return c.redirect(callback.toString(), 302);
}
