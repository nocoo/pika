import { defineCommand } from "@nocoo/base-cli";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  OutputFormatter,
  withErrorHandling,
} from "../../output/formatter.js";

// ─── API Response type ────────────────────────────────────────

interface EditResponse {
  id: string;
  title: string | null;
  description: string | null;
  updated_at: string;
}

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsEdit(
  args: {
    id: string;
    title?: string;
    description?: string;
    clearTitle: boolean;
    clearDescription: boolean;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  // Build request body
  const body: Record<string, string | null> = {};

  if (args.clearTitle) {
    body.title = null;
  } else if (args.title !== undefined) {
    body.title = args.title;
  }

  if (args.clearDescription) {
    body.description = null;
  } else if (args.description !== undefined) {
    body.description = args.description;
  }

  if (Object.keys(body).length === 0) {
    throw new Error(
      "No changes specified. Use --title, --description, --clear-title, or --clear-description",
    );
  }

  const response = await client.patch<EditResponse>(
    `/sessions/${args.id}`,
    body,
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;

  formatter.success(`Session ${data.id} updated`);
  if (data.title !== null) {
    formatter.info(`Title: ${data.title}`);
  }
  if (data.description !== null) {
    formatter.info(`Description: ${data.description}`);
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "edit",
    description: "Edit session title or description",
  },
  args: {
    id: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    title: {
      type: "string",
      description: "Set session title",
    },
    description: {
      type: "string",
      description: "Set session description (supports markdown)",
    },
    "clear-title": {
      type: "boolean",
      description: "Clear title (revert to auto-generated)",
    },
    "clear-description": {
      type: "boolean",
      description: "Clear description",
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

      await runSessionsEdit(
        {
          id: args.id,
          title: args.title,
          description: args.description,
          clearTitle: args["clear-title"] ?? false,
          clearDescription: args["clear-description"] ?? false,
        },
        { client, formatter },
      );
    }, formatter);
  },
});
