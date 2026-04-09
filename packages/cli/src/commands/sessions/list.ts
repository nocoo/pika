import { defineCommand } from "@nocoo/cli-base";
import { normalizeSource, SOURCES } from "@pika/core";
import {
  type ApiClient,
  createPikaClient,
  PIKA_PAGINATION,
} from "../../api/client.js";
import { parseDuration, parsePositiveInt } from "../../output/duration.js";
import {
  ApiError,
  type OutputFormat,
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
} from "../../output/formatter.js";
import {
  buildPaginationParams,
  type ParsedPaginationArgs,
  parsePaginationArgs,
} from "../../output/pagination.js";
import { type SessionListResponse, sessionListColumns } from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsList(
  args: ParsedPaginationArgs & {
    project?: string;
    source?: string;
    starred?: boolean;
    deleted?: boolean;
    includeDeleted?: boolean;
    from?: string;
    to?: string;
    sort?: string;
    model?: string;
    minMessages?: number;
    maxMessages?: number;
    minDuration?: number;
    maxDuration?: number;
    minInputTokens?: number;
    maxInputTokens?: number;
    minOutputTokens?: number;
    maxOutputTokens?: number;
    minTotalTokens?: number;
    maxTotalTokens?: number;
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  // Build pagination params using shared helper
  const params = buildPaginationParams(args);
  if (args.project) params.projectKey = args.project;
  if (args.source) {
    const normalized = normalizeSource(args.source);
    if (normalized) {
      params.source = normalized;
    } else {
      throw new Error(
        `Invalid source: "${args.source}". Valid sources: ${SOURCES.join(", ")}, or aliases: gemini, claude, copilot`,
      );
    }
  }
  if (args.starred) params.starred = "true";
  if (args.deleted) params.deleted = "true";
  if (args.includeDeleted) params.includeDeleted = "true";
  if (args.from) params.from = args.from;
  if (args.to) params.to = args.to;
  if (args.sort) params.sort = args.sort;
  if (args.model) params.model = args.model;
  if (args.minMessages !== undefined)
    params.minMessages = String(args.minMessages);
  if (args.maxMessages !== undefined)
    params.maxMessages = String(args.maxMessages);
  if (args.minDuration !== undefined)
    params.minDuration = String(args.minDuration);
  if (args.maxDuration !== undefined)
    params.maxDuration = String(args.maxDuration);
  if (args.minInputTokens !== undefined)
    params.minInputTokens = String(args.minInputTokens);
  if (args.maxInputTokens !== undefined)
    params.maxInputTokens = String(args.maxInputTokens);
  if (args.minOutputTokens !== undefined)
    params.minOutputTokens = String(args.minOutputTokens);
  if (args.maxOutputTokens !== undefined)
    params.maxOutputTokens = String(args.maxOutputTokens);
  if (args.minTotalTokens !== undefined)
    params.minTotalTokens = String(args.minTotalTokens);
  if (args.maxTotalTokens !== undefined)
    params.maxTotalTokens = String(args.maxTotalTokens);

  const response = await client.get<SessionListResponse>("/sessions", params);

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;

  // Output full envelope in json mode, items only in table/minimal
  formatter.response(
    { items: data.sessions, raw: data },
    { columns: sessionListColumns, minimalKey: "id" },
  );

  // Pagination hints to stderr in table mode only
  if (args.format === "table" && data.hasMore) {
    if (data.page != null) {
      formatter.info(
        `Page ${data.page} of ${Math.ceil(data.totalCount! / data.pageSize!)}. Use --page ${data.page + 1} to continue.`,
      );
    } else if (data.cursor) {
      formatter.info(
        `More results available. Use --cursor ${data.cursor} to continue.`,
      );
    }
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "list",
    description: "List sessions with optional filters",
  },
  args: {
    limit: {
      type: "string",
      default: "50",
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
    format: {
      type: "string",
      description: "Output format: json, table, minimal, auto (default: auto)",
    },
    project: {
      type: "string",
      description: "Filter by project key",
    },
    source: {
      type: "string",
      description:
        "Filter by source (claude-code, codex, gemini-cli, opencode, vscode-copilot). Aliases: gemini, claude, copilot",
    },
    starred: {
      type: "boolean",
      description: "Show only starred sessions",
    },
    deleted: {
      type: "boolean",
      description: "Show only deleted sessions (trash)",
    },
    "include-deleted": {
      type: "boolean",
      description: "Include deleted sessions in results (show all)",
    },
    from: {
      type: "string",
      description: "Filter by last_message_at >= date (ISO 8601)",
    },
    to: {
      type: "string",
      description: "Filter by last_message_at <= date (ISO 8601)",
    },
    sort: {
      type: "string",
      description:
        "Sort by: last_message_at, started_at, total_messages, duration_seconds",
    },
    model: {
      type: "string",
      description: "Filter by model (e.g., claude-sonnet-4-20250514)",
    },
    "min-messages": {
      type: "string",
      description: "Minimum total messages",
    },
    "max-messages": {
      type: "string",
      description: "Maximum total messages",
    },
    "min-duration": {
      type: "string",
      description: "Minimum duration (e.g., 5m, 2h, 1d)",
    },
    "max-duration": {
      type: "string",
      description: "Maximum duration (e.g., 5m, 2h, 1d)",
    },
    "min-input-tokens": {
      type: "string",
      description: "Minimum input tokens",
    },
    "max-input-tokens": {
      type: "string",
      description: "Maximum input tokens",
    },
    "min-output-tokens": {
      type: "string",
      description: "Minimum output tokens",
    },
    "max-output-tokens": {
      type: "string",
      description: "Maximum output tokens",
    },
    "min-total-tokens": {
      type: "string",
      description: "Minimum total tokens (input + output)",
    },
    "max-total-tokens": {
      type: "string",
      description: "Maximum total tokens (input + output)",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  async run({ args }) {
    const format = resolveFormat(args.format);
    const formatter = new OutputFormatter({ format });

    await withErrorHandling(async () => {
      const client = createPikaClient(args.dev);

      const pagination = parsePaginationArgs(
        { limit: args.limit, page: args.page, cursor: args.cursor },
        PIKA_PAGINATION,
      );

      await runSessionsList(
        {
          ...pagination,
          project: args.project,
          source: args.source,
          starred: args.starred,
          deleted: args.deleted,
          includeDeleted: args["include-deleted"],
          from: args.from,
          to: args.to,
          sort: args.sort,
          model: args.model,
          minMessages: args["min-messages"]
            ? parsePositiveInt(args["min-messages"], "--min-messages")
            : undefined,
          maxMessages: args["max-messages"]
            ? parsePositiveInt(args["max-messages"], "--max-messages")
            : undefined,
          minDuration: args["min-duration"]
            ? parseDuration(args["min-duration"])
            : undefined,
          maxDuration: args["max-duration"]
            ? parseDuration(args["max-duration"])
            : undefined,
          minInputTokens: args["min-input-tokens"]
            ? parsePositiveInt(args["min-input-tokens"], "--min-input-tokens")
            : undefined,
          maxInputTokens: args["max-input-tokens"]
            ? parsePositiveInt(args["max-input-tokens"], "--max-input-tokens")
            : undefined,
          minOutputTokens: args["min-output-tokens"]
            ? parsePositiveInt(args["min-output-tokens"], "--min-output-tokens")
            : undefined,
          maxOutputTokens: args["max-output-tokens"]
            ? parsePositiveInt(args["max-output-tokens"], "--max-output-tokens")
            : undefined,
          minTotalTokens: args["min-total-tokens"]
            ? parsePositiveInt(args["min-total-tokens"], "--min-total-tokens")
            : undefined,
          maxTotalTokens: args["max-total-tokens"]
            ? parsePositiveInt(args["max-total-tokens"], "--max-total-tokens")
            : undefined,
          format,
        },
        { client, formatter },
      );
    }, formatter);
  },
});
