/**
 * E2E test helpers — HTTP client, seed data, cleanup utilities.
 *
 * All requests go through the real Next.js dev server (port 17022)
 * with E2E_SKIP_AUTH=true for automatic auth bypass.
 */

// ── HTTP Client ─────────────────────────────────────────────────

function getBaseUrl(): string {
  return process.env.E2E_BASE_URL ?? "http://localhost:17022";
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Make an HTTP request to the E2E server.
 * Returns the raw Response for status/header assertions.
 */
export async function request(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const url = new URL(path, getBaseUrl());

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const init: RequestInit = { method, headers };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  return fetch(url.toString(), init);
}

/** Shorthand: GET request, returns parsed JSON and status. */
export async function get<T = unknown>(
  path: string,
  params?: Record<string, string>,
): Promise<{ status: number; data: T }> {
  const res = await request("GET", path, { params });
  const data = res.status === 204 ? (null as T) : ((await res.json()) as T);
  return { status: res.status, data };
}

/** Shorthand: POST request with JSON body. */
export async function post<T = unknown>(
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await request("POST", path, { body });
  const data = res.status === 204 ? (null as T) : ((await res.json()) as T);
  return { status: res.status, data };
}

/** Shorthand: PATCH request with JSON body. */
export async function patch<T = unknown>(
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await request("PATCH", path, { body });
  const data = res.status === 204 ? (null as T) : ((await res.json()) as T);
  return { status: res.status, data };
}

/** Shorthand: PUT request with JSON body. */
export async function put<T = unknown>(
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await request("PUT", path, { body });
  const data = res.status === 204 ? (null as T) : ((await res.json()) as T);
  return { status: res.status, data };
}

/** Shorthand: DELETE request with optional JSON body. */
export async function del<T = unknown>(
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null }> {
  const res = await request("DELETE", path, { body });
  const data = res.status === 204 ? null : ((await res.json()) as T);
  return { status: res.status, data };
}

// ── E2E Test User ───────────────────────────────────────────────

/** The fixed E2E test user (matches resolveUser E2E bypass). */
export const E2E_USER = {
  userId: "e2e-test-user-id",
  email: "e2e@test.local",
} as const;

// ── Seed Data ───────────────────────────────────────────────────

/** Minimal session row for seeding test data directly via D1. */
export interface SeedSession {
  id: string;
  session_key: string;
  source?: string;
  started_at?: string;
  last_message_at?: string;
  duration_seconds?: number;
  total_messages?: number;
  user_messages?: number;
  assistant_messages?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cached_tokens?: number;
  project_ref?: string;
  project_name?: string;
  model?: string;
  title?: string;
  summary?: string;
  is_starred?: number;
  deleted_at?: string | null;
}

const DEFAULT_SESSION: Required<Omit<SeedSession, "id" | "session_key">> = {
  source: "claude-code",
  started_at: "2025-01-01T00:00:00Z",
  last_message_at: "2025-01-01T01:00:00Z",
  duration_seconds: 3600,
  total_messages: 10,
  user_messages: 5,
  assistant_messages: 5,
  total_input_tokens: 1000,
  total_output_tokens: 500,
  total_cached_tokens: 200,
  project_ref: "test-project",
  project_name: "Test Project",
  model: "claude-sonnet-4-20250514",
  title: "Test Session",
  summary: "A test session for E2E testing",
  is_starred: 0,
  deleted_at: null,
};

/**
 * Seed a session directly via D1 REST API.
 * Uses the test database pointed to by .env.test.
 */
export async function seedSession(session: SeedSession): Promise<void> {
  const s = { ...DEFAULT_SESSION, ...session };

  const sql = `
    INSERT OR REPLACE INTO sessions (
      id, user_id, session_key, source,
      started_at, last_message_at, duration_seconds, snapshot_at,
      user_messages, assistant_messages, total_messages,
      total_input_tokens, total_output_tokens, total_cached_tokens,
      project_ref, project_name, model, title, summary,
      is_starred, deleted_at,
      parser_revision, schema_version
    ) VALUES (
      ?1, ?2, ?3, ?4,
      ?5, ?6, ?7, ?8,
      ?9, ?10, ?11,
      ?12, ?13, ?14,
      ?15, ?16, ?17, ?18, ?19,
      ?20, ?21,
      1, 1
    )
  `;

  const params = [
    s.id,
    E2E_USER.userId,
    s.session_key,
    s.source,
    s.started_at,
    s.last_message_at,
    s.duration_seconds,
    s.last_message_at, // snapshot_at = last_message_at
    s.user_messages,
    s.assistant_messages,
    s.total_messages,
    s.total_input_tokens,
    s.total_output_tokens,
    s.total_cached_tokens,
    s.project_ref,
    s.project_name,
    s.model,
    s.title,
    s.summary,
    s.is_starred,
    s.deleted_at,
  ];

  await d1Execute(sql, params);
}

/**
 * Seed multiple sessions at once.
 */
export async function seedSessions(sessions: SeedSession[]): Promise<void> {
  for (const s of sessions) {
    await seedSession(s);
  }
}

// ── D1 Direct Access ────────────────────────────────────────────

function getD1Config() {
  // Read from the running server's environment (set by setup.ts from .env.test)
  const accountId = process.env.CF_ACCOUNT_ID;
  const databaseId = process.env.CF_D1_DATABASE_ID;
  const apiToken = process.env.CF_D1_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "D1 config missing — ensure .env.test is loaded by setup.ts",
    );
  }

  return { accountId, databaseId, apiToken };
}

/** Execute a SQL statement directly against the test D1 database. */
export async function d1Execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ changes: number }> {
  const { accountId, databaseId, apiToken } = getD1Config();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  const data = (await res.json()) as {
    success: boolean;
    result?: Array<{ meta?: { changes: number } }>;
    errors?: Array<{ message: string }>;
  };

  if (!res.ok || !data.success) {
    const msg = data.errors?.[0]?.message ?? `D1 HTTP ${res.status}`;
    throw new Error(`D1 direct execute failed: ${msg}`);
  }

  return { changes: data.result?.[0]?.meta?.changes ?? 0 };
}

/** Query D1 directly and return typed results. */
export async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { accountId, databaseId, apiToken } = getD1Config();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  const data = (await res.json()) as {
    success: boolean;
    result?: Array<{ results?: T[] }>;
    errors?: Array<{ message: string }>;
  };

  if (!res.ok || !data.success) {
    const msg = data.errors?.[0]?.message ?? `D1 HTTP ${res.status}`;
    throw new Error(`D1 direct query failed: ${msg}`);
  }

  return data.result?.[0]?.results ?? [];
}

// ── Cleanup ─────────────────────────────────────────────────────

/**
 * Clean up ALL E2E test data for the test user.
 * Call this in beforeEach/afterAll to ensure test isolation.
 */
export async function cleanupTestData(): Promise<void> {
  const userId = E2E_USER.userId;

  // Delete in dependency order to satisfy foreign keys
  await d1Execute(
    "DELETE FROM session_tags WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?1)",
    [userId],
  );
  await d1Execute("DELETE FROM tags WHERE user_id = ?1", [userId]);
  await d1Execute(
    "DELETE FROM message_chunks WHERE user_id = ?1",
    [userId],
  );
  await d1Execute("DELETE FROM messages WHERE user_id = ?1", [userId]);
  await d1Execute("DELETE FROM sessions WHERE user_id = ?1", [userId]);
}

/**
 * Ensure the E2E test user exists in the users table.
 * Uses INSERT OR IGNORE so it's idempotent.
 */
export async function ensureTestUser(): Promise<void> {
  await d1Execute(
    "INSERT OR IGNORE INTO users (id, email, name) VALUES (?1, ?2, ?3)",
    [E2E_USER.userId, E2E_USER.email, "E2E Test User"],
  );
}

// ── Test ID Generation ──────────────────────────────────────────

let counter = 0;

/** Generate a unique ID for test entities. */
export function testId(prefix = "e2e"): string {
  counter++;
  return `${prefix}-${Date.now()}-${counter}`;
}
