/**
 * Tests for pika update command.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process BEFORE importing the module
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock consola
vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocks are set up
import { execSync } from "node:child_process";
import { consola } from "consola";
import updateCommand from "./update";

describe("pika update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("version check", () => {
    it("fetches latest version from npm registry", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      });

      // Mock package manager detection to fail (so we don't try to update)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Not found");
      });

      await updateCommand.run?.({
        args: { check: true },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/@pika/cli/latest",
      );
    });

    it("shows message when already on latest version", async () => {
      // Mock current version matches latest
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.6.1" }), // Matches PIKA_VERSION
      });

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.success).toHaveBeenCalledWith(
        "You are already on the latest version!",
      );
    });

    it("shows update available in check mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      });

      await updateCommand.run?.({
        args: { check: true },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.info).toHaveBeenCalledWith(
        expect.stringContaining("Update available"),
      );
    });
  });

  describe("package manager detection", () => {
    it("detects bun installation (first in order)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        // Only bun should find the package (checked first)
        if (cmd.includes("bun pm ls -g")) {
          return "@pika/cli@0.5.7";
        }
        if (cmd.includes("bun update -g")) {
          return ""; // Success
        }
        // All other package managers should fail
        throw new Error("Not found");
      });

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.info).toHaveBeenCalledWith(
        "Detected package manager: bun",
      );
    });

    it("shows manual instructions when package manager not detected", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      });

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Not found");
      });

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not detect package manager"),
      );
    });
  });

  describe("update execution", () => {
    it("runs npm update command", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      });

      let updateCalled = false;
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("npm list -g")) {
          return "@pika/cli@0.5.7";
        }
        if (cmd.includes("npm update -g")) {
          updateCalled = true;
          return "";
        }
        throw new Error("Not found");
      });

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(updateCalled).toBe(true);
      expect(consola.success).toHaveBeenCalledWith("Update complete!");
    });
  });
});
