/**
 * Cloudflare D1 HTTP API client.
 *
 * Runtime-agnostic: the caller supplies config + (optionally) the D1
 * client to assertTestDatabase. The web/Next.js layer wraps these with
 * a singleton factory that pulls config from process.env.
 *
 * @see https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query
 */

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export interface D1Meta {
  changes: number;
  duration: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: D1Meta;
}

export interface D1BatchStatement {
  sql: string;
  params?: unknown[];
}

export class D1Error extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errors?: Array<{ message: string }>,
  ) {
    super(message);
    this.name = "D1Error";
  }
}

export class D1Client {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: D1Config) {
    if (!config.accountId) throw new Error("accountId is required");
    if (!config.databaseId) throw new Error("databaseId is required");
    if (!config.apiToken) throw new Error("apiToken is required");

    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}`;
    this.headers = {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<D1QueryResult<T>> {
    const body = JSON.stringify({ sql, params });
    const data = await this.request(`${this.baseUrl}/query`, body);

    const first = data.result?.[0];
    return {
      results: (first?.results ?? []) as T[],
      meta: first?.meta ?? { changes: 0, duration: 0 },
    };
  }

  async execute(sql: string, params: unknown[] = []): Promise<D1Meta> {
    const result = await this.query(sql, params);
    return result.meta;
  }

  async firstOrNull<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.results[0] ?? null;
  }

  private async request(
    url: string,
    body: string,
  ): Promise<{
    success: boolean;
    result?: Array<{ results?: unknown[]; meta?: D1Meta }>;
    errors?: Array<{ message: string }>;
  }> {
    for (let attempt = 0; attempt <= 1; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this.headers,
          body,
        });
      } catch (err) {
        throw new D1Error(
          `D1 network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const data = (await response.json()) as {
        success: boolean;
        result?: Array<{ results?: unknown[]; meta?: D1Meta }>;
        errors?: Array<{ message: string }>;
      };

      if (response.status === 429 && attempt < 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      if (!response.ok || !data.success) {
        const msg = data.errors?.[0]?.message ?? `D1 HTTP ${response.status}`;
        throw new D1Error(msg, response.status, data.errors);
      }

      return data;
    }

    throw new D1Error("D1 request failed after retries");
  }
}

/** Known test database ID — must match pika-db-test in Cloudflare. */
export const TEST_DATABASE_ID = "f52931ad-9c96-4d04-9d0a-3098a800ce5e";

/**
 * Assert that the supplied D1 client points to the test database.
 * Implements 2-layer verification:
 *   1. databaseId arg must match TEST_DATABASE_ID
 *   2. _test_marker table must exist in the DB
 *
 * @throws Error if any check fails
 */
export async function assertTestDatabase(
  client: D1Client,
  databaseId: string | undefined,
): Promise<void> {
  if (databaseId !== TEST_DATABASE_ID) {
    throw new Error(
      `D1 isolation FAILED: databaseId="${databaseId}" does not match test DB "${TEST_DATABASE_ID}"`,
    );
  }

  const result = await client.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_test_marker'",
  );
  if (result.results.length === 0) {
    throw new Error(
      "D1 isolation FAILED: _test_marker table not found — this may not be the test database",
    );
  }
}
