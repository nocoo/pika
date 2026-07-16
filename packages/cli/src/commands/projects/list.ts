import { defineCommand } from "@nocoo/base-cli";
import { type ApiClient, createPikaClient } from "../../api/client.js";
import {
  ApiError,
  type OutputFormat,
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
} from "../../output/formatter.js";
import {
  normalizeProject,
  type ProjectsResponse,
  projectListColumns,
} from "./types.js";

// ─── Core logic ───────────────────────────────────────────────

export async function runProjectsList(
  args: {
    format: OutputFormat;
  },
  deps: {
    client: ApiClient;
    formatter: OutputFormatter;
  },
): Promise<void> {
  const { client, formatter } = deps;

  const response = await client.get<ProjectsResponse>("/projects");

  if (!response.ok) {
    throw new ApiError(
      response.error ?? `API error: ${response.status}`,
      response.status,
    );
  }

  const data = response.data!;

  // Normalize snake_case to camelCase for display
  const projects = data.projects.map(normalizeProject);

  // Output full envelope in json mode, projects table in table mode
  formatter.response(
    { items: projects, raw: data },
    { columns: projectListColumns, minimalKey: "projectKey" },
  );

  // Show overview stats in table mode
  if (args.format === "table") {
    const { overview } = data;
    formatter.info(
      `Total: ${overview.totalProjects} projects, ${overview.totalSessions} sessions, ${overview.totalMessages} messages`,
    );
  }
}

// ─── Command definition ───────────────────────────────────────

export default defineCommand({
  meta: {
    name: "list",
    description: "List projects with stats",
  },
  args: {
    format: {
      type: "string",
      description: "Output format: json, table, minimal, auto (default: auto)",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  async run({ args }) {
    const format = resolveFormat(args.format);
    const formatter = new OutputFormatter({ format });

    await withErrorHandling(async () => {
      const client = createPikaClient(args.dev);
      await runProjectsList({ format }, { client, formatter });
    }, formatter);
  },
});
