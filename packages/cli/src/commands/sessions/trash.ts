import { defineCommand } from "@nocoo/cli-base";
import { createPikaClient, type ApiClient } from "../../api/client.js";
import {
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
  ApiError,
} from "../../output/formatter.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsTrash(
  args: {
    id: string;
    restore: boolean;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.patch<{ deleted: boolean }>(
    `/sessions/${args.id}/trash`,
    { deleted: !args.restore }
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status
    );
  }

  if (args.restore) {
    formatter.success(`Session ${args.id} restored`);
  } else {
    formatter.success(`Session ${args.id} moved to trash`);
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "trash",
    description: "Soft-delete or restore a session",
  },
  args: {
    id: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    restore: {
      type: "boolean",
      description: "Restore a deleted session instead of deleting",
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

      await runSessionsTrash(
        { id: args.id, restore: args.restore ?? false },
        { client, formatter }
      );
    }, formatter);
  },
});
