import { defineCommand } from "@nocoo/cli-base";
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

interface AddSessionTagResponse {
  added: boolean;
  tagId: string;
}

export async function runTagsAdd(
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

  const response = await client.put<AddSessionTagResponse>(
    `/sessions/${args.sessionId}/tags`,
    body,
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;
  if (isUUID(args.tag)) {
    formatter.success(`Tag ${args.tag} added to session ${args.sessionId}`);
  } else {
    formatter.success(
      `Tag "${args.tag}" added to session ${args.sessionId} (id: ${data.tagId})`,
    );
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "add",
    description: "Add tag to session",
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

      await runTagsAdd(
        { sessionId: args.sessionId, tag: args.tag },
        { client, formatter },
      );
    }, formatter);
  },
});
