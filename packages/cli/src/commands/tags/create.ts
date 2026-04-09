import { defineCommand } from "@nocoo/cli-base";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  OutputFormatter,
  withErrorHandling,
} from "../../output/formatter.js";
import type { TagCreateResponse } from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runTagsCreate(
  args: {
    name: string;
    color?: string;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  const body: { name: string; color?: string } = { name: args.name };
  if (args.color) {
    body.color = args.color;
  }

  const response = await client.post<TagCreateResponse>("/tags", body);

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;
  formatter.success(`Tag "${data.name}" created (${data.id})`);
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a new tag",
  },
  args: {
    name: {
      type: "positional",
      description: "Tag name",
      required: true,
    },
    color: {
      type: "string",
      description: "Hex color (e.g. #ff6b6b)",
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

      await runTagsCreate(
        { name: args.name, color: args.color },
        { client, formatter },
      );
    }, formatter);
  },
});
