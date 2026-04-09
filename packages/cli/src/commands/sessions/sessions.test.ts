import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiResponse } from "../../api/client.js";
import { OutputFormatter } from "../../output/formatter.js";
import { runSessionsContent } from "./content.js";
import { runSessionsEdit } from "./edit.js";
import { runSessionsGet } from "./get.js";
import { runSessionsList } from "./list.js";
import { runSessionsStar } from "./star.js";
import { runSessionsTrash } from "./trash.js";
import type {
  SessionContentResponse,
  SessionListResponse,
  SessionRow,
} from "./types.js";

// ─── Test utilities ───────────────────────────────────────────

interface MockResponse<T> {
  status?: number;
  data?: T;
}

function createMockClient<T>(
  responses: Record<string, T | MockResponse<T>>,
  error?: { status: number; error: string },
  patchResponse?: T,
  postResponse?: T,
): ApiClient {
  const mockGet = vi.fn(async (path: string): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    const key = Object.keys(responses).find((k) => path.startsWith(k));
    if (key) {
      const response = responses[key];
      // Support explicit status/data for 204 etc
      if (response && typeof response === "object" && "status" in response) {
        const mockResp = response as MockResponse<T>;
        return {
          ok: true,
          status: mockResp.status ?? 200,
          data: mockResp.data,
        };
      }
      return { ok: true, status: 200, data: response as T };
    }
    return { ok: false, status: 404, error: "Not found" };
  });

  const mockPatch = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    // Use provided patchResponse or default to empty object with affected=1
    const data = patchResponse ?? ({ affected: 1 } as T);
    return { ok: true, status: 200, data };
  });

  const mockPost = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    const data = postResponse ?? ({ affected: 1 } as T);
    return { ok: true, status: 200, data };
  });

  return {
    get: mockGet,
    patch: mockPatch,
    post: mockPost,
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

// ─── sessions list tests ──────────────────────────────────────

describe("sessions list", () => {
  const sampleSession: SessionRow = {
    id: "sess_123",
    session_key: "claude-code/project/123",
    title: "Fix login bug",
    source: "claude-code",
    project_ref: "/path/to/project",
    project_name: "pika",
    started_at: "2026-04-08T10:00:00Z",
    last_message_at: "2026-04-08T11:00:00Z",
    total_messages: 42,
    user_messages: 15,
    assistant_messages: 27,
    total_input_tokens: 15000,
    total_output_tokens: 8000,
    total_cached_tokens: 2000,
    duration_seconds: 3600,
    is_starred: false,
    deleted_at: null,
  };

  it("outputs sessions in json format", async () => {
    const response: SessionListResponse = {
      sessions: [sampleSession],
      cursor: "next_cursor",
      hasMore: true,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "json" },
      { client, formatter },
    );

    const output = stdout.join("");
    expect(output).toContain('"sessions"');
    expect(output).toContain("sess_123");
    expect(output).toContain('"cursor": "next_cursor"');
  });

  it("outputs sessions in minimal format", async () => {
    const response: SessionListResponse = {
      sessions: [
        { ...sampleSession, id: "sess_1" },
        { ...sampleSession, id: "sess_2" },
      ],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter, stdout } = createMockFormatter("minimal");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "minimal" },
      { client, formatter },
    );

    expect(stdout.join("")).toBe("sess_1\nsess_2\n");
  });

  it("shows pagination hint in table mode only", async () => {
    const response: SessionListResponse = {
      sessions: [sampleSession],
      cursor: "next_cursor",
      hasMore: true,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "table" },
      { client, formatter },
    );

    expect(stderr.join("")).toContain("--cursor next_cursor");
  });

  it("does not show pagination hint in json mode", async () => {
    const response: SessionListResponse = {
      sessions: [sampleSession],
      cursor: "next_cursor",
      hasMore: true,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter, stderr } = createMockFormatter("json");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "json" },
      { client, formatter },
    );

    expect(stderr.join("")).not.toContain("--cursor");
  });

  it("passes filter parameters to client", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      {
        limit: 50,
        mode: "cursor",
        format: "json",
        project: "pika",
        source: "claude-code",
        starred: true,
        deleted: true,
        from: "2026-04-01",
        to: "2026-04-08",
        sort: "started_at",
      },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({
        projectKey: "pika",
        source: "claude-code",
        starred: "true",
        deleted: "true",
        from: "2026-04-01",
        to: "2026-04-08",
        sort: "started_at",
      }),
    );
  });

  it("passes model filter to client", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      {
        limit: 50,
        mode: "cursor",
        format: "json",
        model: "claude-sonnet-4-20250514",
      },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
      }),
    );
  });

  it("passes minMessages and maxMessages filters to client", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      {
        limit: 50,
        mode: "cursor",
        format: "json",
        minMessages: 10,
        maxMessages: 100,
      },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({
        minMessages: "10",
        maxMessages: "100",
      }),
    );
  });

  it("passes duration filters to client", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      {
        limit: 50,
        mode: "cursor",
        format: "json",
        minDuration: 300,
        maxDuration: 7200,
      },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({
        minDuration: "300",
        maxDuration: "7200",
      }),
    );
  });

  it("passes token filters to client", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      {
        limit: 50,
        mode: "cursor",
        format: "json",
        minInputTokens: 1000,
        maxInputTokens: 50000,
        minOutputTokens: 500,
        maxOutputTokens: 10000,
        minTotalTokens: 5000,
        maxTotalTokens: 100000,
      },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({
        minInputTokens: "1000",
        maxInputTokens: "50000",
        minOutputTokens: "500",
        maxOutputTokens: "10000",
        minTotalTokens: "5000",
        maxTotalTokens: "100000",
      }),
    );
  });

  it("normalizes source aliases", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    // Test "gemini" alias → "gemini-cli"
    await runSessionsList(
      { limit: 50, mode: "cursor", format: "json", source: "gemini" },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({ source: "gemini-cli" }),
    );
  });

  it("normalizes claude alias to claude-code", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "json", source: "claude" },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({ source: "claude-code" }),
    );
  });

  it("normalizes copilot alias to vscode-copilot", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await runSessionsList(
      { limit: 50, mode: "cursor", format: "json", source: "copilot" },
      { client, formatter },
    );

    expect(client.get).toHaveBeenCalledWith(
      "/sessions",
      expect.objectContaining({ source: "vscode-copilot" }),
    );
  });

  it("throws error for invalid source", async () => {
    const response: SessionListResponse = {
      sessions: [],
      cursor: null,
      hasMore: false,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter } = createMockFormatter("json");

    await expect(
      runSessionsList(
        { limit: 50, mode: "cursor", format: "json", source: "invalid-source" },
        { client, formatter },
      ),
    ).rejects.toThrow('Invalid source: "invalid-source"');
  });

  it("shows page-based pagination hint", async () => {
    const response: SessionListResponse = {
      sessions: [sampleSession],
      cursor: null,
      hasMore: true,
      page: 2,
      pageSize: 50,
      totalCount: 150,
    };
    const client = createMockClient({ "/sessions": response });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsList(
      { limit: 50, mode: "page", page: 2, format: "table" },
      { client, formatter },
    );

    expect(stderr.join("")).toContain("Page 2 of 3");
    expect(stderr.join("")).toContain("--page 3");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient({}, { status: 500, error: "Server error" });
    const { formatter } = createMockFormatter("json");

    await expect(
      runSessionsList(
        { limit: 50, mode: "cursor", format: "json" },
        { client, formatter },
      ),
    ).rejects.toThrow("Server error");
  });
});

// ─── sessions get tests ───────────────────────────────────────

describe("sessions get", () => {
  const sampleSession: SessionRow = {
    id: "sess_123",
    session_key: "claude-code/project/123",
    title: "Fix login bug",
    source: "claude-code",
    project_ref: "/path/to/project",
    project_name: "pika",
    started_at: "2026-04-08T10:00:00Z",
    last_message_at: "2026-04-08T11:00:00Z",
    total_messages: 42,
    user_messages: 15,
    assistant_messages: 27,
    total_input_tokens: 15000,
    total_output_tokens: 8000,
    total_cached_tokens: 2000,
    duration_seconds: 3600,
    is_starred: false,
    deleted_at: null,
  };

  it("outputs session in json format", async () => {
    const client = createMockClient({
      "/sessions/sess_123": { session: sampleSession },
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsGet(
      { id: "sess_123", format: "json" },
      { client, formatter },
    );

    const output = stdout.join("");
    expect(output).toContain("sess_123");
    expect(output).toContain("Fix login bug");
  });

  it("throws ApiError on 404", async () => {
    const client = createMockClient({}, { status: 404, error: "Not found" });
    const { formatter } = createMockFormatter("json");

    await expect(
      runSessionsGet({ id: "invalid", format: "json" }, { client, formatter }),
    ).rejects.toThrow("Not found");
  });
});

// ─── sessions content tests ───────────────────────────────────

describe("sessions content", () => {
  // Canonical format: content is always string, tool info in separate fields
  const sampleContent: SessionContentResponse = {
    messages: [
      {
        role: "user",
        content: "Fix the login bug",
        timestamp: "2026-04-08T10:00:00Z",
      },
      {
        role: "assistant",
        content: "I'll analyze the issue",
        timestamp: "2026-04-08T10:00:01Z",
      },
      {
        role: "tool",
        content: "export function login()",
        toolName: "Read",
        toolInput: '{"path":"auth.ts"}',
        toolResult: "export function login()",
        timestamp: "2026-04-08T10:00:02Z",
      },
      {
        role: "assistant",
        content: "Found the bug!",
        timestamp: "2026-04-08T10:00:03Z",
      },
    ],
  };

  it("outputs all messages in json format", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, format: "json" },
      { client, formatter },
    );

    const output = stdout.join("");
    expect(output).toContain("Fix the login bug");
    expect(output).toContain("tool");
    expect(output).toContain("Read");
  });

  it("filters by user role", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "user", noTools: false, format: "json" },
      { client, formatter },
    );

    const output = stdout.join("");
    expect(output).toContain("Fix the login bug");
    expect(output).not.toContain("I'll analyze");
    expect(output).not.toContain("Found the bug");
  });

  it("filters by assistant role", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "assistant", noTools: false, format: "json" },
      { client, formatter },
    );

    const output = stdout.join("");
    expect(output).toContain("I'll analyze");
    expect(output).toContain("Found the bug");
    expect(output).not.toContain("Fix the login bug");
  });

  it("excludes tool messages with noTools", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: true, format: "json" },
      { client, formatter },
    );

    const output = stdout.join("");
    const parsed = JSON.parse(output);
    expect(
      parsed.messages.every((m: { role: string }) => m.role !== "tool"),
    ).toBe(true);
    expect(output).toContain("I'll analyze");
    expect(output).toContain("Found the bug");
  });

  it("applies limit", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, limit: 2, format: "json" },
      { client, formatter },
    );

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.messages).toHaveLength(2);
  });

  it("applies offset", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      {
        id: "sess_123",
        role: "all",
        noTools: false,
        offset: 2,
        format: "json",
      },
      { client, formatter },
    );

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.messages).toHaveLength(2);
  });

  it("handles 204 No Content gracefully in json format", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": { status: 204, data: undefined },
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, format: "json" },
      { client, formatter },
    );

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.messages).toEqual([]);
  });

  it("handles 204 No Content gracefully in text format", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": { status: 204, data: undefined },
    });
    const { formatter, stderr } = createMockFormatter("text");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, format: "text" },
      { client, formatter },
    );

    expect(stderr.join("")).toContain("no content");
  });

  it("formats tool messages in plain text without markdown decorations", async () => {
    const contentWithTool: SessionContentResponse = {
      messages: [
        {
          role: "tool",
          content: "",
          toolName: "Read",
          toolInput: '{"path":"auth.ts"}',
          toolResult: "export function login() {}",
          timestamp: "2026-04-08T10:00:00Z",
        },
      ],
    };
    const client = createMockClient({
      "/sessions/sess_123/content": contentWithTool,
    });
    const { formatter } = createMockFormatter("text");
    const textOutput: string[] = [];
    const mockStdout = {
      write: (s: string) => {
        textOutput.push(s);
        return true;
      },
    } as NodeJS.WritableStream;

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, format: "text" },
      { client, formatter, stdout: mockStdout },
    );

    const output = textOutput.join("");
    // Should use plain text format [Read] not markdown **Read**
    expect(output).toContain("[Read]");
    expect(output).not.toContain("**Read**");
    expect(output).toContain("Input:");
    expect(output).toContain("Result:");
  });

  it("formats tool messages in markdown with bold decorations", async () => {
    const contentWithTool: SessionContentResponse = {
      messages: [
        {
          role: "tool",
          content: "",
          toolName: "Read",
          toolInput: '{"path":"auth.ts"}',
          toolResult: "export function login() {}",
          timestamp: "2026-04-08T10:00:00Z",
        },
      ],
    };
    const client = createMockClient({
      "/sessions/sess_123/content": contentWithTool,
    });
    const { formatter } = createMockFormatter("markdown");
    const mdOutput: string[] = [];
    const mockStdout = {
      write: (s: string) => {
        mdOutput.push(s);
        return true;
      },
    } as NodeJS.WritableStream;

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, format: "markdown" },
      { client, formatter, stdout: mockStdout },
    );

    const output = mdOutput.join("");
    // Should use markdown format with ## headers and **bold**
    expect(output).toContain("## Tool");
    expect(output).toContain("**Read**");
    expect(output).toContain("Input:");
    expect(output).toContain("Result:");
  });

  it("formats tool messages correctly in json output", async () => {
    const contentWithTool: SessionContentResponse = {
      messages: [
        {
          role: "tool",
          content: "",
          toolName: "Read",
          toolInput: '{"path":"auth.ts"}',
          toolResult: "export function login() {}",
          timestamp: "2026-04-08T10:00:00Z",
        },
      ],
    };
    const client = createMockClient({
      "/sessions/sess_123/content": contentWithTool,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: false, format: "json" },
      { client, formatter },
    );

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.messages[0].toolName).toBe("Read");
    expect(parsed.messages[0].toolInput).toBe('{"path":"auth.ts"}');
    expect(parsed.messages[0].toolResult).toBe("export function login() {}");
  });
});

// ─── sessions edit tests ──────────────────────────────────────

describe("sessions edit", () => {
  it("updates session title", async () => {
    const client = createMockClient({}, undefined, {
      id: "sess_123",
      title: "New Title",
      description: null,
      updated_at: "2026-04-08T10:00:00Z",
    });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsEdit(
      {
        id: "sess_123",
        title: "New Title",
        clearTitle: false,
        clearDescription: false,
      },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123", {
      title: "New Title",
    });
    expect(stderr.join("")).toContain("updated");
    expect(stderr.join("")).toContain("New Title");
  });

  it("updates session description", async () => {
    const client = createMockClient({}, undefined, {
      id: "sess_123",
      title: null,
      description: "A detailed description",
      updated_at: "2026-04-08T10:00:00Z",
    });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsEdit(
      {
        id: "sess_123",
        description: "A detailed description",
        clearTitle: false,
        clearDescription: false,
      },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123", {
      description: "A detailed description",
    });
    expect(stderr.join("")).toContain("updated");
  });

  it("clears title with --clear-title", async () => {
    const client = createMockClient({}, undefined, {
      id: "sess_123",
      title: null,
      description: null,
      updated_at: "2026-04-08T10:00:00Z",
    });
    const { formatter } = createMockFormatter("table");

    await runSessionsEdit(
      {
        id: "sess_123",
        clearTitle: true,
        clearDescription: false,
      },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123", {
      title: null,
    });
  });

  it("clears description with --clear-description", async () => {
    const client = createMockClient({}, undefined, {
      id: "sess_123",
      title: null,
      description: null,
      updated_at: "2026-04-08T10:00:00Z",
    });
    const { formatter } = createMockFormatter("table");

    await runSessionsEdit(
      {
        id: "sess_123",
        clearTitle: false,
        clearDescription: true,
      },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123", {
      description: null,
    });
  });

  it("throws error when no changes specified", async () => {
    const client = createMockClient({});
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsEdit(
        {
          id: "sess_123",
          clearTitle: false,
          clearDescription: false,
        },
        { client, formatter },
      ),
    ).rejects.toThrow("No changes specified");
  });

  it("throws ApiError on 404", async () => {
    const client = createMockClient({}, { status: 404, error: "Not found" });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsEdit(
        {
          id: "invalid",
          title: "New Title",
          clearTitle: false,
          clearDescription: false,
        },
        { client, formatter },
      ),
    ).rejects.toThrow("Not found");
  });
});

// ─── sessions trash tests ─────────────────────────────────────

describe("sessions trash", () => {
  it("moves single session to trash", async () => {
    const client = createMockClient({}, undefined, {
      deleted: true,
      deleted_at: "2026-04-08T10:00:00Z",
      affected: 1,
    });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsTrash(
      { ids: ["sess_123"], restore: false },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123/trash", {
      deleted: true,
    });
    expect(stderr.join("")).toContain("moved to trash");
  });

  it("restores single session from trash", async () => {
    const client = createMockClient({}, undefined, {
      deleted: false,
      deleted_at: null,
      affected: 1,
    });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsTrash(
      { ids: ["sess_123"], restore: true },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123/trash", {
      deleted: false,
    });
    expect(stderr.join("")).toContain("restored");
  });

  it("batch trashes multiple sessions", async () => {
    const client = createMockClient({}, undefined, undefined, { affected: 3 });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsTrash(
      { ids: ["sess_1", "sess_2", "sess_3"], restore: false },
      { client, formatter },
    );

    expect(client.post).toHaveBeenCalledWith("/sessions/batch", {
      action: "delete",
      ids: ["sess_1", "sess_2", "sess_3"],
    });
    expect(stderr.join("")).toContain("3 session(s) moved to trash");
  });

  it("batch restores multiple sessions", async () => {
    const client = createMockClient({}, undefined, undefined, { affected: 2 });
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsTrash(
      { ids: ["sess_1", "sess_2"], restore: true },
      { client, formatter },
    );

    expect(client.post).toHaveBeenCalledWith("/sessions/batch", {
      action: "restore",
      ids: ["sess_1", "sess_2"],
    });
    expect(stderr.join("")).toContain("2 session(s) restored");
  });

  it("throws ApiError when single session not found (affected=0)", async () => {
    const client = createMockClient({}, undefined, {
      deleted: true,
      deleted_at: null,
      affected: 0,
    });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash(
        { ids: ["invalid"], restore: false },
        { client, formatter },
      ),
    ).rejects.toThrow("not found or already trashed");
  });

  it("throws ApiError when batch affected=0", async () => {
    const client = createMockClient({}, undefined, undefined, { affected: 0 });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash(
        { ids: ["invalid1", "invalid2"], restore: false },
        { client, formatter },
      ),
    ).rejects.toThrow("No sessions were trashed");
  });

  it("throws ApiError when trying to restore non-trashed session", async () => {
    const client = createMockClient({}, undefined, {
      deleted: false,
      deleted_at: null,
      affected: 0,
    });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash(
        { ids: ["sess_123"], restore: true },
        { client, formatter },
      ),
    ).rejects.toThrow("not found or already restored");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient({}, { status: 500, error: "Server error" });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash(
        { ids: ["invalid"], restore: false },
        { client, formatter },
      ),
    ).rejects.toThrow("Server error");
  });

  it("throws error when no IDs provided", async () => {
    const client = createMockClient({});
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash({ ids: [], restore: false }, { client, formatter }),
    ).rejects.toThrow("At least one session ID is required");
  });
});

// ─── sessions star tests ──────────────────────────────────────

describe("sessions star", () => {
  it("stars session", async () => {
    const client = createMockClient({});
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsStar(
      { id: "sess_123", unstar: false },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123/star", {
      starred: true,
    });
    expect(stderr.join("")).toContain("starred");
    expect(stderr.join("")).not.toContain("unstarred");
  });

  it("unstars session", async () => {
    const client = createMockClient({});
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsStar(
      { id: "sess_123", unstar: true },
      { client, formatter },
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123/star", {
      starred: false,
    });
    expect(stderr.join("")).toContain("unstarred");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient({}, { status: 404, error: "Not found" });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsStar({ id: "invalid", unstar: false }, { client, formatter }),
    ).rejects.toThrow("Not found");
  });
});
