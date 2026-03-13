import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "./manager";

describe("ConfigManager", () => {
  let tempDir: string;
  let manager: ConfigManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pika-test-"));
    manager = new ConfigManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── read / write config ────────────────────────────────────

  it("returns empty config when file does not exist", () => {
    const config = manager.read();
    expect(config).toEqual({});
  });

  it("writes and reads config", () => {
    manager.write({ token: "pk_" + "a".repeat(32) });
    const config = manager.read();
    expect(config.token).toBe("pk_" + "a".repeat(32));
  });

  it("preserves existing fields on partial write", () => {
    manager.write({ token: "pk_" + "a".repeat(32), deviceId: "uuid-1" });
    manager.write({ token: "pk_" + "b".repeat(32) });
    const config = manager.read();
    expect(config.token).toBe("pk_" + "b".repeat(32));
    expect(config.deviceId).toBe("uuid-1");
  });

  it("creates config directory if missing", () => {
    const nestedDir = join(tempDir, "deep", "nested");
    const mgr = new ConfigManager(nestedDir);
    mgr.write({ token: "pk_" + "c".repeat(32) });
    const config = mgr.read();
    expect(config.token).toBe("pk_" + "c".repeat(32));
  });

  // ── dev mode ───────────────────────────────────────────────

  it("reads dev config separately", () => {
    const devManager = new ConfigManager(tempDir, true);
    devManager.write({ token: "pk_" + "d".repeat(32) });

    // Regular config should be empty
    const regular = manager.read();
    expect(regular.token).toBeUndefined();

    // Dev config should have the token
    const dev = devManager.read();
    expect(dev.token).toBe("pk_" + "d".repeat(32));
  });

  // ── token helpers ──────────────────────────────────────────

  it("getToken returns undefined when no config", () => {
    expect(manager.getToken()).toBeUndefined();
  });

  it("getToken returns stored token", () => {
    manager.write({ token: "pk_" + "e".repeat(32) });
    expect(manager.getToken()).toBe("pk_" + "e".repeat(32));
  });

  it("isLoggedIn returns false when no token", () => {
    expect(manager.isLoggedIn()).toBe(false);
  });

  it("isLoggedIn returns true when token exists", () => {
    manager.write({ token: "pk_" + "f".repeat(32) });
    expect(manager.isLoggedIn()).toBe(true);
  });

  // ── getApiUrl ──────────────────────────────────────────────

  it("getApiUrl returns production URL by default", () => {
    expect(manager.getApiUrl()).toBe("https://pika.nocoo.dev");
  });

  it("getApiUrl returns dev URL in dev mode", () => {
    const devManager = new ConfigManager(tempDir, true);
    expect(devManager.getApiUrl()).toBe("http://localhost:7040");
  });

  // ── getDeviceId ────────────────────────────────────────────

  it("generates and persists deviceId on first call", () => {
    const id = manager.getDeviceId();
    expect(id).toBeTruthy();
    // UUID v4 format
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // Should return the same ID on subsequent calls
    expect(manager.getDeviceId()).toBe(id);
  });

  it("reuses existing deviceId", () => {
    manager.write({ deviceId: "existing-uuid" });
    expect(manager.getDeviceId()).toBe("existing-uuid");
  });

  // ── configPath ─────────────────────────────────────────────

  it("exposes configDir", () => {
    expect(manager.configDir).toBe(tempDir);
  });
});
