import { defineCommand } from "@nocoo/cli-base";
import { createPikaClient, type ApiClient } from "../../api/client.js";
import {
  OutputFormatter,
  withErrorHandling,
  ApiError,
  type OutputFormat,
} from "../../output/formatter.js";
import type { SessionContentResponse, ContentMessage, ContentBlock } from "./types.js";

// ─── Content filtering ────────────────────────────────────────

type RoleFilter = "user" | "assistant" | "all";

interface FilterOptions {
  role: RoleFilter;
  noTools: boolean;
  limit?: number;
  offset?: number;
}

function filterMessages(
  messages: ContentMessage[],
  options: FilterOptions
): ContentMessage[] {
  let result = messages;

  // Filter by role
  if (options.role !== "all") {
    result = result.filter((m) => m.role === options.role);
  }

  // Strip tool calls if requested
  if (options.noTools) {
    result = result
      .map((m) => stripToolBlocks(m))
      .filter((m) => hasContent(m));
  }

  // Apply offset/limit
  const offset = options.offset ?? 0;
  if (offset > 0) {
    result = result.slice(offset);
  }
  if (options.limit !== undefined) {
    result = result.slice(0, options.limit);
  }

  return result;
}

function stripToolBlocks(message: ContentMessage): ContentMessage {
  if (typeof message.content === "string") {
    return message;
  }

  const filteredBlocks = message.content.filter(
    (block) => block.type !== "tool_use" && block.type !== "tool_result"
  );

  return {
    ...message,
    content: filteredBlocks,
  };
}

function hasContent(message: ContentMessage): boolean {
  if (typeof message.content === "string") {
    return message.content.length > 0;
  }
  return message.content.length > 0;
}

// ─── Content formatting ───────────────────────────────────────

function formatAsText(messages: ContentMessage[]): string {
  return messages.map((m) => extractText(m)).join("\n\n");
}

function formatAsMarkdown(messages: ContentMessage[]): string {
  return messages
    .map((m) => {
      const roleHeader = m.role === "user" ? "## User" : "## Assistant";
      return `${roleHeader}\n${extractText(m)}`;
    })
    .join("\n\n");
}

function extractText(message: ContentMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

// ─── Core logic ───────────────────────────────────────────────

export async function runSessionsContent(
  args: {
    id: string;
    role: RoleFilter;
    noTools: boolean;
    limit?: number;
    offset?: number;
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  }
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.get<SessionContentResponse>(
    `/sessions/${args.id}/content`
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status
    );
  }

  const data = response.data!;

  // Apply filters
  const filteredMessages = filterMessages(data.messages, {
    role: args.role,
    noTools: args.noTools,
    limit: args.limit,
    offset: args.offset,
  });

  // Output based on format
  switch (args.format) {
    case "json":
      formatter.json({ messages: filteredMessages });
      break;
    case "text":
      process.stdout.write(formatAsText(filteredMessages) + "\n");
      break;
    case "markdown":
      process.stdout.write(formatAsMarkdown(filteredMessages) + "\n");
      break;
    default:
      formatter.json({ messages: filteredMessages });
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "content",
    description: "Get session content (messages)",
  },
  args: {
    id: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    role: {
      type: "string",
      description: "Filter by role: user, assistant, all (default: all)",
    },
    "no-tools": {
      type: "boolean",
      description: "Exclude tool calls and tool results from output",
    },
    limit: {
      type: "string",
      description: "Limit to first N messages (after filtering)",
    },
    offset: {
      type: "string",
      description: "Skip first N messages (after filtering)",
    },
    format: {
      type: "string",
      description: "Output format: json, text, markdown (default: json)",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  async run({ args }) {
    const format = (args.format ?? "json") as OutputFormat;
    const formatter = new OutputFormatter({ format });

    // Parse role
    let role: RoleFilter = "all";
    if (args.role === "user" || args.role === "assistant") {
      role = args.role;
    }

    // Parse limit/offset
    const limit = args.limit ? parseInt(args.limit, 10) : undefined;
    const offset = args.offset ? parseInt(args.offset, 10) : undefined;

    await withErrorHandling(async () => {
      const client = createPikaClient(args.dev);

      await runSessionsContent(
        {
          id: args.id,
          role,
          noTools: args["no-tools"] ?? false,
          limit: isNaN(limit!) ? undefined : limit,
          offset: isNaN(offset!) ? undefined : offset,
          format,
        },
        { client, formatter }
      );
    }, formatter);
  },
});
