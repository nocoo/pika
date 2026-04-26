/**
 * D1 → ApiTokenExecutor adapter. The repo in @pika/core is runtime-agnostic;
 * this thin wrapper plugs in Cloudflare's D1 binding.
 */
import type { ApiTokenExecutor } from "@pika/core";

export function d1ApiTokenExecutor(db: D1Database): ApiTokenExecutor {
  return {
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      const stmt = db.prepare(sql).bind(...params);
      const result = await stmt.all<T>();
      return (result.results ?? []) as T[];
    },
    async run(sql: string, params: unknown[]) {
      const stmt = db.prepare(sql).bind(...params);
      const result = await stmt.run();
      const meta =
        (result as { meta?: { last_row_id?: number; changes?: number } })
          .meta ?? {};
      return {
        lastInsertId: meta.last_row_id,
        changes: meta.changes ?? 0,
      };
    },
  };
}
