import { PIKA_PAGINATION } from "../api/client.js";

// ─── Types ────────────────────────────────────────────────────

export type PaginationMode = "cursor" | "page" | "none";

export interface ParsedPaginationArgs {
  limit: number;
  page?: number;
  cursor?: string;
  mode: PaginationMode;
}

export interface PaginationInfo {
  hasMore: boolean;
  nextCursor?: string;
  totalCount?: number;
  currentPage?: number;
}

// ─── Parsing ──────────────────────────────────────────────────

export interface PaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

/**
 * Parse and validate pagination args.
 *
 * - Validates limit is numeric and within bounds
 * - Enforces mutual exclusion: page and cursor cannot both be set
 * - Returns validated defaults when inputs are missing or invalid
 *
 * @throws Error if page and cursor are both provided
 */
export function parsePaginationArgs(
  args: {
    limit?: string;
    page?: string;
    cursor?: string;
  },
  options?: PaginationOptions
): ParsedPaginationArgs {
  const defaultLimit = options?.defaultLimit ?? PIKA_PAGINATION.defaultLimit;
  const maxLimit = options?.maxLimit ?? PIKA_PAGINATION.maxLimit;

  // Validate mutual exclusion
  if (args.page && args.cursor) {
    throw new Error("Cannot use both --page and --cursor. Choose one.");
  }

  // Parse limit
  let limit = defaultLimit;
  if (args.limit) {
    const parsed = parseInt(args.limit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  }

  // Parse page
  let page: number | undefined;
  if (args.page) {
    const parsed = parseInt(args.page, 10);
    if (!isNaN(parsed) && parsed > 0) {
      page = parsed;
    }
  }

  // Determine mode
  let mode: PaginationMode = "cursor";
  if (page !== undefined) {
    mode = "page";
  } else if (args.cursor) {
    mode = "cursor";
  }

  return {
    limit,
    page,
    cursor: args.cursor,
    mode,
  };
}

/**
 * Build query params for API request from parsed pagination args.
 */
export function buildPaginationParams(
  parsed: ParsedPaginationArgs
): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(parsed.limit),
  };

  if (parsed.cursor) {
    params.cursor = parsed.cursor;
  }

  if (parsed.page !== undefined) {
    params.page = String(parsed.page);
  }

  return params;
}

/**
 * Extract pagination info from API response.
 */
export function extractPaginationInfo(response: unknown): PaginationInfo {
  const obj = response as Record<string, unknown>;
  return {
    hasMore: Boolean(obj.hasMore),
    nextCursor: typeof obj.cursor === "string" ? obj.cursor : undefined,
    totalCount: typeof obj.totalCount === "number" ? obj.totalCount : undefined,
    currentPage: typeof obj.page === "number" ? obj.page : undefined,
  };
}
