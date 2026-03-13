/**
 * CliAuthDb implementation backed by Cloudflare D1 (via HTTP API).
 *
 * Reads/writes api_key on the users table. Injected into handleCliAuth
 * and resolveUser so business logic stays testable with mocks while
 * the route handler uses this real implementation.
 */

import type { D1Client } from "./d1";
import type { CliAuthDb } from "./cli-auth";

export class D1CliAuthDb implements CliAuthDb {
  constructor(private readonly db: D1Client) {}

  async getApiKey(userId: string): Promise<string | null> {
    const row = await this.db.firstOrNull<{ api_key: string | null }>(
      "SELECT api_key FROM users WHERE id = ?",
      [userId],
    );
    return row?.api_key ?? null;
  }

  async setApiKey(userId: string, apiKey: string): Promise<void> {
    const meta = await this.db.execute(
      "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
      [apiKey, userId],
    );
    if (meta.changes === 0) {
      throw new Error(
        `setApiKey: user ${userId} not found in D1. OAuth sign-in may not have persisted the user row.`,
      );
    }
  }

  async getUserByApiKey(
    apiKey: string,
  ): Promise<{ id: string; email: string } | null> {
    const row = await this.db.firstOrNull<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE api_key = ?",
      [apiKey],
    );
    return row ?? null;
  }
}
