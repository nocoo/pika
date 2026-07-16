import { defineCommand } from "@nocoo/base-cli";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  OutputFormatter,
  withErrorHandling,
} from "../../output/formatter.js";

// ─── Helpers ──────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ─── Core logic ───────────────────────────────────────────────

export async function runTagsRemove(
  args: {
    sessionId: string;
    tag: string; // Can be tag name or UUID
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  // Determine if it's a UUID or tag name
  const body = isUUID(args.tag) ? { tagId: args.tag } : { tagName: args.tag };

  const response = await client.delete(
    `/sessions/${args.sessionId}/tags`,
    body,
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  formatter.success(`Tag "${args.tag}" removed from session ${args.sessionId}`);
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
    tag: {
      type: "positional",
      description: "Tag name or UUID",
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
        { sessionId: args.sessionId, tag: args.tag },
        { client, formatter },
      );
    }, formatter);
  },
});
