/**
 * Web-side D1 client wrapper.
 *
 * Re-exports the runtime-agnostic class from @pika/core/infra/d1 and adds:
 *  - getD1Client(): singleton factory reading process.env
 *  - resetD1Client(): test helper
 *  - assertTestDatabase(): wrapper that reads CF_D1_DATABASE_ID from env
 */

import {
  assertTestDatabase as coreAssertTestDatabase,
  D1Client,
  TEST_DATABASE_ID,
} from "@pika/core/infra/d1";

export {
  type D1BatchStatement,
  D1Client,
  type D1Config,
  D1Error,
  type D1Meta,
  type D1QueryResult,
  TEST_DATABASE_ID,
} from "@pika/core/infra/d1";

let _client: D1Client | null = null;

export function getD1Client(): D1Client {
  if (!_client) {
    _client = new D1Client({
      accountId: process.env.CF_ACCOUNT_ID ?? "",
      databaseId: process.env.CF_D1_DATABASE_ID ?? "",
      apiToken: process.env.CF_D1_API_TOKEN ?? "",
    });
  }
  return _client;
}

export function resetD1Client(): void {
  _client = null;
}

export async function assertTestDatabase(client?: D1Client): Promise<void> {
  const dbId = process.env.CF_D1_DATABASE_ID;
  // Defer client construction when env binding will fail anyway, so the
  // env-mismatch error surfaces (instead of a missing-config error from
  // getD1Client()).
  const db =
    client ?? (dbId === TEST_DATABASE_ID ? getD1Client() : ({} as D1Client));
  await coreAssertTestDatabase(db, dbId);
}
