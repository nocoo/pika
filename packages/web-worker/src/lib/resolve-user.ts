/**
 * Email → users.id resolution. Idempotent upsert per docs/17 §身份模型 #2:
 *
 *   INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING;
 *   SELECT id FROM users WHERE email = ?;
 *
 * Concurrent calls with the same email land at most one row thanks to the
 * UNIQUE(email) constraint; losers see DO NOTHING and read the winner's id.
 *
 * Runtime-agnostic: callers supply a thin `UserExecutor` that adapts to
 * bun:sqlite (tests) or Cloudflare D1 (production).
 */

export interface UserExecutor {
  query<T = { id: string }>(sql: string, params: unknown[]): Promise<T[]>;
  run(sql: string, params: unknown[]): Promise<{ changes: number }>;
}

function newUserId(): string {
  // crypto.randomUUID() is available in workers, node ≥19, and bun
  return crypto.randomUUID();
}

export async function resolveUserId(
  exec: UserExecutor,
  email: string,
): Promise<string> {
  const id = newUserId();
  await exec.run(
    "INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING",
    [id, email],
  );
  const rows = await exec.query<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    [email],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`resolveUserId: no row for email after upsert: ${email}`);
  }
  return row.id;
}

export function d1UserExecutor(db: D1Database): UserExecutor {
  return {
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      const stmt = db.prepare(sql).bind(...params);
      const res = await stmt.all<T>();
      return (res.results ?? []) as T[];
    },
    async run(sql: string, params: unknown[]) {
      const stmt = db.prepare(sql).bind(...params);
      const res = await stmt.run();
      return { changes: res.meta?.changes ?? 0 };
    },
  };
}
