/**
 * Worker client tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWorkerClient,
  resetWorkerClient,
  WorkerClient,
  WorkerError,
} from "./worker-client";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("WorkerClient", () => {
  let client: WorkerClient;

  beforeEach(() => {
    client = new WorkerClient({
      workerUrl: "https://worker.example.com",
      workerSecret: "test-secret",
    });
    mockFetch.mockReset();
  });

  describe("constructor", () => {
    it("throws if workerUrl is missing", () => {
      expect(
        () => new WorkerClient({ workerUrl: "", workerSecret: "secret" }),
      ).toThrow("workerUrl is required");
    });

    it("throws if workerSecret is missing", () => {
      expect(
        () =>
          new WorkerClient({
            workerUrl: "https://example.com",
            workerSecret: "",
          }),
      ).toThrow("workerSecret is required");
    });

    it("strips trailing slash from workerUrl", () => {
      const c = new WorkerClient({
        workerUrl: "https://worker.example.com/",
        workerSecret: "secret",
      });
      // The URL is normalized internally; test via a request
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      c.get("/test", "user-1");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: "https://worker.example.com/test",
        }),
        expect.anything(),
      );
    });
  });

  describe("get", () => {
    it("sends GET request with auth headers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      const result = await client.get("/sessions", "user-123");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: "https://worker.example.com/sessions",
        }),
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer test-secret",
            "X-User-Id": "user-123",
          },
        }),
      );
      expect(result).toEqual({ data: "test" });
    });

    it("adds query params to URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await client.get("/sessions", "user-1", {
        source: "claude-code",
        limit: "10",
      });

      const calledUrl = mockFetch.mock.calls[0][0] as URL;
      expect(calledUrl.searchParams.get("source")).toBe("claude-code");
      expect(calledUrl.searchParams.get("limit")).toBe("10");
    });

    it("skips undefined/null params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await client.get("/sessions", "user-1", {
        source: "claude-code",
        project: undefined as unknown as string,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as URL;
      expect(calledUrl.searchParams.has("source")).toBe(true);
      expect(calledUrl.searchParams.has("project")).toBe(false);
    });

    it("throws WorkerError on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not found",
      });

      await expect(client.get("/sessions/xxx", "user-1")).rejects.toThrow(
        WorkerError,
      );

      try {
        await client.get("/sessions/xxx", "user-1");
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        expect((err as WorkerError).status).toBe(404);
        expect((err as WorkerError).message).toBe("Not found");
      }
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      const result = await client.get("/sessions/123/content", "user-1");
      expect(result).toBeNull();
    });
  });

  describe("post", () => {
    it("sends POST request with JSON body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: "new-tag" }),
      });

      const result = await client.post("/tags", "user-1", {
        name: "test",
        color: "#ff0000",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ name: "test", color: "#ff0000" }),
        }),
      );
      expect(result).toEqual({ id: "new-tag" });
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      const result = await client.post("/test", "user-1", { data: "test" });
      expect(result).toBeNull();
    });

    it("throws WorkerError on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        client.post("/test", "user-1", { data: "test" }),
      ).rejects.toThrow(WorkerError);

      try {
        await client.post("/test", "user-1", { data: "test" });
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        expect((err as WorkerError).status).toBe(500);
        expect((err as WorkerError).message).toBe("Internal Server Error");
      }
    });

    it("sends undefined body when no body provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await client.post("/test", "user-1");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: undefined,
        }),
      );
    });
  });

  describe("patch", () => {
    it("sends PATCH request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ starred: true }),
      });

      await client.patch("/sessions/123/star", "user-1", { starred: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      const result = await client.patch("/test", "user-1", { data: "test" });
      expect(result).toBeNull();
    });

    it("throws WorkerError on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "Unprocessable Entity",
      });

      await expect(
        client.patch("/test", "user-1", { data: "test" }),
      ).rejects.toThrow(WorkerError);

      try {
        await client.patch("/test", "user-1", { data: "test" });
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        expect((err as WorkerError).status).toBe(422);
        expect((err as WorkerError).message).toBe("Unprocessable Entity");
      }
    });
  });

  describe("put", () => {
    it("sends PUT request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ added: true }),
      });

      await client.put("/sessions/123/tags", "user-1", { tagId: "tag-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "PUT",
        }),
      );
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      const result = await client.put("/test", "user-1", { data: "test" });
      expect(result).toBeNull();
    });

    it("throws WorkerError on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => "Conflict",
      });

      await expect(
        client.put("/test", "user-1", { data: "test" }),
      ).rejects.toThrow(WorkerError);

      try {
        await client.put("/test", "user-1", { data: "test" });
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        expect((err as WorkerError).status).toBe(409);
        expect((err as WorkerError).message).toBe("Conflict");
      }
    });
  });

  describe("delete", () => {
    it("sends DELETE request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await client.delete("/tags/123", "user-1");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    it("sends body if provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await client.delete("/sessions/123/tags", "user-1", { tagId: "tag-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({ tagId: "tag-1" }),
        }),
      );
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      const result = await client.delete("/test", "user-1");
      expect(result).toBeNull();
    });

    it("throws WorkerError on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(client.delete("/test", "user-1")).rejects.toThrow(
        WorkerError,
      );

      try {
        await client.delete("/test", "user-1");
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        expect((err as WorkerError).status).toBe(403);
        expect((err as WorkerError).message).toBe("Forbidden");
      }
    });
  });

  // ── Convenience methods ────────────────────────────────────────

  describe("convenience methods", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });

    it("listSessions calls GET /sessions", async () => {
      await client.listSessions("user-1", { source: "claude-code" });
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/sessions");
    });

    it("getSession calls GET /sessions/:id", async () => {
      await client.getSession("user-1", "sess-123");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/sessions/sess-123");
    });

    it("getSessionContent calls GET /sessions/:id/content", async () => {
      await client.getSessionContent("user-1", "sess-123");
      expect(mockFetch.mock.calls[0][0].pathname).toBe(
        "/sessions/sess-123/content",
      );
    });

    it("getFilters calls GET /sessions/filters", async () => {
      await client.getFilters("user-1");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/sessions/filters");
    });

    it("listProjects calls GET /projects", async () => {
      await client.listProjects("user-1");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/projects");
    });

    it("getProjectActivity calls GET /projects/activity", async () => {
      await client.getProjectActivity("user-1", { projectKey: "pika" });
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/projects/activity");
    });

    it("search calls GET /search", async () => {
      await client.search("user-1", { q: "test" });
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/search");
    });

    it("getStats calls GET /stats", async () => {
      await client.getStats("user-1");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/stats");
    });

    it("listTags calls GET /tags", async () => {
      await client.listTags("user-1");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/tags");
    });

    it("createTag calls POST /tags", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({}),
      });
      await client.createTag("user-1", { name: "test" });
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/tags");
    });

    it("updateTag calls PATCH /tags/:id", async () => {
      await client.updateTag("user-1", "tag-1", { name: "updated" });
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/tags/tag-1");
    });

    it("deleteTag calls DELETE /tags/:id", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      await client.deleteTag("user-1", "tag-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/tags/tag-1");
    });

    it("getSessionTags calls GET /sessions/:id/tags", async () => {
      await client.getSessionTags("user-1", "sess-1");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/sessions/sess-1/tags");
    });

    it("addSessionTag calls PUT /sessions/:id/tags", async () => {
      await client.addSessionTag("user-1", "sess-1", "tag-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
    });

    it("removeSessionTag calls DELETE /sessions/:id/tags", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      await client.removeSessionTag("user-1", "sess-1", "tag-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("setSessionStar calls PATCH /sessions/:id/star", async () => {
      await client.setSessionStar("user-1", "sess-1", true);
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/sessions/sess-1/star");
    });

    it("setSessionTrash calls PATCH /sessions/:id/trash", async () => {
      await client.setSessionTrash("user-1", "sess-1", true);
      expect(mockFetch.mock.calls[0][0].pathname).toBe(
        "/sessions/sess-1/trash",
      );
    });

    it("batchOperation calls POST /sessions/batch", async () => {
      await client.batchOperation("user-1", { action: "star", ids: ["s1"] });
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/sessions/batch");
    });

    it("generateCliKey calls POST /auth/cli-key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ apiKey: "pk_xxx" }),
      });
      const result = await client.generateCliKey("user-1");
      expect(mockFetch.mock.calls[0][0].pathname).toBe("/auth/cli-key");
      expect(result.apiKey).toBe("pk_xxx");
    });
  });
});

describe("getWorkerClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetWorkerClient();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetWorkerClient();
  });

  it("throws if WORKER_URL is not set", () => {
    delete process.env.WORKER_URL;
    process.env.WORKER_SECRET = "secret";

    expect(() => getWorkerClient()).toThrow("WORKER_URL");
  });

  it("throws if WORKER_SECRET is not set", () => {
    process.env.WORKER_URL = "https://worker.example.com";
    delete process.env.WORKER_SECRET;

    expect(() => getWorkerClient()).toThrow("WORKER_SECRET");
  });

  it("returns singleton instance", () => {
    process.env.WORKER_URL = "https://worker.example.com";
    process.env.WORKER_SECRET = "secret";

    const client1 = getWorkerClient();
    const client2 = getWorkerClient();

    expect(client1).toBe(client2);
  });
});
