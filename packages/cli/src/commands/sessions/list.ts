import { defineCommand } from "@nocoo/cli-base";
import { createPikaClient, PIKA_PAGINATION, type ApiClient } from "../../api/client.js";
import {
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
  ApiError,
  type OutputFormat,
} from "../../output/formatter.js";
import {
  parsePaginationArgs,
  buildPaginationParams,
  type ParsedPaginationArgs,
} from "../../output/pagination.js";
import {
  sessionListColumns,
  type SessionListResponse,
} from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsList(
  args: ParsedPaginationArgs & {
    project?: string;
    source?: string;
    starred?: boolean;
    deleted?: boolean;
    from?: string;
    to?: string;
    sort?: string;
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  // Build pagination params using shared helper
  const params = buildPaginationParams(args);
  if (args.project) params.projectKey = args.project;
  if (args.source) params.source = args.source;
  if (args.starred) params.starred = "true";
  if (args.deleted) params.deleted = "true";
  if (args.from) params.from = args.from;
  if (args.to) params.to = args.to;
  if (args.sort) params.sort = args.sort;

  const response = await client.get<SessionListResponse>("/sessions", params);

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status
    );
  }

  const data = response.data!;

  // Output full envelope in json mode, items only in table/minimal
  formatter.response(
    { items: data.sessions, raw: data },
    { columns: sessionListColumns, minimalKey: "id" }
  );

  // Pagination hints to stderr in table mode only
  if (args.format === "table" && data.hasMore) {
    if (data.page != null) {
      formatter.info(
        `Page ${data.page} of ${Math.ceil(data.totalCount! / data.pageSize!)}. Use --page ${data.page + 1} to continue.`
      );
    } else if (data.cursor) {
      formatter.info(`More results available. Use --cursor ${data.cursor} to continue.`);
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
      description: "Filter by source (claude-code, codex, gemini, opencode, vscode-copilot)",
    },
    starred: {
      type: "boolean",
      description: "Show only starred sessions",
    },
    deleted: {
      type: "boolean",
      description: "Show only deleted sessions (trash)",
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
      description: "Sort by: last_message_at, started_at, total_messages, duration_seconds",
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
        PIKA_PAGINATION
      );

      await runSessionsList(
        {
          ...pagination,
          project: args.project,
          source: args.source,
          starred: args.starred,
          deleted: args.deleted,
          from: args.from,
          to: args.to,
          sort: args.sort,
          format,
        },
        { client, formatter }
      );
    }, formatter);
  },
});
