import { defineCommand } from "@nocoo/cli-base";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  OutputFormatter,
  withErrorHandling,
} from "../../output/formatter.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsStar(
  args: {
    id: string;
    unstar: boolean;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.patch<{ starred: boolean }>(
    `/sessions/${args.id}/star`,
    { starred: !args.unstar },
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  if (args.unstar) {
    formatter.success(`Session ${args.id} unstarred`);
  } else {
    formatter.success(`Session ${args.id} starred`);
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "star",
    description: "Star or unstar a session",
  },
  args: {
    id: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    unstar: {
      type: "boolean",
      description: "Unstar instead of starring",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  async run({ args }) {
    const formatter = new OutputFormatter({ format: "table" });

    await withErrorHandling(async () => {
      const client = createPikaClient(args.dev);

      await runSessionsStar(
        { id: args.id, unstar: args.unstar ?? false },
        { client, formatter },
      );
    }, formatter);
  },
});
