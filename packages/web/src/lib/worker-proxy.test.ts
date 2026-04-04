/**
 * Worker proxy helpers tests.
 */

import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWorkerClient, WorkerError } from "./worker-client";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock auth - use type assertion to handle NextAuth's complex return type
const mockAuth = vi.fn<() => Promise<Session | null>>();
vi.mock("./auth", () => ({
  auth: () => mockAuth(),
}));

// Save original env
const originalEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string) {
  if (!(key in originalEnv)) originalEnv[key] = process.env[key];
  (process.env as Record<string, string>)[key] = value;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else (process.env as Record<string, string>)[key] = value;
  }
  for (const key of Object.keys(originalEnv)) delete originalEnv[key];
}

import {
  createWorkerDeleteRoute,
  createWorkerGetRoute,
  createWorkerPatchRoute,
  createWorkerPostRoute,
  createWorkerPutRoute,
  handleWorkerError,
  resolveUserForWorker,
} from "./worker-proxy";

describe("resolveUserForWorker", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
    mockAuth.mockReset();
  });

  it("returns E2E test user when E2E_SKIP_AUTH is true in development", async () => {
    setEnv("E2E_SKIP_AUTH", "true");
    setEnv("NODE_ENV", "development");

    const request = new Request("http://localhost:7022/api/test");
    const result = await resolveUserForWorker(request);

    expect(result).toBe("e2e-test-user-id");
  });

  it("does NOT bypass in production even with E2E_SKIP_AUTH", async () => {
    setEnv("E2E_SKIP_AUTH", "true");
    setEnv("NODE_ENV", "production");
    mockAuth.mockResolvedValue(null);

    const request = new Request("http://localhost:7022/api/test");
    const result = await resolveUserForWorker(request);

    expect(result).toBeNull();
  });

  it("returns session userId when authenticated via session", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "session-user-123", email: "test@example.com" },
      expires: "",
    });

    const request = new Request("http://localhost:7022/api/test");
    const result = await resolveUserForWorker(request);

    expect(result).toBe("session-user-123");
  });

  it("returns userId from Worker /auth/me for API key auth", async () => {
    mockAuth.mockResolvedValue(null);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ userId: "api-user-456" }),
    });

    const request = new Request("http://localhost:7022/api/test", {
      headers: { Authorization: "Bearer pk_abcd1234" },
    });

    const result = await resolveUserForWorker(request);

    expect(result).toBe("api-user-456");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://worker.example.com/auth/me",
      }),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer pk_abcd1234" },
      }),
    );
  });

  it("returns null when API key validation fails", async () => {
    mockAuth.mockResolvedValue(null);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const request = new Request("http://localhost:7022/api/test", {
      headers: { Authorization: "Bearer pk_invalid" },
    });

    const result = await resolveUserForWorker(request);

    expect(result).toBeNull();
  });

  it("returns null when no auth is provided", async () => {
    mockAuth.mockResolvedValue(null);

    const request = new Request("http://localhost:7022/api/test");
    const result = await resolveUserForWorker(request);

    expect(result).toBeNull();
  });
});

describe("handleWorkerError", () => {
  it("handles WorkerError with JSON message", () => {
    const err = new WorkerError(400, '{"error":"Bad request"}');
    const response = handleWorkerError(err);

    expect(response.status).toBe(400);
  });

  it("handles WorkerError with plain text message", () => {
    const err = new WorkerError(404, "Not found");
    const response = handleWorkerError(err);

    expect(response.status).toBe(404);
  });

  it("handles generic errors", () => {
    const err = new Error("Network error");
    const response = handleWorkerError(err);

    expect(response.status).toBe(500);
  });
});

describe("createWorkerGetRoute", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
    mockAuth.mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      expires: "",
    });
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
    mockAuth.mockReset();
  });

  it("proxies GET request to Worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "test" }),
    });

    const handler = createWorkerGetRoute("/sessions");
    const request = new Request("http://localhost:7022/api/sessions?limit=10");
    const response = await handler(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBe("test");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("/sessions"),
      }),
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer test-secret",
          "X-User-Id": "user-123",
        },
      }),
    );
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const handler = createWorkerGetRoute("/sessions");
    const request = new Request("http://localhost:7022/api/sessions");
    const response = await handler(request);

    expect(response.status).toBe(401);
  });

  it("supports dynamic path function", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ session: {} }),
    });

    const handler = createWorkerGetRoute((url) => {
      const id = url.pathname.split("/").pop();
      return `/sessions/${id}`;
    });
    const request = new Request("http://localhost:7022/api/sessions/sess-123");
    await handler(request);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("/sessions/sess-123"),
      }),
      expect.anything(),
    );
  });
});

describe("createWorkerPostRoute", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
    mockAuth.mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      expires: "",
    });
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
    mockAuth.mockReset();
  });

  it("proxies POST request to Worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "new-tag" }),
    });

    const handler = createWorkerPostRoute("/tags");
    const request = new Request("http://localhost:7022/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    const response = await handler(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("new-tag");
  });

  it("returns 400 for invalid JSON body", async () => {
    const handler = createWorkerPostRoute("/tags");
    const request = new Request("http://localhost:7022/api/tags", {
      method: "POST",
      body: "not json",
    });
    const response = await handler(request);

    expect(response.status).toBe(400);
  });
});

describe("createWorkerPatchRoute", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
    mockAuth.mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      expires: "",
    });
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
    mockAuth.mockReset();
  });

  it("proxies PATCH request to Worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ starred: true }),
    });

    const handler = createWorkerPatchRoute("/sessions/123/star");
    const request = new Request("http://localhost:7022/api/sessions/123/star", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: true }),
    });
    const response = await handler(request);

    expect(response.status).toBe(200);
  });
});

describe("createWorkerPutRoute", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
    mockAuth.mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      expires: "",
    });
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
    mockAuth.mockReset();
  });

  it("proxies PUT request to Worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ added: true }),
    });

    const handler = createWorkerPutRoute("/sessions/123/tags");
    const request = new Request("http://localhost:7022/api/sessions/123/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: "tag-1" }),
    });
    const response = await handler(request);

    expect(response.status).toBe(200);
  });
});

describe("createWorkerDeleteRoute", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
    mockAuth.mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      expires: "",
    });
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
    mockAuth.mockReset();
  });

  it("proxies DELETE request to Worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const handler = createWorkerDeleteRoute("/tags/123");
    const request = new Request("http://localhost:7022/api/tags/123", {
      method: "DELETE",
    });
    const response = await handler(request);

    expect(response.status).toBe(204);
  });

  it("handles DELETE with body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const handler = createWorkerDeleteRoute("/sessions/123/tags");
    const request = new Request("http://localhost:7022/api/sessions/123/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: "tag-1" }),
    });
    const response = await handler(request);

    expect(response.status).toBe(204);
  });
});
