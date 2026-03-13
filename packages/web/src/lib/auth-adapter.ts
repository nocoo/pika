/**
 * Custom D1 Auth Adapter for NextAuth v5.
 *
 * Persists OAuth users and accounts to the D1 `users` and `accounts`
 * tables via the Cloudflare D1 HTTP API. Without this adapter, NextAuth
 * JWT-only mode never writes user rows, so handleCliAuth's setApiKey()
 * UPDATE hits 0 rows and the generated API key becomes unusable.
 *
 * Accepts a lazy getter (`() => D1Client`) so the D1 client is not
 * created at module load time. This prevents the entire web app from
 * crashing when D1 env vars are missing (e.g. local dev, pages that
 * import auth but don't trigger adapter methods).
 *
 * Implements only the methods NextAuth needs for the Google OAuth + JWT flow:
 * - createUser, getUser, getUserByEmail, getUserByAccount, updateUser, linkAccount
 */

import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";
import type { D1Client } from "./d1";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  email_verified: string | null;
}

function rowToUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
  };
}

export function D1AuthAdapter(getClient: () => D1Client): Adapter {
  return {
    async createUser(user) {
      const client = getClient();
      const id = user.id ?? crypto.randomUUID();
      await client.execute(
        `INSERT INTO users (id, email, name, image, email_verified)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          user.email,
          user.name ?? null,
          user.image ?? null,
          user.emailVerified?.toISOString() ?? null,
        ],
      );
      return { ...user, id } as AdapterUser;
    },

    async getUser(id) {
      const client = getClient();
      const row = await client.firstOrNull<UserRow>(
        "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
        [id],
      );
      return row ? rowToUser(row) : null;
    },

    async getUserByEmail(email) {
      const client = getClient();
      const row = await client.firstOrNull<UserRow>(
        "SELECT id, email, name, image, email_verified FROM users WHERE email = ?",
        [email],
      );
      return row ? rowToUser(row) : null;
    },

    async getUserByAccount({
      provider,
      providerAccountId,
    }: {
      provider: string;
      providerAccountId: string;
    }) {
      const client = getClient();
      const row = await client.firstOrNull<UserRow>(
        `SELECT u.id, u.email, u.name, u.image, u.email_verified
         FROM users u
         JOIN accounts a ON a.user_id = u.id
         WHERE a.provider = ? AND a.provider_account_id = ?`,
        [provider, providerAccountId],
      );
      return row ? rowToUser(row) : null;
    },

    async updateUser(user) {
      const client = getClient();
      const fields: string[] = [];
      const params: unknown[] = [];

      if (user.name !== undefined) {
        fields.push("name = ?");
        params.push(user.name);
      }
      if (user.email !== undefined) {
        fields.push("email = ?");
        params.push(user.email);
      }
      if (user.image !== undefined) {
        fields.push("image = ?");
        params.push(user.image);
      }
      if (user.emailVerified !== undefined) {
        fields.push("email_verified = ?");
        params.push(
          user.emailVerified ? user.emailVerified.toISOString() : null,
        );
      }

      if (fields.length === 0) {
        // Nothing to update — fetch and return current row
        const row = await client.firstOrNull<UserRow>(
          "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
          [user.id],
        );
        return row ? rowToUser(row) : (user as AdapterUser);
      }

      fields.push("updated_at = datetime('now')");
      params.push(user.id);

      await client.execute(
        `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
        params,
      );

      const row = await client.firstOrNull<UserRow>(
        "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
        [user.id],
      );
      return row ? rowToUser(row) : (user as AdapterUser);
    },

    async linkAccount(account: AdapterAccount) {
      const client = getClient();
      await client.execute(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id,
         access_token, refresh_token, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          account.userId,
          account.type,
          account.provider,
          account.providerAccountId,
          account.access_token ?? null,
          account.refresh_token ?? null,
          account.expires_at ?? null,
        ],
      );
      return account;
    },
  };
}
