import { defineCommand } from "@nocoo/cli-base";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  type OutputFormat,
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
} from "../../output/formatter.js";
import { type TagsResponse, tagListColumns } from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runTagsList(
  _args: {
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.get<TagsResponse>("/tags");

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;

  formatter.response(
    { items: data.tags, raw: data },
    { columns: tagListColumns, minimalKey: "id" },
  );
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "list",
    description: "List all tags",
  },
  args: {
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

    await withErrorHandling(async () => {
      const client = createPikaClient(args.dev);
      await runTagsList({ format }, { client, formatter });
    }, formatter);
  },
});
