import { describe, expect, it, vi } from "vitest";
import { runTagsList } from "./list.js";
import type { ApiClient, ApiResponse } from "../../api/client.js";
import { OutputFormatter } from "../../output/formatter.js";
import type { TagsResponse } from "./types.js";

function createMockClient(
  response: TagsResponse,
  error?: { status: number; error: string }
): ApiClient {
  return {
    get: vi.fn(async (): Promise<ApiResponse<TagsResponse>> => {
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

describe("tags list", () => {
  const sampleResponse: TagsResponse = {
    tags: [
      {
        id: "tag_123",
        name: "bug-fix",
        color: "#ff6b6b",
        created_at: "2026-04-08T10:00:00Z",
      },
      {
        id: "tag_456",
        name: "feature",
        color: "#4ecdc4",
        created_at: "2026-04-07T10:00:00Z",
      },
    ],
  };

  it("outputs tags in json format", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stdout } = createMockFormatter("json");

    await runTagsList({ format: "json" }, { client, formatter });

    const output = stdout.join("");
    expect(output).toContain('"tags"');
    expect(output).toContain("tag_123");
    expect(output).toContain("bug-fix");
  });

  it("outputs tags in minimal format", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stdout } = createMockFormatter("minimal");

    await runTagsList({ format: "minimal" }, { client, formatter });

    expect(stdout.join("")).toBe("tag_123\ntag_456\n");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient(sampleResponse, {
      status: 500,
      error: "Server error",
    });
    const { formatter } = createMockFormatter("json");

    await expect(
      runTagsList({ format: "json" }, { client, formatter })
    ).rejects.toThrow("Server error");
  });
});
