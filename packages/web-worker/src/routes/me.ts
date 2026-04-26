import type { Context } from "hono";
import type { AppEnv } from "../lib/env";

/**
 * `GET /api/me` → `{ email, userId }`. Both fields are nullable: a localhost
 * pass-through with no bearer/JWT will leave them unset.
 */
export function meHandler(c: Context<AppEnv>) {
  return c.json({
    email: c.get("accessEmail") ?? null,
    userId: c.get("userId") ?? null,
  });
}
