import { defineCommand } from "@nocoo/cli-base";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  OutputFormatter,
  withErrorHandling,
} from "../../output/formatter.js";

// ─── API Response types ───────────────────────────────────────

interface TrashResponse {
  deleted: boolean;
  deleted_at: string | null;
  affected: number;
}

interface BatchResponse {
  affected: number;
}

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsTrash(
  args: {
    ids: string[];
    restore: boolean;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  if (args.ids.length === 0) {
    throw new Error("At least one session ID is required");
  }

  // Single ID: use existing PATCH endpoint
  if (args.ids.length === 1) {
    const response = await client.patch<TrashResponse>(
      `/sessions/${args.ids[0]}/trash`,
      { deleted: !args.restore },
    );

    if (!response.ok) {
      throw new ApiError(
        response.error ?? `API error: ${response.status}`,
        response.status,
      );
    }

    const data = response.data!;

    // Worker returns affected=0 when session not found or already in desired state
    if (data.affected === 0) {
      throw new ApiError(
        `Session ${args.ids[0]} not found or already ${args.restore ? "restored" : "trashed"}`,
        404,
      );
    }

    if (args.restore) {
      formatter.success(`Session ${args.ids[0]} restored`);
    } else {
      formatter.success(`Session ${args.ids[0]} moved to trash`);
    }
    return;
  }

  // Multiple IDs: use batch endpoint
  const action = args.restore ? "restore" : "delete";
  const response = await client.post<BatchResponse>("/sessions/batch", {
    action,
    ids: args.ids,
  });

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;

  if (data.affected === 0) {
    throw new ApiError(
      `No sessions were ${args.restore ? "restored" : "trashed"} (not found or already in desired state)`,
      404,
    );
  }

  if (args.restore) {
    formatter.success(`${data.affected} session(s) restored`);
  } else {
    formatter.success(`${data.affected} session(s) moved to trash`);
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "trash",
    description: "Soft-delete or restore sessions",
  },
  args: {
    ids: {
      type: "positional",
      description: "Session ID(s)",
      required: true,
    },
    restore: {
      type: "boolean",
      description: "Restore deleted sessions instead of deleting",
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

      // args.ids can be a string (single) or array (variadic)
      const ids = Array.isArray(args.ids) ? args.ids : [args.ids];

      await runSessionsTrash(
        { ids, restore: args.restore ?? false },
        { client, formatter },
      );
    }, formatter);
  },
});
