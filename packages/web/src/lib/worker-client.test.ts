/**
 * Web wrapper tests for getWorkerClient singleton.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWorkerClient, resetWorkerClient } from "./worker-client";

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
