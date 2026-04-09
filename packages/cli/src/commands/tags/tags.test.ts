import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiResponse } from "../../api/client.js";
import { OutputFormatter } from "../../output/formatter.js";
import { runTagsAdd } from "./add.js";
import { runTagsCreate } from "./create.js";
import { runTagsList } from "./list.js";
import { runTagsRemove } from "./remove.js";
import type { TagCreateResponse, TagsResponse } from "./types.js";

function createMockClient<T = TagsResponse>(
  response?: T,
  error?: { status: number; error: string },
): ApiClient {
  const mockGet = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    return { ok: true, status: 200, data: response as T };
  });

  const mockPost = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    return { ok: true, status: 200, data: response as T };
  });

  const mockPut = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    return {
      ok: true,
      status: 200,
      data: { added: true, tagId: "tag_new" } as T,
    };
  });

  const mockDelete = vi.fn(async (): Promise<ApiResponse<T>> => {
    if (error) {
      return { ok: false, status: error.status, error: error.error };
    }
    return { ok: true, status: 204 };
  });

  return {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
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
      runTagsList({ format: "json" }, { client, formatter }),
    ).rejects.toThrow("Server error");
  });
});

// ─── tags create tests ────────────────────────────────────────

describe("tags create", () => {
  it("creates tag with name only", async () => {
    const response: TagCreateResponse = {
      id: "tag_new",
      name: "bug-fix",
      color: null,
    };
    const client = createMockClient(response);
    const { formatter, stderr } = createMockFormatter("table");

    await runTagsCreate({ name: "bug-fix" }, { client, formatter });

    expect(client.post).toHaveBeenCalledWith("/tags", { name: "bug-fix" });
    expect(stderr.join("")).toContain("bug-fix");
    expect(stderr.join("")).toContain("tag_new");
  });

  it("creates tag with color", async () => {
    const response: TagCreateResponse = {
      id: "tag_new",
      name: "bug-fix",
      color: "#ff6b6b",
    };
    const client = createMockClient(response);
    const { formatter } = createMockFormatter("table");

    await runTagsCreate(
      { name: "bug-fix", color: "#ff6b6b" },
      { client, formatter },
    );

    expect(client.post).toHaveBeenCalledWith("/tags", {
      name: "bug-fix",
      color: "#ff6b6b",
    });
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient(undefined, {
      status: 400,
      error: "Tag already exists",
    });
    const { formatter } = createMockFormatter("table");

    await expect(
      runTagsCreate({ name: "duplicate" }, { client, formatter }),
    ).rejects.toThrow("Tag already exists");
  });
});

// ─── tags add tests ───────────────────────────────────────────

describe("tags add", () => {
  it("adds tag to session by UUID", async () => {
    const client = createMockClient();
    const { formatter, stderr } = createMockFormatter("table");

    await runTagsAdd(
      { sessionId: "sess_123", tag: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
      { client, formatter },
    );

    expect(client.put).toHaveBeenCalledWith("/sessions/sess_123/tags", {
      tagId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(stderr.join("")).toContain("added");
  });

  it("adds tag to session by name", async () => {
    const client = createMockClient();
    const { formatter, stderr } = createMockFormatter("table");

    await runTagsAdd(
      { sessionId: "sess_123", tag: "bug-fix" },
      { client, formatter },
    );

    expect(client.put).toHaveBeenCalledWith("/sessions/sess_123/tags", {
      tagName: "bug-fix",
    });
    expect(stderr.join("")).toContain("added");
    expect(stderr.join("")).toContain("bug-fix");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient(undefined, {
      status: 404,
      error: "Session not found",
    });
    const { formatter } = createMockFormatter("table");

    await expect(
      runTagsAdd(
        { sessionId: "invalid", tag: "bug-fix" },
        { client, formatter },
      ),
    ).rejects.toThrow("Session not found");
  });
});

// ─── tags remove tests ────────────────────────────────────────

describe("tags remove", () => {
  it("removes tag from session by UUID", async () => {
    const client = createMockClient();
    const { formatter, stderr } = createMockFormatter("table");

    await runTagsRemove(
      { sessionId: "sess_123", tag: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
      { client, formatter },
    );

    expect(client.delete).toHaveBeenCalledWith("/sessions/sess_123/tags", {
      tagId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(stderr.join("")).toContain("removed");
  });

  it("removes tag from session by name", async () => {
    const client = createMockClient();
    const { formatter, stderr } = createMockFormatter("table");

    await runTagsRemove(
      { sessionId: "sess_123", tag: "bug-fix" },
      { client, formatter },
    );

    expect(client.delete).toHaveBeenCalledWith("/sessions/sess_123/tags", {
      tagName: "bug-fix",
    });
    expect(stderr.join("")).toContain("removed");
    expect(stderr.join("")).toContain("bug-fix");
  });

  it("throws ApiError on failure", async () => {
    const client = createMockClient(undefined, {
      status: 404,
      error: "Tag not found on session",
    });
    const { formatter } = createMockFormatter("table");

    await expect(
      runTagsRemove(
        { sessionId: "sess_123", tag: "invalid" },
        { client, formatter },
      ),
    ).rejects.toThrow("Tag not found on session");
  });
});
