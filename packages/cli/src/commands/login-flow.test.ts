import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import { ConfigManager } from "../config/manager.js";
import { performLogin, type LoginDeps } from "./login-flow.js";
import { LOGIN_TIMEOUT_MS } from "@pika/core";

describe("login flow", () => {
  let tempDir: string;
  let config: ConfigManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pika-login-test-"));
    config = new ConfigManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves token on successful callback", async () => {
    const apiKey = "pk_" + "a".repeat(32);
    const email = "user@example.com";

    // Mock deps
    const deps: LoginDeps = {
      openBrowser: vi.fn().mockResolvedValue(undefined),
      config,
      apiUrl: "http://localhost:9999",
      timeoutMs: 5000,
    };

    // Start login in background
    const loginPromise = performLogin(deps);

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 100));

    // Find the port by inspecting the openBrowser call
    const callbackUrl = (deps.openBrowser as any).mock.calls[0][0] as string;
    expect(callbackUrl).toContain("/api/auth/cli?callback=");

    // Extract the callback URL from the query
    const url = new URL(callbackUrl);
    const cliCallback = url.searchParams.get("callback");
    expect(cliCallback).toBeTruthy();

    // Simulate the server redirecting back to CLI callback
    const callbackWithToken = `${cliCallback}?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
    const res = await fetch(callbackWithToken);
    expect(res.ok).toBe(true);

    // Wait for login to complete
    const result = await loginPromise;
    expect(result.success).toBe(true);
    expect(result.email).toBe(email);

    // Token should be saved
    expect(config.getToken()).toBe(apiKey);
  });

  it("respects force flag (re-login when already logged in)", async () => {
    config.write({ token: "pk_" + "b".repeat(32) });
    const newApiKey = "pk_" + "c".repeat(32);

    const deps: LoginDeps = {
      openBrowser: vi.fn().mockResolvedValue(undefined),
      config,
      apiUrl: "http://localhost:9999",
      timeoutMs: 5000,
    };

    const loginPromise = performLogin(deps);
    await new Promise((r) => setTimeout(r, 100));

    const callbackUrl = (deps.openBrowser as any).mock.calls[0][0] as string;
    const url = new URL(callbackUrl);
    const cliCallback = url.searchParams.get("callback");
    await fetch(`${cliCallback}?api_key=${newApiKey}&email=new@example.com`);

    const result = await loginPromise;
    expect(result.success).toBe(true);
    expect(config.getToken()).toBe(newApiKey);
  });

  it("returns error when callback has no api_key", async () => {
    const deps: LoginDeps = {
      openBrowser: vi.fn().mockResolvedValue(undefined),
      config,
      apiUrl: "http://localhost:9999",
      timeoutMs: 5000,
    };

    const loginPromise = performLogin(deps);
    await new Promise((r) => setTimeout(r, 100));

    const callbackUrl = (deps.openBrowser as any).mock.calls[0][0] as string;
    const url = new URL(callbackUrl);
    const cliCallback = url.searchParams.get("callback");

    // Hit callback without api_key
    const res = await fetch(`${cliCallback}?error=access_denied`);
    expect(res.status).toBe(400);

    const result = await loginPromise;
    expect(result.success).toBe(false);
  });

  it("times out after configured duration", async () => {
    const deps: LoginDeps = {
      openBrowser: vi.fn().mockResolvedValue(undefined),
      config,
      apiUrl: "http://localhost:9999",
      timeoutMs: 200, // Very short timeout for test
    };

    const result = await performLogin(deps);
    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("calls log callback with URL when browser open fails", async () => {
    const logFn = vi.fn();
    const deps: LoginDeps = {
      openBrowser: vi.fn().mockRejectedValue(new Error("no browser")),
      log: logFn,
      config,
      apiUrl: "http://localhost:9999",
      timeoutMs: 5000,
    };

    const loginPromise = performLogin(deps);
    await new Promise((r) => setTimeout(r, 200));

    // log should have been called with the manual URL
    expect(logFn).toHaveBeenCalledTimes(1);
    expect(logFn.mock.calls[0][0]).toContain("Could not open browser");
    expect(logFn.mock.calls[0][0]).toContain("/api/auth/cli?callback=");

    // Complete the flow so the test doesn't hang
    const callbackUrl = (deps.openBrowser as any).mock.calls[0][0] as string;
    const url = new URL(callbackUrl);
    const cliCallback = url.searchParams.get("callback")!;
    await fetch(`${cliCallback}?api_key=pk_${"f".repeat(32)}&email=t@t.com`);
    await loginPromise;
  });

  it("handles non-callback paths with 404", async () => {
    const deps: LoginDeps = {
      openBrowser: vi.fn().mockResolvedValue(undefined),
      config,
      apiUrl: "http://localhost:9999",
      timeoutMs: 5000,
    };

    const loginPromise = performLogin(deps);
    await new Promise((r) => setTimeout(r, 100));

    const callbackUrl = (deps.openBrowser as any).mock.calls[0][0] as string;
    const url = new URL(callbackUrl);
    const cliCallback = url.searchParams.get("callback")!;
    const callbackParsed = new URL(cliCallback);
    const port = callbackParsed.port;

    // Hit a random path
    const res = await fetch(`http://localhost:${port}/random`);
    expect(res.status).toBe(404);

    // Now hit the real callback to let the test finish
    await fetch(`${cliCallback}?api_key=pk_${"d".repeat(32)}&email=test@test.com`);
    await loginPromise;
  });
});
