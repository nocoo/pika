/**
 * WorkerCliAuthDb tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCliKeyViaWorker, WorkerCliAuthDb } from "./worker-cli-auth-db";
import { resetWorkerClient, WorkerError } from "./worker-client";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

describe("WorkerCliAuthDb", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
  });

  describe("generateKeyViaWorker", () => {
    it("calls POST /auth/cli-key and returns the key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ apiKey: "pk_abcd1234" }),
      });

      const db = new WorkerCliAuthDb();
      const apiKey = await db.generateKeyViaWorker("user-123");

      expect(apiKey).toBe("pk_abcd1234");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: "https://worker.example.com/auth/cli-key",
        }),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-secret",
            "X-User-Id": "user-123",
          }),
        }),
      );
    });

    it("throws WorkerError on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "User not found",
      });

      const db = new WorkerCliAuthDb();

      await expect(db.generateKeyViaWorker("user-123")).rejects.toThrow(
        WorkerError,
      );
    });
  });

  describe("setApiKey", () => {
    it("no-ops when called after generateKeyViaWorker", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ apiKey: "pk_abcd1234" }),
      });

      const db = new WorkerCliAuthDb();
      await db.generateKeyViaWorker("user-123");

      // setApiKey should not throw and should not make any fetch calls
      const fetchCallsBefore = mockFetch.mock.calls.length;
      await db.setApiKey("user-123", "somehash");
      expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
    });

    it("throws if called without prior generateKeyViaWorker", async () => {
      const db = new WorkerCliAuthDb();

      await expect(db.setApiKey("user-123", "somehash")).rejects.toThrow(
        "without prior generateKeyViaWorker",
      );
    });
  });

  describe("getUserByApiKey", () => {
    it("throws error indicating it is not supported", async () => {
      const db = new WorkerCliAuthDb();

      await expect(db.getUserByApiKey("somehash")).rejects.toThrow(
        "not supported",
      );
    });
  });
});

describe("generateCliKeyViaWorker", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetWorkerClient();
    setEnv("WORKER_URL", "https://worker.example.com");
    setEnv("WORKER_SECRET", "test-secret");
  });

  afterEach(() => {
    restoreEnv();
    resetWorkerClient();
  });

  it("returns db instance and apiKey on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ apiKey: "pk_xyz789" }),
    });

    const result = await generateCliKeyViaWorker("user-456");

    expect(result.apiKey).toBe("pk_xyz789");
    expect(result.db).toBeInstanceOf(WorkerCliAuthDb);
  });

  it("throws user-friendly error on 404", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "User not found",
    });

    await expect(generateCliKeyViaWorker("user-456")).rejects.toThrow(
      "User user-456 not found",
    );
  });

  it("rethrows other errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal server error",
    });

    await expect(generateCliKeyViaWorker("user-456")).rejects.toThrow(
      WorkerError,
    );
  });
});
