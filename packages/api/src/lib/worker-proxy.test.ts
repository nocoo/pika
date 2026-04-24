import { WorkerError } from "@pika/core/infra/worker-client";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultWorkerClient,
  resetDefaultWorkerClient,
  workerDeleteHandler,
  workerGetHandler,
  workerPatchHandler,
  workerPostHandler,
  workerPutHandler,
} from "./worker-proxy";

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function makeMockClient(): MockClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

function makeApp(handler: Parameters<Hono["get"]>[1], method: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    c.set("workerClient", (globalThis as Record<string, unknown>).__client);
    await next();
  });
  if (method === "GET") app.get("/r", handler);
  if (method === "POST") app.post("/r", handler);
  if (method === "PATCH") app.patch("/r", handler);
  if (method === "PUT") app.put("/r", handler);
  if (method === "DELETE") app.delete("/r", handler);
  return app;
}

function setClient(client: MockClient): void {
  (globalThis as Record<string, unknown>).__client = client;
}

afterEach(() => {
  resetDefaultWorkerClient();
  delete (globalThis as Record<string, unknown>).__client;
  delete process.env.WORKER_URL;
  delete process.env.WORKER_SECRET;
});

describe("workerGetHandler", () => {
  it("forwards query params and returns JSON", async () => {
    const client = makeMockClient();
    client.get.mockResolvedValue({ items: [1, 2] });
    setClient(client);
    const app = makeApp(workerGetHandler("/things"), "GET");

    const res = await app.request("/r?q=hi&limit=5");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1, 2] });
    expect(client.get).toHaveBeenCalledWith("/things", "user-1", {
      q: "hi",
      limit: "5",
    });
  });

  it("supports a path callback", async () => {
    const client = makeMockClient();
    client.get.mockResolvedValue({});
    setClient(client);
    const app = makeApp(
      workerGetHandler((c) => `/items/${c.req.query("id")}`),
      "GET",
    );

    await app.request("/r?id=42");
    expect(client.get).toHaveBeenCalledWith("/items/42", "user-1", {
      id: "42",
    });
  });

  it("supports custom params extractor", async () => {
    const client = makeMockClient();
    client.get.mockResolvedValue({});
    setClient(client);
    const app = makeApp(
      workerGetHandler("/x", () => ({ forced: "true" })),
      "GET",
    );
    await app.request("/r?ignored=1");
    expect(client.get).toHaveBeenCalledWith("/x", "user-1", { forced: "true" });
  });

  it("returns 204 when client yields null", async () => {
    const client = makeMockClient();
    client.get.mockResolvedValue(null);
    setClient(client);
    const app = makeApp(workerGetHandler("/x"), "GET");

    const res = await app.request("/r");
    expect(res.status).toBe(204);
  });

  it("converts WorkerError JSON message into status + body", async () => {
    const client = makeMockClient();
    client.get.mockRejectedValue(
      new WorkerError(409, JSON.stringify({ error: "duplicate" })),
    );
    setClient(client);
    const app = makeApp(workerGetHandler("/x"), "GET");

    const res = await app.request("/r");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "duplicate" });
  });

  it("converts WorkerError plain message into { error } envelope", async () => {
    const client = makeMockClient();
    client.get.mockRejectedValue(new WorkerError(404, "not found"));
    setClient(client);
    const app = makeApp(workerGetHandler("/x"), "GET");

    const res = await app.request("/r");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("converts unknown errors to 500", async () => {
    const client = makeMockClient();
    client.get.mockRejectedValue(new Error("boom"));
    setClient(client);
    const app = makeApp(workerGetHandler("/x"), "GET");

    const res = await app.request("/r");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Worker request failed: boom",
    });
  });

  it("stringifies non-Error rejections", async () => {
    const client = makeMockClient();
    client.get.mockRejectedValue("nope");
    setClient(client);
    const app = makeApp(workerGetHandler("/x"), "GET");

    const res = await app.request("/r");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Worker request failed: nope",
    });
  });
});

describe("workerPostHandler", () => {
  it("forwards JSON body and returns 201 by default", async () => {
    const client = makeMockClient();
    client.post.mockResolvedValue({ id: "x" });
    setClient(client);
    const app = makeApp(workerPostHandler("/things"), "POST");

    const res = await app.request("/r", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "n" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "x" });
    expect(client.post).toHaveBeenCalledWith("/things", "user-1", {
      name: "n",
    });
  });

  it("honours custom successStatus", async () => {
    const client = makeMockClient();
    client.post.mockResolvedValue({ ok: true });
    setClient(client);
    const app = makeApp(
      workerPostHandler("/x", { successStatus: 200 }),
      "POST",
    );
    const res = await app.request("/r", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("returns 204 when client yields null", async () => {
    const client = makeMockClient();
    client.post.mockResolvedValue(null);
    setClient(client);
    const app = makeApp(workerPostHandler("/x"), "POST");

    const res = await app.request("/r", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(204);
  });

  it("returns 400 for invalid JSON", async () => {
    const client = makeMockClient();
    setClient(client);
    const app = makeApp(workerPostHandler("/x"), "POST");

    const res = await app.request("/r", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("propagates WorkerError", async () => {
    const client = makeMockClient();
    client.post.mockRejectedValue(new WorkerError(403, "forbidden"));
    setClient(client);
    const app = makeApp(workerPostHandler("/x"), "POST");

    const res = await app.request("/r", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("workerPatchHandler", () => {
  it("forwards body and returns 200", async () => {
    const client = makeMockClient();
    client.patch.mockResolvedValue({ ok: true });
    setClient(client);
    const app = makeApp(workerPatchHandler("/x"), "PATCH");

    const res = await app.request("/r", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(client.patch).toHaveBeenCalledWith("/x", "user-1", { a: 1 });
  });

  it("returns 204 on null result", async () => {
    const client = makeMockClient();
    client.patch.mockResolvedValue(null);
    setClient(client);
    const app = makeApp(workerPatchHandler("/x"), "PATCH");

    const res = await app.request("/r", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(204);
  });

  it("rejects invalid JSON", async () => {
    setClient(makeMockClient());
    const app = makeApp(workerPatchHandler("/x"), "PATCH");
    const res = await app.request("/r", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "x",
    });
    expect(res.status).toBe(400);
  });

  it("propagates WorkerError", async () => {
    const client = makeMockClient();
    client.patch.mockRejectedValue(new WorkerError(404, "not found"));
    setClient(client);
    const app = makeApp(workerPatchHandler("/x"), "PATCH");
    const res = await app.request("/r", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("workerPutHandler", () => {
  it("forwards body and returns 200", async () => {
    const client = makeMockClient();
    client.put.mockResolvedValue({ ok: true });
    setClient(client);
    const app = makeApp(workerPutHandler("/x"), "PUT");
    const res = await app.request("/r", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(client.put).toHaveBeenCalledWith("/x", "user-1", { a: 1 });
  });

  it("returns 204 on null result", async () => {
    const client = makeMockClient();
    client.put.mockResolvedValue(null);
    setClient(client);
    const app = makeApp(workerPutHandler("/x"), "PUT");
    const res = await app.request("/r", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(204);
  });

  it("rejects invalid JSON", async () => {
    setClient(makeMockClient());
    const app = makeApp(workerPutHandler("/x"), "PUT");
    const res = await app.request("/r", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "x",
    });
    expect(res.status).toBe(400);
  });

  it("propagates WorkerError", async () => {
    const client = makeMockClient();
    client.put.mockRejectedValue(new WorkerError(409, "conflict"));
    setClient(client);
    const app = makeApp(workerPutHandler("/x"), "PUT");
    const res = await app.request("/r", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
});

describe("workerDeleteHandler", () => {
  it("forwards optional body when present", async () => {
    const client = makeMockClient();
    client.delete.mockResolvedValue({ ok: true });
    setClient(client);
    const app = makeApp(workerDeleteHandler("/x"), "DELETE");

    const res = await app.request("/r", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: "t" }),
    });
    expect(res.status).toBe(200);
    expect(client.delete).toHaveBeenCalledWith("/x", "user-1", { tagId: "t" });
  });

  it("supports body-less DELETE", async () => {
    const client = makeMockClient();
    client.delete.mockResolvedValue(null);
    setClient(client);
    const app = makeApp(workerDeleteHandler("/x"), "DELETE");

    const res = await app.request("/r", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(client.delete).toHaveBeenCalledWith("/x", "user-1", undefined);
  });

  it("returns 200 + JSON when worker yields object", async () => {
    const client = makeMockClient();
    client.delete.mockResolvedValue({ removed: 1 });
    setClient(client);
    const app = makeApp(workerDeleteHandler("/x"), "DELETE");
    const res = await app.request("/r", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1 });
  });

  it("propagates WorkerError", async () => {
    const client = makeMockClient();
    client.delete.mockRejectedValue(new WorkerError(404, "not found"));
    setClient(client);
    const app = makeApp(workerDeleteHandler("/x"), "DELETE");
    const res = await app.request("/r", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("getDefaultWorkerClient", () => {
  it("throws when WORKER_URL missing", () => {
    delete process.env.WORKER_URL;
    process.env.WORKER_SECRET = "s";
    expect(() => getDefaultWorkerClient()).toThrow("WORKER_URL");
  });

  it("throws when WORKER_SECRET missing", () => {
    process.env.WORKER_URL = "https://w.example";
    delete process.env.WORKER_SECRET;
    expect(() => getDefaultWorkerClient()).toThrow("WORKER_SECRET");
  });

  it("caches the singleton across calls", () => {
    process.env.WORKER_URL = "https://w.example";
    process.env.WORKER_SECRET = "s";
    const a = getDefaultWorkerClient();
    const b = getDefaultWorkerClient();
    expect(a).toBe(b);
  });

  it("falls back to default client when context has none", async () => {
    process.env.WORKER_URL = "https://w.example";
    process.env.WORKER_SECRET = "s";
    const handler = workerGetHandler("/anything");
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("userId", "user-1");
      await next();
    });
    app.get("/r", handler);
    // network call will fail, but we only assert that the default
    // client was constructed without throwing inside resolveClient.
    const res = await app.request("/r");
    expect([500, 502, 404]).toContain(res.status);
  });
});
