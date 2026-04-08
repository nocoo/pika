import { describe, expect, it, vi } from "vitest";
import { runSessionsList } from "./list.js";
import { runSessionsGet } from "./get.js";
import { runSessionsContent } from "./content.js";
import { runSessionsTrash } from "./trash.js";
import { runSessionsStar } from "./star.js";
import type { ApiClient, ApiResponse } from "../../api/client.js";
import { OutputFormatter } from "../../output/formatter.js";
import type {
  SessionRow,
  SessionListResponse,
  SessionContentResponse,
} from "./types.js";

// ─── Test utilities ───────────────────────────────────────────

interface MockResponse<T> {
  status?: number;
  data?: T;
}

function createMockClient<T>(
  responses: Record<string, T | MockResponse<T>>,
  error?: { status: number; error: string },
  patchResponse?: T
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
        return { ok: true, status: mockResp.status ?? 200, data: mockResp.data };
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

  return {
    get: mockGet,
    patch: mockPatch,
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
      { client, formatter }
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
      { client, formatter }
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
      { client, formatter }
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
      { client, formatter }
    );

    expect(stderr.join("")).not.toContain("--cursor");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient({}, { status: 500, error: "Server error" });
    const { formatter } = createMockFormatter("json");

    await expect(
      runSessionsList(
        { limit: 50, mode: "cursor", format: "json" },
        { client, formatter }
      )
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
    const client = createMockClient({ "/sessions/sess_123": { session: sampleSession } });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsGet(
      { id: "sess_123", format: "json" },
      { client, formatter }
    );

    const output = stdout.join("");
    expect(output).toContain("sess_123");
    expect(output).toContain("Fix login bug");
  });

  it("throws ApiError on 404", async () => {
    const client = createMockClient({}, { status: 404, error: "Not found" });
    const { formatter } = createMockFormatter("json");

    await expect(
      runSessionsGet({ id: "invalid", format: "json" }, { client, formatter })
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
      { client, formatter }
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
      { client, formatter }
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
      { client, formatter }
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
      { client, formatter }
    );

    const output = stdout.join("");
    const parsed = JSON.parse(output);
    expect(parsed.messages.every((m: { role: string }) => m.role !== "tool")).toBe(true);
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
      { client, formatter }
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
      { id: "sess_123", role: "all", noTools: false, offset: 2, format: "json" },
      { client, formatter }
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
      { client, formatter }
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
      { client, formatter }
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
      { client, formatter, stdout: mockStdout }
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
      { client, formatter, stdout: mockStdout }
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
      { client, formatter }
    );

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.messages[0].toolName).toBe("Read");
    expect(parsed.messages[0].toolInput).toBe('{"path":"auth.ts"}');
    expect(parsed.messages[0].toolResult).toBe("export function login() {}");
  });
});

// ─── sessions trash tests ─────────────────────────────────────

describe("sessions trash", () => {
  it("moves session to trash", async () => {
    const client = createMockClient(
      {},
      undefined,
      { deleted: true, deleted_at: "2026-04-08T10:00:00Z", affected: 1 }
    );
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsTrash(
      { id: "sess_123", restore: false },
      { client, formatter }
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123/trash", {
      deleted: true,
    });
    expect(stderr.join("")).toContain("moved to trash");
  });

  it("restores session from trash", async () => {
    const client = createMockClient(
      {},
      undefined,
      { deleted: false, deleted_at: null, affected: 1 }
    );
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsTrash(
      { id: "sess_123", restore: true },
      { client, formatter }
    );

    expect(client.patch).toHaveBeenCalledWith("/sessions/sess_123/trash", {
      deleted: false,
    });
    expect(stderr.join("")).toContain("restored");
  });

  it("throws ApiError when session not found (affected=0)", async () => {
    const client = createMockClient(
      {},
      undefined,
      { deleted: true, deleted_at: null, affected: 0 }
    );
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash({ id: "invalid", restore: false }, { client, formatter })
    ).rejects.toThrow("not found or already trashed");
  });

  it("throws ApiError when trying to restore non-trashed session", async () => {
    const client = createMockClient(
      {},
      undefined,
      { deleted: false, deleted_at: null, affected: 0 }
    );
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash({ id: "sess_123", restore: true }, { client, formatter })
    ).rejects.toThrow("not found or already restored");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient({}, { status: 500, error: "Server error" });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash({ id: "invalid", restore: false }, { client, formatter })
    ).rejects.toThrow("Server error");
  });
});

// ─── sessions star tests ──────────────────────────────────────

describe("sessions star", () => {
  it("stars session", async () => {
    const client = createMockClient({});
    const { formatter, stderr } = createMockFormatter("table");

    await runSessionsStar(
      { id: "sess_123", unstar: false },
      { client, formatter }
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
      { client, formatter }
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
      runSessionsStar({ id: "invalid", unstar: false }, { client, formatter })
    ).rejects.toThrow("Not found");
  });
});
