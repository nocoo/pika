import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

describe("ApiClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createClient(token?: string) {
    return new ApiClient({
      baseUrl: "https://api.example.com",
      getToken: () => token,
      fetchFn: mockFetch as unknown as typeof fetch,
      retry: { maxAttempts: 1 }, // Disable retries for simpler tests
    });
  }

  function mockResponse(data: unknown, status = 200, ok = true) {
    return {
      ok,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  describe("authentication", () => {
    it("isAuthenticated returns true when token exists", () => {
      const client = createClient("test-token");
      expect(client.isAuthenticated()).toBe(true);
    });

    it("isAuthenticated returns false when no token", () => {
      const client = createClient(undefined);
      expect(client.isAuthenticated()).toBe(false);
    });

    it("includes auth header when token exists", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: "test" }));

      const client = createClient("test-token");
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("excludes auth header when no token", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: "test" }));

      const client = createClient(undefined);
      await client.get("/test");

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });
  });

  describe("GET requests", () => {
    it("preserves /api path segment in base URL", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [] }));

      const client = new ApiClient({
        baseUrl: "https://example.com/api",
        getToken: () => "token",
        fetchFn: mockFetch as unknown as typeof fetch,
        retry: { maxAttempts: 1 },
      });
      await client.get("/sessions");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/sessions",
        expect.any(Object),
      );
    });

    it("builds URL with query params", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [] }));

      const client = createClient("token");
      await client.get("/sessions", { limit: "50", source: "claude-code" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/sessions?limit=50&source=claude-code",
        expect.any(Object),
      );
    });

    it("skips empty query params", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [] }));

      const client = createClient("token");
      await client.get("/sessions", { limit: "50", source: "" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/sessions?limit=50",
        expect.any(Object),
      );
    });

    it("returns data on success", async () => {
      const data = { sessions: [{ id: "1" }, { id: "2" }] };
      mockFetch.mockResolvedValueOnce(mockResponse(data));

      const client = createClient("token");
      const result = await client.get<typeof data>("/sessions");

      expect(result).toEqual({
        ok: true,
        status: 200,
        data,
      });
    });
  });

  describe("POST requests", () => {
    it("sends JSON body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: "new-tag" }));

      const client = createClient("token");
      await client.post("/tags", { name: "bug", color: "#ff0000" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/tags",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ name: "bug", color: "#ff0000" }),
        }),
      );
    });
  });

  describe("PUT requests", () => {
    it("sends PUT with body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ updated: true }));

      const client = createClient("token");
      await client.put("/sessions/123/tags", { tagId: "tag-456" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/sessions/123/tags",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ tagId: "tag-456" }),
        }),
      );
    });
  });

  describe("PATCH requests", () => {
    it("sends PATCH with body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ starred: true }));

      const client = createClient("token");
      await client.patch("/sessions/123/star", { starred: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/sessions/123/star",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ starred: true }),
        }),
      );
    });
  });

  describe("DELETE requests", () => {
    it("sends DELETE with optional body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      const client = createClient("token");
      await client.delete("/sessions/123/tags", { tagId: "tag-456" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/sessions/123/tags",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ tagId: "tag-456" }),
        }),
      );
    });

    it("handles 204 No Content", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      const client = createClient("token");
      const result = await client.delete("/sessions/123/tags");

      expect(result).toEqual({ ok: true, status: 204 });
    });
  });

  describe("error handling", () => {
    it("returns error on 4xx", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Not found" }, 404, false),
      );

      const client = createClient("token");
      const result = await client.get("/sessions/invalid");

      expect(result).toEqual({
        ok: false,
        status: 404,
        error: "Not found",
      });
    });

    it("returns error on 5xx", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ message: "Internal error" }, 500, false),
      );

      const client = createClient("token");
      const result = await client.get("/sessions");

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: "Internal error",
      });
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      const client = createClient("token");
      const result = await client.get("/sessions");

      expect(result).toEqual({
        ok: false,
        status: 0,
        error: "Network failure",
      });
    });

    it("handles non-JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve("<html>Error</html>"),
      });

      const client = createClient("token");
      const result = await client.get("/sessions");

      expect(result).toEqual({
        ok: false,
        status: 502,
        error: "<html>Error</html>",
      });
    });
  });

  describe("retry behavior", () => {
    it("retries on 429 rate limit", async () => {
      const client = new ApiClient({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        fetchFn: mockFetch as unknown as typeof fetch,
        retry: { maxAttempts: 2, backoffMs: 10 },
      });

      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ error: "Rate limited" }, 429, false),
        )
        .mockResolvedValueOnce(mockResponse({ data: "success" }));

      const result = await client.get("/test");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
    });

    it("does not retry on 4xx client errors", async () => {
      const client = new ApiClient({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        fetchFn: mockFetch as unknown as typeof fetch,
        retry: { maxAttempts: 3, backoffMs: 10 },
      });

      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Not found" }, 404, false),
      );

      const result = await client.get("/test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(404);
    });

    it("retries on 5xx server errors", async () => {
      const client = new ApiClient({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        fetchFn: mockFetch as unknown as typeof fetch,
        retry: { maxAttempts: 2, backoffMs: 10 },
      });

      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ error: "Server error" }, 502, false),
        )
        .mockResolvedValueOnce(mockResponse({ data: "success" }));

      const result = await client.get("/test");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
    });

    it("returns last error after max retries", async () => {
      const client = new ApiClient({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        fetchFn: mockFetch as unknown as typeof fetch,
        retry: { maxAttempts: 2, backoffMs: 10 },
      });

      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ error: "Rate limited" }, 429, false),
        )
        .mockResolvedValueOnce(
          mockResponse({ error: "Still rate limited" }, 429, false),
        );

      const result = await client.get("/test");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(429);
    });
  });
});
