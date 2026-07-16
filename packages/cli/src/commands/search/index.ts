import { defineCommand } from "@nocoo/base-cli";
import {
  type ApiClient,
  createPikaClient,
  PIKA_PAGINATION,
} from "../../api/client.js";
import {
  ApiError,
  type OutputFormat,
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
} from "../../output/formatter.js";
import { type SearchResponse, searchResultColumns } from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runSearch(
  args: {
    query: string;
    limit?: number;
    source?: string;
    from?: string;
    to?: string;
    includeDeleted?: boolean;
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  const params: Record<string, string> = {
    q: args.query,
    limit: String(args.limit ?? PIKA_PAGINATION.defaultLimit),
  };
  if (args.source) params.source = args.source;
  if (args.from) params.from = args.from;
  if (args.to) params.to = args.to;
  if (args.includeDeleted) params.includeDeleted = "true";

  const response = await client.get<SearchResponse>("/search", params);

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;

  formatter.response(
    { items: data.results, raw: data },
    { columns: searchResultColumns, minimalKey: "session_id" },
  );

  if (args.format === "table") {
    formatter.info(`Found ${data.total} result${data.total === 1 ? "" : "s"}`);
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "search",
    description: "Full-text search across sessions",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    limit: {
      type: "string",
      description: "Maximum number of results (default: 50, max: 100)",
    },
    source: {
      type: "string",
      description: "Filter by source",
    },
    from: {
      type: "string",
      description: "Filter by last_message_at >= date (ISO 8601)",
    },
    to: {
      type: "string",
      description: "Filter by last_message_at <= date (ISO 8601)",
    },
    "include-deleted": {
      type: "boolean",
      description: "Include deleted sessions in search results",
    },
    format: {
      type: "string",
      description: "Output format: json, table, minimal, auto (default: auto)",
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

    const limit = args.limit ? parseInt(args.limit, 10) : undefined;

    await withErrorHandling(async () => {
      const client = createPikaClient(args.dev);

      await runSearch(
        {
          query: args.query,
          limit: Number.isNaN(limit!) ? undefined : limit,
          source: args.source,
          from: args.from,
          to: args.to,
          includeDeleted: args["include-deleted"],
          format,
        },
        { client, formatter },
      );
    }, formatter);
  },
});
