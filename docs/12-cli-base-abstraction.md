# 12. CLI Base Abstraction

> Design document for `@nocoo/cli-base` enhancements to support CRUD operations.

## Overview

This document outlines the abstractions to be added to `@nocoo/cli-base` to enable CLI applications to perform authenticated API operations with consistent patterns for output formatting, pagination, and testability.

## Goals

1. **Reusable API Client** — Authenticated HTTP client with token management, retry logic, and error handling
2. **Clean Machine Output** — Strict separation between data output (stdout) and human messages (stderr)
3. **Flexible Pagination** — Support both cursor-based and page-based modes to match existing APIs
4. **Testability** — All I/O functions accept injectable dependencies for mocking

## Design Principles

### Separation of Concerns: stdout vs stderr

**Critical**: Machine-readable output (json/minimal) goes to stdout only. Human-readable messages (success, error, hints) go to stderr.

```bash
# AI agent can safely parse stdout
pika sessions list --format=json > sessions.json

# Human sees helpful messages on stderr
pika sessions list --format=json 2>&1 | head
# stderr: Fetching sessions...
# stdout: [{"id":"sess_abc",...}]
```

## New Modules

### 1. ApiClient

Authenticated HTTP client that integrates with ConfigManager.

```typescript
// api-client.ts

export interface ApiClientOptions {
  /** Base URL for API requests */
  baseUrl: string;
  /** Function to retrieve auth token */
  getToken: () => string | undefined;
  /** Optional custom fetch implementation (for testing) */
  fetchFn?: typeof fetch;
  /** Retry configuration */
  retry?: {
    maxAttempts?: number;  // default: 3
    backoffMs?: number;    // default: 1000
    retryOn?: number[];    // default: [429, 502, 503, 504]
  };
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface RequestOptions {
  /** Request body (will be JSON-serialized) */
  body?: unknown;
  /** Additional headers */
  headers?: Record<string, string>;
}

export class ApiClient {
  constructor(options: ApiClientOptions);

  /** GET request with automatic auth header */
  get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>>;

  /** POST request with JSON body */
  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>>;

  /** PUT request with JSON body */
  put<T>(path: string, body?: unknown): Promise<ApiResponse<T>>;

  /** PATCH request with JSON body */
  patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>>;

  /** DELETE request with optional JSON body */
  delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>>;

  /** Generic request method */
  request<T>(method: string, path: string, options?: RequestOptions): Promise<ApiResponse<T>>;

  /** Check if client has valid token */
  isAuthenticated(): boolean;
}
```

**Features:**
- Automatic `Authorization: Bearer <token>` header
- Automatic `Content-Type: application/json` for POST/PUT/PATCH/DELETE with body
- DELETE supports optional request body (required for some APIs)
- PUT method for APIs that use it
- Retry with exponential backoff for transient errors
- 401 detection with helpful "please run login" message
- Query parameter serialization

### 2. OutputFormatter

Multi-format output with strict stdout/stderr separation.

```typescript
// output.ts

export type OutputFormat = "json" | "table" | "minimal";

export interface OutputOptions {
  /** Output format */
  format: OutputFormat;
  /** Stream for data output (default: process.stdout) */
  stdout?: NodeJS.WritableStream;
  /** Stream for messages (default: process.stderr) */
  stderr?: NodeJS.WritableStream;
}

export interface TableColumn<T> {
  key: keyof T | ((row: T) => string);
  header: string;
  width?: number;
  align?: "left" | "right";
}

export class OutputFormatter {
  constructor(options: OutputOptions);

  // ─── Data Output (stdout) ───────────────────────────────────

  /** Output a list of items to stdout */
  list<T>(items: T[], options: {
    /** Columns for table format */
    columns: TableColumn<T>[];
    /** Key to extract for minimal format */
    minimalKey: keyof T;
  }): void;

  /** Output a single item to stdout */
  item<T>(item: T): void;

  /** Output raw JSON to stdout */
  json(data: unknown): void;

  // ─── Messages (stderr) ──────────────────────────────────────

  /** Log info message to stderr */
  info(message: string): void;

  /** Log success message to stderr */
  success(message: string): void;

  /** Log error message to stderr */
  error(message: string): void;

  /** Log warning message to stderr */
  warn(message: string): void;
}

/**
 * Determine output format based on TTY and explicit flag.
 * Default: "table" if stdout is TTY, "json" otherwise.
 */
export function resolveFormat(
  explicit: string | undefined,
  isTTY?: boolean
): OutputFormat;
```

**Format behaviors:**
- `json` — Pretty-printed JSON to stdout, messages to stderr
- `table` — Human-readable table to stdout, messages to stderr
- `minimal` — One value per line to stdout (e.g., IDs), messages to stderr

**Single item output (`item()`):**
- `json` → Pretty-printed JSON object
- `table` → Key-value pairs, one per line
- `minimal` → JSON (same as json, single items don't have a "minimal" representation)

### 3. PaginationHelper

Flexible pagination that adapts to API capabilities.

```typescript
// pagination.ts

import type { ArgsDef } from "citty";

/**
 * Pagination mode supported by the API.
 * - "cursor": Keyset pagination with opaque cursor (default for most APIs)
 * - "page": Offset pagination with page number
 * - "none": API returns all results, no pagination
 */
export type PaginationMode = "cursor" | "page" | "none";

/** Standard pagination args for citty commands */
export const paginationArgs: ArgsDef = {
  limit: {
    type: "string",
    default: "20",
    description: "Maximum number of items to return (max: 100)",
  },
  page: {
    type: "string",
    description: "Page number (starts at 1). Uses offset pagination.",
  },
  cursor: {
    type: "string",
    description: "Cursor for keyset pagination (from previous response)",
  },
};

/** Standard output format arg */
export const formatArg: ArgsDef = {
  format: {
    type: "string",
    description: "Output format: json, table, minimal",
  },
};

export interface ParsedPaginationArgs {
  limit: number;
  page?: number;
  cursor?: string;
  mode: PaginationMode;
}

/** Parse and validate pagination args */
export function parsePaginationArgs(args: {
  limit?: string;
  page?: string;
  cursor?: string;
}): ParsedPaginationArgs;

/** Build query params for API request */
export function buildPaginationParams(
  parsed: ParsedPaginationArgs
): Record<string, string>;

/** Extract pagination info from API response */
export interface PaginationInfo {
  hasMore: boolean;
  nextCursor?: string;
  totalCount?: number;
  currentPage?: number;
}

export function extractPaginationInfo(response: unknown): PaginationInfo;
```

### 4. CommandHelpers

Utilities for building consistent commands.

```typescript
// command-helpers.ts

/**
 * Wrap a command handler with standard error handling.
 * - Catches API errors and formats them consistently
 * - Handles 401 with "please run login" message
 * - Sets process.exitCode on error (does not throw)
 */
export function withErrorHandling(
  handler: () => Promise<void>,
  formatter: OutputFormatter
): Promise<void>;

/**
 * Assert that the client is authenticated.
 * Throws a helpful error if not.
 */
export function requireAuth(client: ApiClient): void;
```

**Note**: We intentionally do NOT provide `createResourceCommands()`. The abstraction would only cover simple list/get patterns, while most real commands (delete, star, search, tags) have unique semantics. Better to keep command implementations explicit and consistent through patterns rather than code generation.

## Updated Exports

```typescript
// index.ts additions

// API Client
export { ApiClient, type ApiClientOptions, type ApiResponse, type RequestOptions } from "./api-client.js";

// Output
export {
  OutputFormatter,
  resolveFormat,
  type OutputFormat,
  type OutputOptions,
  type TableColumn,
} from "./output.js";

// Pagination
export {
  paginationArgs,
  formatArg,
  parsePaginationArgs,
  buildPaginationParams,
  extractPaginationInfo,
  type PaginationMode,
  type ParsedPaginationArgs,
  type PaginationInfo,
} from "./pagination.js";

// Command helpers
export {
  withErrorHandling,
  requireAuth,
} from "./command-helpers.js";
```

## Testing Strategy

All new modules follow the existing pattern of dependency injection:

```typescript
// api-client.test.ts
test("includes auth header when token exists", async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: "test" }),
  });

  const client = new ApiClient({
    baseUrl: "https://api.example.com",
    getToken: () => "test-token",
    fetchFn: mockFetch,
  });

  await client.get("/test");

  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.example.com/test",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer test-token",
      }),
    })
  );
});

test("delete sends request body when provided", async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    json: () => Promise.resolve(null),
  });

  const client = new ApiClient({
    baseUrl: "https://api.example.com",
    getToken: () => "token",
    fetchFn: mockFetch,
  });

  await client.delete("/tags", { tagId: "tag_123" });

  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.example.com/tags",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ tagId: "tag_123" }),
    })
  );
});

// output.test.ts
test("json format outputs only to stdout", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const formatter = new OutputFormatter({
    format: "json",
    stdout: { write: (s: string) => { stdout.push(s); return true; } } as any,
    stderr: { write: (s: string) => { stderr.push(s); return true; } } as any,
  });

  formatter.list(
    [{ id: "a", name: "Alice" }],
    { columns: [], minimalKey: "id" }
  );
  formatter.success("Done!");

  // Data goes to stdout
  expect(stdout.join("")).toContain('"id":"a"');
  // Messages go to stderr
  expect(stderr.join("")).toContain("Done!");
  // stdout has NO messages
  expect(stdout.join("")).not.toContain("Done!");
});

test("minimal format outputs IDs only", () => {
  const stdout: string[] = [];
  const formatter = new OutputFormatter({
    format: "minimal",
    stdout: { write: (s: string) => { stdout.push(s); return true; } } as any,
    stderr: { write: () => true } as any,
  });

  formatter.list(
    [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }],
    { columns: [], minimalKey: "id" }
  );

  expect(stdout.join("")).toBe("a\nb\n");
});
```

## Migration Path

1. **Phase 1**: Add new modules to cli-base, release as minor version bump
2. **Phase 2**: pika CLI adopts new modules for new commands
3. **Phase 3**: Other CLIs (pew, otter) can adopt as needed

## Open Questions

1. **Rate limit headers**: Should ApiClient expose `X-RateLimit-*` headers for callers to implement backpressure?
2. **Response streaming**: For large result sets, should we support streaming JSON lines?
3. **Offline detection**: Should ApiClient detect network errors and suggest checking connectivity?
