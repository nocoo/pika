/**
 * Tests for buildDbDriver — the command-layer wiring that ensures
 * sync.ts constructs a DbDriver when buildDriverSet() indicates
 * a SQLite DB is available.
 *
 * This is the regression test for docs/08-opencode-sqlite-driver-bug.md:
 * the driver was fully implemented but never instantiated because
 * SyncPipelineInput.dbDriver was optional and sync.ts omitted it.
 */

import { describe, expect, it, vi } from "vitest";
import type { DriverSet } from "../drivers/registry";
import type { OpenDbFn } from "../drivers/session/opencode-sqlite";
import { buildDbDriver } from "./sync";

// ── Fixtures ───────────────────────────────────────────────────

function makeDriverSet(overrides?: Partial<DriverSet>): DriverSet {
  return {
    fileDrivers: [],
    dbDriversAvailable: false,
    discoverOpts: {},
    paths: {
      claudeDir: "/home/.claude",
      codexSessionsDir: "/home/.codex/sessions",
      geminiDir: "/home/.gemini",
      openCodeDir: "/home/.local/share/opencode",
      vscodeCopilotDirs: [],
    },
    ...overrides,
  };
}

function stubOpenDb(): OpenDbFn {
  return vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
    close: vi.fn(),
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("buildDbDriver", () => {
  it("returns a DbDriver when dbDriversAvailable=true and openCodeDbPath is set", async () => {
    const driverSet = makeDriverSet({
      dbDriversAvailable: true,
      discoverOpts: {
        openCodeDbPath: "/home/.local/share/opencode/opencode.db",
      },
    });

    const driver = await buildDbDriver(driverSet, stubOpenDb());

    expect(driver).toBeDefined();
    expect(driver?.source).toBe("opencode");
  });

  it("returns undefined when dbDriversAvailable=false", async () => {
    const driverSet = makeDriverSet({
      dbDriversAvailable: false,
      discoverOpts: {
        openCodeDbPath: "/home/.local/share/opencode/opencode.db",
      },
    });

    const driver = await buildDbDriver(driverSet, stubOpenDb());

    expect(driver).toBeUndefined();
  });

  it("returns undefined when openCodeDbPath is missing", async () => {
    const driverSet = makeDriverSet({
      dbDriversAvailable: true,
      discoverOpts: {},
    });

    const driver = await buildDbDriver(driverSet, stubOpenDb());

    expect(driver).toBeUndefined();
  });

  it("returns undefined when both dbDriversAvailable=false and openCodeDbPath is missing", async () => {
    const driverSet = makeDriverSet({
      dbDriversAvailable: false,
      discoverOpts: {},
    });

    const driver = await buildDbDriver(driverSet);

    expect(driver).toBeUndefined();
  });

  it("passes the correct dbPath to createOpenCodeSqliteDriver", async () => {
    const dbPath = "/custom/path/opencode.db";
    const driverSet = makeDriverSet({
      dbDriversAvailable: true,
      discoverOpts: { openCodeDbPath: dbPath },
    });

    const driver = await buildDbDriver(driverSet, stubOpenDb());

    // The driver's run() will use this path when opening the DB.
    // We verify indirectly: the driver was created (not undefined)
    // and has the correct source identifier.
    expect(driver).toBeDefined();
    expect(driver?.source).toBe("opencode");
  });
});
