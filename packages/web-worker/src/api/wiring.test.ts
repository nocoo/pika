/**
 * Wiring tests for in-process /api/* Hono subapps.
 *
 * Each suite mocks the corresponding data/* handler and asserts that the
 * Hono route reads userId from the context, parses path params correctly,
 * and forwards the call. The actual data-layer logic is covered by the
 * data/*.test.ts suites.
 */

import { Hono } from "hono";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../lib/env";

// ── mocks (factories must be hoist-safe) ──────────────────────

vi.mock("../data/sessions", () => ({
  handleListSessions: vi.fn(),
  handleGetSession: vi.fn(),
  handleGetSessionContent: vi.fn(),
  handleFilters: vi.fn(),
  handleSetStar: vi.fn(),
  handleTrashSession: vi.fn(),
  handleUpdateSession: vi.fn(),
  handleBatchOperation: vi.fn(),
  handleConfirmRaw: vi.fn(),
}));
vi.mock("../data/tags", () => ({
  handleListTags: vi.fn(),
  handleCreateTag: vi.fn(),
  handleUpdateTag: vi.fn(),
  handleDeleteTag: vi.fn(),
  handleGetSessionTags: vi.fn(),
  handleAddSessionTag: vi.fn(),
  handleRemoveSessionTag: vi.fn(),
}));
vi.mock("../data/projects", () => ({
  handleListProjects: vi.fn(),
  handleProjectActivity: vi.fn(),
}));
vi.mock("../data/search", () => ({ handleSearch: vi.fn() }));
vi.mock("../data/stats", () => ({ handleStats: vi.fn() }));
vi.mock("../data/ingest", () => ({
  handleSessionIngest: vi.fn(),
  handleCanonicalUpload: vi.fn(),
  handleRawUpload: vi.fn(),
  handleLive: vi.fn(),
}));

import * as ingestMocks from "../data/ingest";
// after mocks
import * as projectsMocks from "../data/projects";
import * as searchMocks from "../data/search";
import * as sessionsMocks from "../data/sessions";
import * as statsMocks from "../data/stats";
import * as tagsMocks from "../data/tags";
import { createIngestApp, ingestApp } from "./ingest";
import { liveApp } from "./live";
import { projectsApp } from "./projects";
import { searchApp } from "./search";
import { sessionsApp } from "./sessions";
import { statsApp } from "./stats";
import { tagsApp } from "./tags";

const stubEnv = {
  DB: {} as D1Database,
  BUCKET: {} as R2Bucket,
} as AppEnv["Bindings"];

function withUserId<T extends Hono<AppEnv>>(
  app: T,
  userId = "user-1",
): { fetch: (path: string, init?: RequestInit) => Promise<Response> } {
  const wrap = new Hono<AppEnv>();
  wrap.use("*", async (c, next) => {
    c.set("userId", userId);
    return next();
  });
  wrap.route("/", app);
  return {
    fetch: (path: string, init?: RequestInit) =>
      Promise.resolve(
        wrap.fetch(
          new Request(`http://t${path}`, init),
          stubEnv as unknown as Record<string, unknown>,
        ),
      ),
  };
}

function asMock(fn: unknown): Mock {
  return fn as Mock;
}

const ok = () => Response.json({ ok: true });

beforeEach(() => {
  for (const m of [
    sessionsMocks,
    tagsMocks,
    projectsMocks,
    searchMocks,
    statsMocks,
    ingestMocks,
  ]) {
    for (const fn of Object.values(m) as Mock[]) {
      if (typeof fn?.mockReset === "function") {
        fn.mockReset();
        fn.mockImplementation(ok);
      }
    }
  }
});

// ── sessions ──────────────────────────────────────────────────

describe("sessionsApp wiring", () => {
  it("GET / → handleListSessions", async () => {
    const app = withUserId(sessionsApp);
    const res = await app.fetch("/?limit=5");
    expect(res.status).toBe(200);
    expect(sessionsMocks.handleListSessions).toHaveBeenCalledOnce();
    const [userId, params] = asMock(sessionsMocks.handleListSessions).mock
      .calls[0];
    expect(userId).toBe("user-1");
    expect((params as URLSearchParams).get("limit")).toBe("5");
  });

  it("GET /filters → handleFilters", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/filters");
    expect(sessionsMocks.handleFilters).toHaveBeenCalledWith("user-1", stubEnv);
  });

  it("POST /batch → handleBatchOperation with body", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "trash", ids: ["a"] }),
    });
    expect(sessionsMocks.handleBatchOperation).toHaveBeenCalledWith(
      "user-1",
      { op: "trash", ids: ["a"] },
      stubEnv,
    );
  });

  it("POST /batch with invalid JSON passes null body", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/batch", { method: "POST", body: "not-json" });
    expect(sessionsMocks.handleBatchOperation).toHaveBeenCalledWith(
      "user-1",
      null,
      stubEnv,
    );
  });

  it("GET /:id → handleGetSession with id", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc-123");
    expect(sessionsMocks.handleGetSession).toHaveBeenCalledWith(
      "user-1",
      "abc-123",
      stubEnv,
    );
  });

  it("PATCH /:id → handleUpdateSession", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(sessionsMocks.handleUpdateSession).toHaveBeenCalledWith(
      "user-1",
      "abc",
      { title: "x" },
      stubEnv,
    );
  });

  it("GET /:id/content → handleGetSessionContent", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc/content");
    expect(sessionsMocks.handleGetSessionContent).toHaveBeenCalledWith(
      "user-1",
      "abc",
      stubEnv,
    );
  });

  it("PATCH /:id/star → handleSetStar", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc/star", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: true }),
    });
    expect(sessionsMocks.handleSetStar).toHaveBeenCalledWith(
      "user-1",
      "abc",
      { starred: true },
      stubEnv,
    );
  });

  it("PATCH /:id/trash → handleTrashSession", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc/trash", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    expect(sessionsMocks.handleTrashSession).toHaveBeenCalledWith(
      "user-1",
      "abc",
      { trashed: true },
      stubEnv,
    );
  });

  it("GET /:id/tags → handleGetSessionTags", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc/tags");
    expect(tagsMocks.handleGetSessionTags).toHaveBeenCalledWith(
      "user-1",
      "abc",
      stubEnv,
    );
  });

  it("PUT /:id/tags → handleAddSessionTag", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: "t1" }),
    });
    expect(tagsMocks.handleAddSessionTag).toHaveBeenCalledWith(
      "user-1",
      "abc",
      { tagId: "t1" },
      stubEnv,
    );
  });

  it("DELETE /:id/tags → handleRemoveSessionTag", async () => {
    const app = withUserId(sessionsApp);
    await app.fetch("/abc/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: "t1" }),
    });
    expect(tagsMocks.handleRemoveSessionTag).toHaveBeenCalledWith(
      "user-1",
      "abc",
      { tagId: "t1" },
      stubEnv,
    );
  });
});

// ── projects ──────────────────────────────────────────────────

describe("projectsApp wiring", () => {
  it("GET / → handleListProjects", async () => {
    const app = withUserId(projectsApp);
    await app.fetch("/?foo=1");
    const [uid, params] = asMock(projectsMocks.handleListProjects).mock
      .calls[0];
    expect(uid).toBe("user-1");
    expect((params as URLSearchParams).get("foo")).toBe("1");
  });
  it("GET /activity → handleProjectActivity", async () => {
    const app = withUserId(projectsApp);
    await app.fetch("/activity?projectKey=p");
    const [uid, params] = asMock(projectsMocks.handleProjectActivity).mock
      .calls[0];
    expect(uid).toBe("user-1");
    expect((params as URLSearchParams).get("projectKey")).toBe("p");
  });
});

// ── search ────────────────────────────────────────────────────

describe("searchApp wiring", () => {
  it("GET /?q=x → handleSearch", async () => {
    const app = withUserId(searchApp);
    await app.fetch("/?q=hello");
    const [uid, params] = asMock(searchMocks.handleSearch).mock.calls[0];
    expect(uid).toBe("user-1");
    expect((params as URLSearchParams).get("q")).toBe("hello");
  });
});

// ── stats ─────────────────────────────────────────────────────

describe("statsApp wiring", () => {
  it("GET / → handleStats", async () => {
    const app = withUserId(statsApp);
    await app.fetch("/");
    expect(statsMocks.handleStats).toHaveBeenCalledWith("user-1", stubEnv);
  });
});

// ── tags ──────────────────────────────────────────────────────

describe("tagsApp wiring", () => {
  it("GET / → handleListTags", async () => {
    const app = withUserId(tagsApp);
    await app.fetch("/");
    expect(tagsMocks.handleListTags).toHaveBeenCalledWith("user-1", stubEnv);
  });
  it("POST / → handleCreateTag", async () => {
    const app = withUserId(tagsApp);
    await app.fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(tagsMocks.handleCreateTag).toHaveBeenCalledWith(
      "user-1",
      { name: "x" },
      stubEnv,
    );
  });
  it("POST / with invalid JSON passes null", async () => {
    const app = withUserId(tagsApp);
    await app.fetch("/", { method: "POST", body: "x" });
    expect(tagsMocks.handleCreateTag).toHaveBeenCalledWith(
      "user-1",
      null,
      stubEnv,
    );
  });
  it("PATCH /:tagId → handleUpdateTag", async () => {
    const app = withUserId(tagsApp);
    await app.fetch("/t1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "y" }),
    });
    expect(tagsMocks.handleUpdateTag).toHaveBeenCalledWith(
      "user-1",
      "t1",
      { name: "y" },
      stubEnv,
    );
  });
  it("DELETE /:tagId → handleDeleteTag", async () => {
    const app = withUserId(tagsApp);
    await app.fetch("/t1", { method: "DELETE" });
    expect(tagsMocks.handleDeleteTag).toHaveBeenCalledWith(
      "user-1",
      "t1",
      stubEnv,
    );
  });
});

// ── live ──────────────────────────────────────────────────────

describe("liveApp wiring", () => {
  it("GET / → handleLive", async () => {
    const wrap = new Hono<AppEnv>();
    wrap.route("/", liveApp);
    const res = await wrap.fetch(
      new Request("http://t/"),
      stubEnv as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    expect(ingestMocks.handleLive).toHaveBeenCalledWith(stubEnv);
  });
});

// ── ingest ────────────────────────────────────────────────────

describe("ingestApp wiring", () => {
  it("POST /presign with valid body → presignPut + json", async () => {
    const presignPut = vi.fn().mockResolvedValue("https://r2/upload");
    const app = withUserId(createIngestApp({ presignPut }));
    const res = await app.fetch("/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionKey: "s1",
        rawHash: "abcd1234",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string };
    expect(body.url).toBe("https://r2/upload");
    expect(body.key).toBe("user-1/s1/raw/abcd1234.json.gz");
    expect(presignPut).toHaveBeenCalledWith(
      "user-1/s1/raw/abcd1234.json.gz",
      "application/gzip",
    );
  });

  it("POST /presign with invalid JSON → 400", async () => {
    const app = withUserId(createIngestApp({ presignPut: vi.fn() }));
    const res = await app.fetch("/presign", { method: "POST", body: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /presign with bad rawHash → 400", async () => {
    const app = withUserId(createIngestApp({ presignPut: vi.fn() }));
    const res = await app.fetch("/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s", rawHash: "ZZZZ" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /presign with missing sessionKey → 400", async () => {
    const app = withUserId(createIngestApp({ presignPut: vi.fn() }));
    const res = await app.fetch("/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawHash: "abcd1234" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /presign when presigner throws → 500", async () => {
    const presignPut = vi.fn().mockRejectedValue(new Error("boom"));
    const app = withUserId(createIngestApp({ presignPut }));
    const res = await app.fetch("/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s", rawHash: "abcd1234" }),
    });
    expect(res.status).toBe(500);
  });

  it("POST /confirm-raw → handleConfirmRaw", async () => {
    const app = withUserId(ingestApp);
    await app.fetch("/confirm-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "s", rawHash: "h", rawSize: 1 }),
    });
    expect(sessionsMocks.handleConfirmRaw).toHaveBeenCalledWith(
      "user-1",
      { sessionKey: "s", rawHash: "h", rawSize: 1 },
      stubEnv,
    );
  });

  it("POST /confirm-raw with invalid JSON → 400", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/confirm-raw", {
      method: "POST",
      body: "x",
    });
    expect(res.status).toBe(400);
  });

  it("POST /sessions without Content-Length → 411", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/sessions", {
      method: "POST",
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(411);
  });

  it("POST /sessions with oversize Content-Length → 413", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(10 * 1024 * 1024),
      },
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(413);
  });

  it("POST /sessions valid → handleSessionIngest", async () => {
    const app = withUserId(ingestApp);
    const body = JSON.stringify({ sessions: [{ sessionKey: "s" }] });
    await app.fetch("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(body).byteLength),
      },
      body,
    });
    expect(ingestMocks.handleSessionIngest).toHaveBeenCalledOnce();
    const [payload] = asMock(ingestMocks.handleSessionIngest).mock.calls[0];
    expect((payload as { userId: string }).userId).toBe("user-1");
  });

  it("POST /sessions with invalid JSON → 400", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "5",
      },
      body: "xxxxx",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /content/sk/canonical → handleCanonicalUpload", async () => {
    const app = withUserId(ingestApp);
    await app.fetch("/content/abc/canonical", {
      method: "PUT",
      headers: { "Content-Length": "10" },
      body: "x".repeat(10),
    });
    expect(ingestMocks.handleCanonicalUpload).toHaveBeenCalledOnce();
    const [sessionKey, userId] = asMock(ingestMocks.handleCanonicalUpload).mock
      .calls[0];
    expect(sessionKey).toBe("abc");
    expect(userId).toBe("user-1");
  });

  it("PUT /content/sk/raw → handleRawUpload", async () => {
    const app = withUserId(ingestApp);
    await app.fetch("/content/abc/raw", {
      method: "PUT",
      headers: { "Content-Length": "10" },
      body: "x".repeat(10),
    });
    expect(ingestMocks.handleRawUpload).toHaveBeenCalledOnce();
  });

  it("PUT /content without Content-Length → 411", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/content/abc/raw", { method: "PUT" });
    expect(res.status).toBe(411);
  });

  it("PUT /content with oversize Content-Length → 413", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/content/abc/raw", {
      method: "PUT",
      headers: { "Content-Length": String(60 * 1024 * 1024) },
    });
    expect(res.status).toBe(413);
  });

  it("PUT /content with bad type segment → 400", async () => {
    const app = withUserId(ingestApp);
    const res = await app.fetch("/content/abc/bogus", {
      method: "PUT",
      headers: { "Content-Length": "1" },
      body: "x",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /content with no sessionKey → 400", async () => {
    const app = withUserId(ingestApp);
    // /content/canonical → only one segment after content/
    const res = await app.fetch("/content/canonical", {
      method: "PUT",
      headers: { "Content-Length": "1" },
      body: "x",
    });
    expect(res.status).toBe(400);
  });
});
