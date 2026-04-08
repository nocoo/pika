import { describe, expect, it, vi } from "vitest";
import { runSearch } from "./index.js";
import type { ApiClient, ApiResponse } from "../../api/client.js";
import { OutputFormatter } from "../../output/formatter.js";
import type { SearchResponse } from "./types.js";

function createMockClient(
  response: SearchResponse,
  error?: { status: number; error: string }
): ApiClient {
  return {
    get: vi.fn(async (): Promise<ApiResponse<SearchResponse>> => {
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

describe("search", () => {
  const sampleResponse: SearchResponse = {
    results: [
      {
        session_id: "sess_123",
        message_id: "msg_1",
        ordinal: 0,
        chunk_index: 0,
        content_snippet: "...the OAuth token was expiring...",
        tool_snippet: null,
        session_key: "claude-code/project/123",
        source: "claude-code",
        project_name: "pika",
        title: "Fix login bug",
        started_at: "2026-04-08T10:00:00Z",
      },
      {
        session_id: "sess_456",
        message_id: "msg_2",
        ordinal: 1,
        chunk_index: 0,
        content_snippet: "...moved token refresh to...",
        tool_snippet: null,
        session_key: "codex/project/456",
        source: "codex",
        project_name: "auth-service",
        title: "Auth refactor",
        started_at: "2026-04-07T10:00:00Z",
      },
    ],
    total: 2,
  };

  it("outputs results in json format", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stdout } = createMockFormatter("json");

    await runSearch(
      { query: "OAuth", format: "json" },
      { client, formatter }
    );

    const output = stdout.join("");
    expect(output).toContain('"results"');
    expect(output).toContain("sess_123");
    expect(output).toContain("OAuth token");
  });

  it("outputs results in minimal format", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stdout } = createMockFormatter("minimal");

    await runSearch(
      { query: "OAuth", format: "minimal" },
      { client, formatter }
    );

    expect(stdout.join("")).toBe("sess_123\nsess_456\n");
  });

  it("shows total count in table mode", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter, stderr } = createMockFormatter("table");

    await runSearch(
      { query: "OAuth", format: "table" },
      { client, formatter }
    );

    expect(stderr.join("")).toContain("Found 2 results");
  });

  it("passes query parameters to client", async () => {
    const client = createMockClient(sampleResponse);
    const { formatter } = createMockFormatter("json");

    await runSearch(
      {
        query: "OAuth",
        limit: 25,
        source: "claude-code",
        from: "2026-04-01",
        to: "2026-04-08",
        format: "json",
      },
      { client, formatter }
    );

    expect(client.get).toHaveBeenCalledWith(
      "/search",
      expect.objectContaining({
        q: "OAuth",
        limit: "25",
        source: "claude-code",
        from: "2026-04-01",
        to: "2026-04-08",
      })
    );
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient(sampleResponse, {
      status: 500,
      error: "Server error",
    });
    const { formatter } = createMockFormatter("json");

    await expect(
      runSearch({ query: "test", format: "json" }, { client, formatter })
    ).rejects.toThrow("Server error");
  });
});
