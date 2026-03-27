/**
 * CliAuthDb implementation backed by Cloudflare D1 (via HTTP API).
 *
 * Stores SHA-256 hashed api_key on the users table. Injected into handleCliAuth
 * and resolveUser so business logic stays testable with mocks while
 * the route handler uses this real implementation.
 */

import type { CliAuthDb } from "./cli-auth";
import type { D1Client } from "./d1";

export class D1CliAuthDb implements CliAuthDb {
  constructor(private readonly db: D1Client) {}

  async setApiKey(userId: string, hashedKey: string): Promise<void> {
    const meta = await this.db.execute(
      "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
      [hashedKey, userId],
    );
    if (meta.changes === 0) {
      throw new Error(
        `setApiKey: user ${userId} not found in D1. OAuth sign-in may not have persisted the user row.`,
      );
    }
  }

  async getUserByApiKey(
    hashedKey: string,
  ): Promise<{ id: string; email: string } | null> {
    const row = await this.db.firstOrNull<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE api_key = ?",
      [hashedKey],
    );
    return row ?? null;
  }
}
