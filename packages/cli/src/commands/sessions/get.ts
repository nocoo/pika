import { defineCommand } from "@nocoo/cli-base";
import { createPikaClient, type ApiClient } from "../../api/client.js";
import {
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
  ApiError,
  type OutputFormat,
} from "../../output/formatter.js";
import { sessionDetailColumns, type SessionRow } from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsGet(
  args: {
    id: string;
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.get<SessionRow>(`/sessions/${args.id}`);

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status
    );
  }

  const data = response.data!;

  if (args.format === "json") {
    formatter.json(data);
  } else {
    formatter.table([data], sessionDetailColumns);
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "get",
    description: "Get session details",
  },
  args: {
    id: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    format: {
      type: "string",
      description: "Output format: json, table, auto (default: auto)",
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

      await runSessionsGet(
        { id: args.id, format },
        { client, formatter }
      );
    }, formatter);
  },
});
