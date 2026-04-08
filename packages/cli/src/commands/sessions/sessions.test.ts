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

function createMockClient<T>(
  responses: Record<string, T>,
  error?: { status: number; error: string }
): ApiClient {
  const mockGet = vi.fn(async (path: string): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    const key = Object.keys(responses).find((k) => path.startsWith(k));
    if (key) {
      return { ok: true, status: 200, data: responses[key] };
    }
    return { ok: false, status: 404, error: "Not found" };
  });

  const mockPatch = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    return { ok: true, status: 200, data: {} as T };
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
  const sampleContent: SessionContentResponse = {
    messages: [
      { role: "user", content: "Fix the login bug" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll analyze the issue" },
          { type: "tool_use", name: "Read", input: { path: "auth.ts" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", content: "export function login()" }],
      },
      { role: "assistant", content: "Found the bug!" },
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
    expect(output).toContain("tool_use");
    expect(output).toContain("tool_result");
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

  it("strips tool blocks with noTools", async () => {
    const client = createMockClient({
      "/sessions/sess_123/content": sampleContent,
    });
    const { formatter, stdout } = createMockFormatter("json");

    await runSessionsContent(
      { id: "sess_123", role: "all", noTools: true, format: "json" },
      { client, formatter }
    );

    const output = stdout.join("");
    expect(output).not.toContain("tool_use");
    expect(output).not.toContain("tool_result");
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
});

// ─── sessions trash tests ─────────────────────────────────────

describe("sessions trash", () => {
  it("moves session to trash", async () => {
    const client = createMockClient({});
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
    const client = createMockClient({});
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

  it("throws ApiError on failure", async () => {
    const client = createMockClient({}, { status: 404, error: "Not found" });
    const { formatter } = createMockFormatter("table");

    await expect(
      runSessionsTrash({ id: "invalid", restore: false }, { client, formatter })
    ).rejects.toThrow("Not found");
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
