import type { Context, Next } from "hono";
import type { AppEnv } from "../lib/env";
import { d1UserExecutor, resolveUserId } from "../lib/resolve-user";

/**
 * Resolves `accessEmail` → `users.id` and stamps `userId` on the context.
 *
 * Skips when:
 *   - no `accessEmail` (unauthenticated public path or local dev no-bearer);
 *   - `userId` already set (api-key-auth path already has it on the row).
 */
export async function resolveUser(c: Context<AppEnv>, next: Next) {
  if (c.get("userId")) return next();
  const email = c.get("accessEmail");
  if (!email) return next();

  const exec = c.get("userExec") ?? d1UserExecutor(c.env.DB);
  const id = await resolveUserId(exec, email);
  c.set("userId", id);
  return next();
}
