import { defineCommand } from "@nocoo/cli-base";
import { createPikaClient, type ApiClient } from "../../api/client.js";
import {
  OutputFormatter,
  withErrorHandling,
  ApiError,
} from "../../output/formatter.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runTagsRemove(
  args: {
    sessionId: string;
    tagId: string;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.delete(`/sessions/${args.sessionId}/tags`, {
    tagId: args.tagId,
  });

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status
    );
  }

  formatter.success(`Tag ${args.tagId} removed from session ${args.sessionId}`);
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "remove",
    description: "Remove tag from session",
  },
  args: {
    sessionId: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    tagId: {
      type: "positional",
      description: "Tag ID",
      required: true,
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

      await runTagsRemove(
        { sessionId: args.sessionId, tagId: args.tagId },
        { client, formatter }
      );
    }, formatter);
  },
});
