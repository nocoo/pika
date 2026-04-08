import { describe, expect, it, vi } from "vitest";
import { runProjectsList } from "./list.js";
import type { ApiClient, ApiResponse } from "../../api/client.js";
import { OutputFormatter } from "../../output/formatter.js";
import type { ProjectsResponse, ProjectItemRaw } from "./types.js";

function createMockClient(
  response: ProjectsResponse,
  error?: { status: number; error: string }
): ApiClient {
  return {
    get: vi.fn(async (): Promise<ApiResponse<ProjectsResponse>> => {
      if (error) {
        return { ok: false, status: error.status, error: error.error };
      }
      return { ok: true, status: 200, data: response };
    }),
  } as unknown as ApiClient;
}

function createMockFormatter(format: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const formatter = new OutputFormatter({
    format: format as "json" | "table" | "minimal",
    stdout: {
      write: (s: string) => {
        stdout.push(s);
        return true;
      },
    } as NodeJS.WritableStream,
    stderr: {
      write: (s: string) => {
        stderr.push(s);
        return true;
      },
    } as NodeJS.WritableStream,
  });

  return { formatter, stdout, stderr };
}

describe("projects list", () => {
  // API response uses snake_case fields
  const sampleResponse: ProjectsResponse = {
    overview: {
      totalProjects: 5,
      totalSessions: 100,
      totalMessages: 5000,
      totalInputTokens: 500000,
      totalOutputTokens: 250000,
    },
    projects: [
      {
        project_key: "pika",
        project_name: "Pika",
        project_refs: "/Users/nocoo/workspace/personal/pika",
        session_count: 50,
        total_messages: 2500,
        total_input_tokens: 250000,
        total_output_tokens: 125000,
        last_activity: "2026-04-08T10:00:00Z",
      },
      {
        project_key: "other-project",
        project_name: "Other",
        project_refs: "/Users/nocoo/workspace/other",
        session_count: 50,
        total_messages: 2500,
        total_input_tokens: 250000,
        total_output_tokens: 125000,
        last_activity: "2026-04-07T10:00:00Z",
      },
    ] as ProjectItemRaw[],
    sourceDistribution: {},
  };

  it("outputs projects in json format", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stdout } = createMockFormatter("json");

    await runProjectsList({ format: "json" }, { client, formatter });

    const output = stdout.join("");
    expect(output).toContain('"overview"');
    expect(output).toContain('"projects"');
    expect(output).toContain("pika");
  });

  it("outputs projects in minimal format", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stdout } = createMockFormatter("minimal");

    await runProjectsList({ format: "minimal" }, { client, formatter });

    expect(stdout.join("")).toBe("pika\nother-project\n");
  });

  it("shows overview in table mode", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stderr } = createMockFormatter("table");

    await runProjectsList({ format: "table" }, { client, formatter });

    expect(stderr.join("")).toContain("5 projects");
    expect(stderr.join("")).toContain("100 sessions");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient(sampleResponse, {
      status: 500,
      error: "Server error",
    });
    const { formatter } = createMockFormatter("json");

    await expect(
      runProjectsList({ format: "json" }, { client, formatter })
    ).rejects.toThrow("Server error");
  });
});
