/**
 * Worker tags route handlers tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { Env } from "./ingest";
import {
  handleAddSessionTag,
  handleCreateTag,
  handleDeleteTag,
  handleGetSessionTags,
  handleListTags,
  handleRemoveSessionTag,
  handleUpdateTag,
} from "./tags";

// ── Mock helpers ───────────────────────────────────────────────

function mockD1(opts?: {
  results?: unknown[];
  firstResult?: unknown;
  runMeta?: { changes: number };
  throwError?: Error;
}): D1Database {
  const {
    results = [],
    firstResult = null,
    runMeta = { changes: 1 },
    throwError,
  } = opts ?? {};

  const preparedStmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
    first: vi.fn().mockResolvedValue(firstResult),
    run: throwError
      ? vi.fn().mockRejectedValue(throwError)
      : vi.fn().mockResolvedValue({ meta: runMeta }),
  };

  return {
    prepare: vi.fn().mockReturnValue(preparedStmt),
    batch: vi.fn().mockResolvedValue(results.map((r) => ({ results: [r] }))),
  } as unknown as D1Database;
}

function mockEnv(dbOpts?: Parameters<typeof mockD1>[0]): Env {
  return {
    DB: mockD1(dbOpts),
    BUCKET: {} as R2Bucket,
  };
}

// ── handleListTags tests ───────────────────────────────────────

describe("handleListTags", () => {
  it("returns all tags for user", async () => {
    const tags = [
      { id: "t1", name: "bug", color: "#ff0000" },
      { id: "t2", name: "feature", color: "#00ff00" },
    ];
    const env = mockEnv({ results: tags });

    const res = await handleListTags("user-1", env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tags).toEqual(tags);
  });
});

// ── handleCreateTag tests ──────────────────────────────────────

describe("handleCreateTag", () => {
  it("creates a tag with name only", async () => {
    const env = mockEnv();

    const res = await handleCreateTag("user-1", { name: "new-tag" }, env);

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tag.name).toBe("new-tag");
    expect(body.tag.color).toBeNull();
    expect(body.tag.id).toBeDefined();
  });

  it("creates a tag with name and color", async () => {
    const env = mockEnv();

    const res = await handleCreateTag(
      "user-1",
      { name: "colored", color: "#ff6b6b" },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tag.name).toBe("colored");
    expect(body.tag.color).toBe("#ff6b6b");
  });

  it("returns 400 for missing name", async () => {
    const env = mockEnv();

    const res = await handleCreateTag("user-1", { color: "#ff0000" }, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toBeDefined();
    expect(body.error).toContain("name");
  });

  it("returns 400 for empty name", async () => {
    const env = mockEnv();

    const res = await handleCreateTag("user-1", { name: "   " }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for name too long", async () => {
    const env = mockEnv();
    const longName = "a".repeat(51);

    const res = await handleCreateTag("user-1", { name: longName }, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("50 characters");
  });

  it("returns 400 for invalid color format", async () => {
    const env = mockEnv();

    const res = await handleCreateTag(
      "user-1",
      { name: "test", color: "red" },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("color");
  });

  it("returns 409 for duplicate tag name (case-insensitive)", async () => {
    // findTagByName returns an existing tag with different casing
    const existingTag = {
      id: "existing-id",
      user_id: "user-1",
      name: "Existing",
      color: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const env = mockEnv({
      firstResult: existingTag, // findTagByName returns this
    });

    const res = await handleCreateTag("user-1", { name: "existing" }, env);

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("already exists");
    expect(body.error).toContain("case-insensitive");
  });

  it("returns 400 for invalid request body", async () => {
    const env = mockEnv();

    const res = await handleCreateTag("user-1", null, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 when name is a number type", async () => {
    const env = mockEnv();

    const res = await handleCreateTag("user-1", { name: 123 }, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("name");
  });
});

// ── handleUpdateTag tests ──────────────────────────────────────

describe("handleUpdateTag", () => {
  it("updates tag name", async () => {
    const updatedTag = {
      id: "tag-1",
      user_id: "user-1",
      name: "updated",
      color: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const db = mockD1({ runMeta: { changes: 1 } });
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    let callCount = 0;
    prepare.mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        callCount++;
        // First call: findTagByName returns null (no conflict)
        // Second call: fetch updated tag
        return Promise.resolve(callCount === 1 ? null : updatedTag);
      }),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }));
    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleUpdateTag(
      "user-1",
      "tag-1",
      { name: "updated" },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tag.name).toBe("updated");
  });

  it("updates tag color", async () => {
    const updatedTag = {
      id: "tag-1",
      user_id: "user-1",
      name: "test",
      color: "#0000ff",
      created_at: "2026-01-01T00:00:00Z",
    };
    const db = mockD1({ runMeta: { changes: 1 } });
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    prepare.mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(updatedTag), // fetch updated tag (no findTagByName for color-only update)
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }));
    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleUpdateTag(
      "user-1",
      "tag-1",
      { color: "#0000ff" },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tag).toBeDefined();
  });

  it("clears tag color with null", async () => {
    const updatedTag = {
      id: "tag-1",
      user_id: "user-1",
      name: "test",
      color: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const db = mockD1({ runMeta: { changes: 1 } });
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    prepare.mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(updatedTag), // fetch updated tag
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }));
    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleUpdateTag("user-1", "tag-1", { color: null }, env);

    expect(res.status).toBe(200);
  });

  it("returns 400 for no fields provided", async () => {
    const env = mockEnv();

    const res = await handleUpdateTag("user-1", "tag-1", {}, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("At least one field");
  });

  it("returns 404 when tag not found", async () => {
    const env = mockEnv({ runMeta: { changes: 0 } });

    const res = await handleUpdateTag(
      "user-1",
      "nonexistent",
      { name: "new" },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("returns 409 when rename conflicts with existing tag (case-insensitive)", async () => {
    // findTagByName returns a different tag with the same name (different casing)
    const conflictingTag = {
      id: "other-tag-id",
      user_id: "user-1",
      name: "Bug",
      color: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const env = mockEnv({
      firstResult: conflictingTag,
    });

    const res = await handleUpdateTag(
      "user-1",
      "tag-1", // Different from conflictingTag.id
      { name: "bug" },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("already exists");
    expect(body.error).toContain("case-insensitive");
  });

  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleUpdateTag("user-1", "tag-1", null, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for name too long", async () => {
    const env = mockEnv();
    const longName = "a".repeat(51);

    const res = await handleUpdateTag(
      "user-1",
      "tag-1",
      { name: longName },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("50 characters");
  });

  it("returns 400 for invalid color in update", async () => {
    const env = mockEnv();

    const res = await handleUpdateTag(
      "user-1",
      "tag-1",
      { color: "not-a-color" },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("color");
  });

  it("returns 400 for empty name string", async () => {
    const env = mockEnv();

    const res = await handleUpdateTag("user-1", "tag-1", { name: "" }, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("name");
  });
});

// ── handleDeleteTag tests ──────────────────────────────────────

describe("handleDeleteTag", () => {
  it("deletes a tag", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleDeleteTag("user-1", "tag-1", env);

    expect(res.status).toBe(204);
  });

  it("returns 404 when tag not found", async () => {
    const env = mockEnv({ runMeta: { changes: 0 } });

    const res = await handleDeleteTag("user-1", "nonexistent", env);

    expect(res.status).toBe(404);
  });
});

// ── handleGetSessionTags tests ─────────────────────────────────

describe("handleGetSessionTags", () => {
  it("returns tags for a session", async () => {
    const tags = [
      { id: "t1", name: "bug" },
      { id: "t2", name: "high-priority" },
    ];
    const env = mockEnv({
      firstResult: { id: "sess-1" }, // session lookup
      results: tags, // tags query
    });

    // Mock needs to return session first, then tags
    const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
    const firstPrepare = db.prepare();
    firstPrepare.first.mockResolvedValueOnce({ id: "sess-1" });
    firstPrepare.all.mockResolvedValueOnce({ results: tags });

    const res = await handleGetSessionTags("user-1", "sess-1", env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tags).toBeDefined();
  });

  it("returns 404 when session not found", async () => {
    const env = mockEnv({ firstResult: null });

    const res = await handleGetSessionTags("user-1", "nonexistent", env);

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("Session not found");
  });
});

// ── handleAddSessionTag tests ──────────────────────────────────

describe("handleAddSessionTag", () => {
  it("adds a tag to a session by tagId", async () => {
    const db = mockD1({
      firstResult: { id: "sess-1" },
    });
    // Override to return different results for session and tag lookups
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    prepare.mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi
        .fn()
        .mockResolvedValueOnce({ id: "sess-1" })
        .mockResolvedValueOnce({ id: "tag-1" }),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }));
    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleAddSessionTag(
      "user-1",
      "sess-1",
      { tagId: "tag-1" },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.added).toBe(true);
    expect(body.tagId).toBe("tag-1");
  });

  it("adds a tag to a session by tagName (existing tag)", async () => {
    const existingTag = {
      id: "found-tag-id",
      user_id: "user-1",
      name: "Bug",
      color: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const db = mockD1();
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    const bindMock = vi.fn().mockReturnThis();
    const firstMock = vi
      .fn()
      .mockResolvedValueOnce({ id: "sess-1" }) // session lookup
      .mockResolvedValueOnce(existingTag); // findTagByName
    const runMock = vi.fn().mockResolvedValue({ meta: { changes: 1 } });

    prepare.mockReturnValue({
      bind: bindMock,
      first: firstMock,
      run: runMock,
    });

    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleAddSessionTag(
      "user-1",
      "sess-1",
      { tagName: "bug" }, // lowercase, but matches "Bug"
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.added).toBe(true);
    expect(body.tagId).toBe("found-tag-id");
  });

  it("auto-creates tag when tagName not found", async () => {
    const db = mockD1();
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    let _capturedTagId: string | undefined;
    prepare.mockImplementation(() => ({
      bind: vi.fn((...args: unknown[]) => {
        // Capture the generated tag ID from INSERT
        if (
          typeof args[0] === "string" &&
          args[0].match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          )
        ) {
          _capturedTagId = args[0] as string;
        }
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi
            .fn()
            .mockResolvedValueOnce({ id: "sess-1" }) // session lookup
            .mockResolvedValueOnce(null), // findTagByName returns null
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        };
      }),
      first: vi
        .fn()
        .mockResolvedValueOnce({ id: "sess-1" }) // session lookup
        .mockResolvedValueOnce(null), // findTagByName returns null
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }));
    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleAddSessionTag(
      "user-1",
      "sess-1",
      { tagName: "new-tag" },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.added).toBe(true);
    expect(body.tagId).toBeDefined();
  });

  it("returns 400 when neither tagId nor tagName provided", async () => {
    const env = mockEnv();

    const res = await handleAddSessionTag("user-1", "sess-1", {}, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("Either tagId or tagName is required");
  });

  it("returns 404 when session not found", async () => {
    const env = mockEnv({ firstResult: null });

    const res = await handleAddSessionTag(
      "user-1",
      "nonexistent",
      { tagId: "tag-1" },
      env,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("Session not found");
  });

  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleAddSessionTag("user-1", "sess-1", null, env);

    expect(res.status).toBe(400);
  });

  it("returns 404 when tag not found by tagId", async () => {
    const db = mockD1();
    const prepare = db.prepare as ReturnType<typeof vi.fn>;
    let callCount = 0;
    prepare.mockImplementation(() => {
      callCount++;
      return {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          callCount === 1 ? { id: "sess-1" } : null, // session found, tag not found
        ),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
    });
    const env = { DB: db, BUCKET: {} as R2Bucket };

    const res = await handleAddSessionTag(
      "user-1",
      "sess-1",
      { tagId: "nonexistent-tag" },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("Tag not found");
  });

  it("returns 400 when tagId is empty string and tagName is falsy", async () => {
    const env = mockEnv();

    const res = await handleAddSessionTag(
      "user-1",
      "sess-1",
      { tagId: "", tagName: "" },
      env,
    );

    expect(res.status).toBe(400);
  });
});

// ── handleRemoveSessionTag tests ───────────────────────────────

describe("handleRemoveSessionTag", () => {
  it("removes a tag from a session by tagId", async () => {
    const env = mockEnv({ runMeta: { changes: 1 } });

    const res = await handleRemoveSessionTag(
      "user-1",
      "sess-1",
      { tagId: "tag-1" },
      env,
    );

    expect(res.status).toBe(204);
  });

  it("removes a tag from a session by tagName", async () => {
    const existingTag = {
      id: "found-tag-id",
      user_id: "user-1",
      name: "Bug",
      color: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const env = mockEnv({ firstResult: existingTag });

    const res = await handleRemoveSessionTag(
      "user-1",
      "sess-1",
      { tagName: "bug" }, // case-insensitive match
      env,
    );

    expect(res.status).toBe(204);
  });

  it("returns 404 when tagName not found", async () => {
    const env = mockEnv({ firstResult: null });

    const res = await handleRemoveSessionTag(
      "user-1",
      "sess-1",
      { tagName: "nonexistent" },
      env,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("Tag not found");
  });

  it("returns 400 when neither tagId nor tagName provided", async () => {
    const env = mockEnv();

    const res = await handleRemoveSessionTag("user-1", "sess-1", {}, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toContain("Either tagId or tagName is required");
  });

  it("returns 400 for invalid body", async () => {
    const env = mockEnv();

    const res = await handleRemoveSessionTag("user-1", "sess-1", null, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 when tagId and tagName are empty strings", async () => {
    const env = mockEnv();

    const res = await handleRemoveSessionTag(
      "user-1",
      "sess-1",
      { tagId: "", tagName: "" },
      env,
    );

    expect(res.status).toBe(400);
  });
});
