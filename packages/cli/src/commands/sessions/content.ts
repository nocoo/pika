import { defineCommand } from "@nocoo/base-cli";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  type OutputFormat,
  OutputFormatter,
  withErrorHandling,
} from "../../output/formatter.js";
import type { CanonicalMessage, SessionContentResponse } from "./types.js";

// ─── Content filtering ────────────────────────────────────────

type RoleFilter = "user" | "assistant" | "all";

interface FilterOptions {
  role: RoleFilter;
  noTools: boolean;
  limit?: number;
  offset?: number;
}

function filterMessages(
  messages: CanonicalMessage[],
  options: FilterOptions,
): CanonicalMessage[] {
  let result = messages;

  // Filter by role
  if (options.role !== "all") {
    result = result.filter((m) => m.role === options.role);
  }

  // Exclude tool messages if requested
  if (options.noTools) {
    result = result.filter((m) => m.role !== "tool");
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

// ─── Content formatting ───────────────────────────────────────

function formatAsText(messages: CanonicalMessage[]): string {
  return messages.map((m) => formatToolMessagePlain(m)).join("\n\n");
}

function formatAsMarkdown(messages: CanonicalMessage[]): string {
  return messages
    .map((m) => {
      const roleHeader = formatRoleHeader(m.role);
      return `${roleHeader}\n${formatToolMessageMarkdown(m)}`;
    })
    .join("\n\n");
}

/** Plain text formatting for tool messages (no markdown decorations) */
function formatToolMessagePlain(message: CanonicalMessage): string {
  if (message.role === "tool") {
    const parts: string[] = [];
    if (message.toolName) {
      parts.push(`[${message.toolName}]`);
    }
    if (message.toolInput) {
      parts.push(`Input: ${message.toolInput}`);
    }
    if (message.toolResult) {
      parts.push(`Result: ${message.toolResult}`);
    }
    if (parts.length === 0 && message.content) {
      return message.content;
    }
    return parts.join("\n");
  }
  return message.content;
}

/** Markdown formatting for tool messages */
function formatToolMessageMarkdown(message: CanonicalMessage): string {
  if (message.role === "tool") {
    const parts: string[] = [];
    if (message.toolName) {
      parts.push(`**${message.toolName}**`);
    }
    if (message.toolInput) {
      parts.push(`Input: ${message.toolInput}`);
    }
    if (message.toolResult) {
      parts.push(`Result: ${message.toolResult}`);
    }
    if (parts.length === 0 && message.content) {
      return message.content;
    }
    return parts.join("\n");
  }
  return message.content;
}

function formatRoleHeader(role: CanonicalMessage["role"]): string {
  switch (role) {
    case "user":
      return "## User";
    case "assistant":
      return "## Assistant";
    case "tool":
      return "## Tool";
    case "system":
      return "## System";
  }
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
    stdout?: NodeJS.WritableStream;
  },
): Promise<void> {
  const { client, formatter, stdout = process.stdout } = deps;

  const response = await client.get<SessionContentResponse>(
    `/sessions/${args.id}/content`,
  );

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  // Handle 204 No Content — session exists but has no canonical content yet
  if (response.status === 204 || !response.data) {
    switch (args.format) {
      case "json":
        formatter.json({ messages: [] });
        break;
      case "text":
      case "markdown":
        formatter.info("Session has no content");
        break;
      default:
        formatter.json({ messages: [] });
    }
    return;
  }

  const data = response.data;

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
      stdout.write(`${formatAsText(filteredMessages)}\n`);
      break;
    case "markdown":
      stdout.write(`${formatAsMarkdown(filteredMessages)}\n`);
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
          limit: Number.isNaN(limit!) ? undefined : limit,
          offset: Number.isNaN(offset!) ? undefined : offset,
          format,
        },
        { client, formatter },
      );
    }, formatter);
  },
});
