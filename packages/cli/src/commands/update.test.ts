/**
 * Tests for pika update command.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process for the execSync in update.ts itself
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock cli-base - must use inline function to avoid hoisting issue
const mockDetectPackageManager = vi.fn();
const mockGetLatestVersion = vi.fn();
const mockGetUpdateCommand = vi.fn();

vi.mock("@nocoo/cli-base", async () => {
  const actual = await vi.importActual("@nocoo/cli-base");
  return {
    ...actual,
    consola: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    detectPackageManager: (...args: unknown[]) =>
      mockDetectPackageManager(...args),
    getLatestVersion: (...args: unknown[]) => mockGetLatestVersion(...args),
    getUpdateCommand: (...args: unknown[]) => mockGetUpdateCommand(...args),
  };
});

// Import after mocks are set up
import { execSync } from "node:child_process";
import { consola } from "@nocoo/cli-base";
import updateCommand from "./update";

describe("pika update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockReset();
    mockDetectPackageManager.mockReset();
    mockGetLatestVersion.mockReset();
    mockGetUpdateCommand.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("version check", () => {
    it("fetches latest version from npm registry", async () => {
      mockGetLatestVersion.mockResolvedValue("1.0.0");
      mockDetectPackageManager.mockReturnValue(null);

      await updateCommand.run?.({
        args: { check: true },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(mockGetLatestVersion).toHaveBeenCalledWith("@nocoo/pika");
    });

    it("shows message when already on latest version", async () => {
      mockGetLatestVersion.mockResolvedValue("0.6.3"); // Matches PIKA_VERSION

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
      mockGetLatestVersion.mockResolvedValue("99.0.0");

      await updateCommand.run?.({
        args: { check: true },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.info).toHaveBeenCalledWith(
        expect.stringContaining("Update available"),
      );
    });

    it("shows warning when npm registry fetch fails", async () => {
      mockGetLatestVersion.mockResolvedValue(null);

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.warn).toHaveBeenCalledWith(
        "Could not fetch latest version from npm registry",
      );
    });
  });

  describe("package manager detection", () => {
    it("detects bun installation", async () => {
      mockGetLatestVersion.mockResolvedValue("99.0.0");
      mockDetectPackageManager.mockReturnValue("bun");
      mockGetUpdateCommand.mockReturnValue("bun update -g @nocoo/pika");
      vi.mocked(execSync).mockReturnValue("");

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(consola.info).toHaveBeenCalledWith(
        "Detected package manager: bun",
      );
      expect(mockGetUpdateCommand).toHaveBeenCalledWith("bun", "@nocoo/pika");
    });

    it("shows manual instructions when package manager not detected", async () => {
      mockGetLatestVersion.mockResolvedValue("99.0.0");
      mockDetectPackageManager.mockReturnValue(null);

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
      mockGetLatestVersion.mockResolvedValue("99.0.0");
      mockDetectPackageManager.mockReturnValue("npm");
      mockGetUpdateCommand.mockReturnValue("npm update -g @nocoo/pika");
      vi.mocked(execSync).mockReturnValue("");

      await updateCommand.run?.({
        args: { check: false },
        rawArgs: [],
        cmd: updateCommand,
      });

      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        "npm update -g @nocoo/pika",
        { stdio: "inherit" },
      );
      expect(consola.success).toHaveBeenCalledWith("Update complete!");
    });

    it("shows error when update fails", async () => {
      mockGetLatestVersion.mockResolvedValue("99.0.0");
      mockDetectPackageManager.mockReturnValue("npm");
      mockGetUpdateCommand.mockReturnValue("npm update -g @nocoo/pika");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      await expect(
        updateCommand.run?.({
          args: { check: false },
          rawArgs: [],
          cmd: updateCommand,
        }),
      ).rejects.toThrow("Permission denied");

      expect(consola.error).toHaveBeenCalledWith(
        expect.stringContaining("Update failed"),
      );
    });
  });
});
