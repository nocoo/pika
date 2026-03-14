/**
 * Tests for driver registry.
 *
 * Covers: resolveDefaultPaths, buildDriverSet (with mocked fs)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveDefaultPaths, buildDriverSet } from "./registry";

// ---------------------------------------------------------------------------
// resolveDefaultPaths
// ---------------------------------------------------------------------------

describe("resolveDefaultPaths", () => {
  it("resolves paths relative to provided home directory", () => {
    const paths = resolveDefaultPaths("/test/home");
    expect(paths.claudeDir).toBe("/test/home/.claude");
    expect(paths.codexSessionsDir).toBe("/test/home/.codex/sessions");
    expect(paths.geminiDir).toBe("/test/home/.gemini");
    expect(paths.openCodeDir).toBe("/test/home/.local/share/opencode");
    expect(paths.vscodeCopilotDirs).toHaveLength(2);
    expect(paths.vscodeCopilotDirs[0]).toContain("Code/User");
    expect(paths.vscodeCopilotDirs[1]).toContain("Code - Insiders/User");
  });

  it("uses os.homedir() when no home provided", () => {
    const paths = resolveDefaultPaths();
    // Should not throw and should return absolute paths
    expect(paths.claudeDir).toMatch(/^\//);
    expect(paths.codexSessionsDir).toMatch(/^\//);
  });
});

// ---------------------------------------------------------------------------
// buildDriverSet
// ---------------------------------------------------------------------------

describe("buildDriverSet", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pika-registry-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty driver set when no source directories exist", async () => {
    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope-claude"),
      codexSessionsDir: join(tmpDir, "nope-codex"),
      geminiDir: join(tmpDir, "nope-gemini"),
      openCodeDir: join(tmpDir, "nope-opencode"),
      vscodeCopilotDirs: [join(tmpDir, "nope-vscode")],
    });

    expect(result.fileDrivers).toHaveLength(0);
    expect(result.dbDriversAvailable).toBe(false);
    expect(result.discoverOpts).toEqual({});
  });

  it("includes Claude driver when .claude dir exists", async () => {
    const claudeDir = join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir,
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [],
    });

    expect(result.fileDrivers).toHaveLength(1);
    expect(result.fileDrivers[0].source).toBe("claude-code");
    expect(result.discoverOpts.claudeDir).toBe(claudeDir);
  });

  it("includes Codex driver when .codex/sessions dir exists", async () => {
    const codexDir = join(tmpDir, ".codex", "sessions");
    await mkdir(codexDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: codexDir,
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [],
    });

    expect(result.fileDrivers).toHaveLength(1);
    expect(result.fileDrivers[0].source).toBe("codex");
    expect(result.discoverOpts.codexSessionsDir).toBe(codexDir);
  });

  it("includes Gemini driver when .gemini dir exists", async () => {
    const geminiDir = join(tmpDir, ".gemini");
    await mkdir(geminiDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir,
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [],
    });

    expect(result.fileDrivers).toHaveLength(1);
    expect(result.fileDrivers[0].source).toBe("gemini-cli");
    expect(result.discoverOpts.geminiDir).toBe(geminiDir);
  });

  it("includes OpenCode file driver when opencode dir exists", async () => {
    const ocDir = join(tmpDir, "opencode");
    await mkdir(ocDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: ocDir,
      vscodeCopilotDirs: [],
    });

    expect(result.fileDrivers).toHaveLength(1);
    expect(result.fileDrivers[0].source).toBe("opencode");
    expect(result.discoverOpts.openCodeMessageDir).toBe(
      join(ocDir, "storage", "message"),
    );
  });

  it("sets dbDriversAvailable when opencode.db exists", async () => {
    const ocDir = join(tmpDir, "opencode");
    await mkdir(ocDir, { recursive: true });
    await writeFile(join(ocDir, "opencode.db"), "");

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: ocDir,
      vscodeCopilotDirs: [],
    });

    expect(result.dbDriversAvailable).toBe(true);
    expect(result.discoverOpts.openCodeDbPath).toBe(
      join(ocDir, "opencode.db"),
    );
  });

  it("does not set dbDriversAvailable when only dir exists (no .db file)", async () => {
    const ocDir = join(tmpDir, "opencode");
    await mkdir(ocDir, { recursive: true });
    // No opencode.db file

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: ocDir,
      vscodeCopilotDirs: [],
    });

    expect(result.dbDriversAvailable).toBe(false);
    expect(result.discoverOpts.openCodeDbPath).toBeUndefined();
  });

  it("includes VSCode Copilot driver when at least one dir exists", async () => {
    const vscodeDir = join(tmpDir, "Code", "User");
    await mkdir(vscodeDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [vscodeDir, join(tmpDir, "nope-insiders")],
    });

    expect(result.fileDrivers).toHaveLength(1);
    expect(result.fileDrivers[0].source).toBe("vscode-copilot");
    expect(result.discoverOpts.vscodeCopilotDirs).toEqual([vscodeDir]);
  });

  it("includes both VSCode dirs when both exist", async () => {
    const dir1 = join(tmpDir, "Code", "User");
    const dir2 = join(tmpDir, "Code - Insiders", "User");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });

    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [dir1, dir2],
    });

    expect(result.discoverOpts.vscodeCopilotDirs).toEqual([dir1, dir2]);
  });

  it("excludes VSCode Copilot driver when no dirs exist", async () => {
    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [join(tmpDir, "nope1"), join(tmpDir, "nope2")],
    });

    expect(result.fileDrivers).toHaveLength(0);
    expect(result.discoverOpts.vscodeCopilotDirs).toBeUndefined();
  });

  it("includes all drivers when all source directories exist", async () => {
    const claudeDir = join(tmpDir, ".claude");
    const codexDir = join(tmpDir, ".codex", "sessions");
    const geminiDir = join(tmpDir, ".gemini");
    const ocDir = join(tmpDir, "opencode");
    const vscodeDir = join(tmpDir, "Code", "User");

    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await mkdir(geminiDir, { recursive: true });
    await mkdir(ocDir, { recursive: true });
    await writeFile(join(ocDir, "opencode.db"), "");
    await mkdir(vscodeDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir,
      codexSessionsDir: codexDir,
      geminiDir,
      openCodeDir: ocDir,
      vscodeCopilotDirs: [vscodeDir],
    });

    expect(result.fileDrivers).toHaveLength(5);
    const sources = result.fileDrivers.map((d) => d.source).sort();
    expect(sources).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "opencode",
      "vscode-copilot",
    ]);
    expect(result.dbDriversAvailable).toBe(true);
  });

  it("maintains driver ordering: claude, codex, gemini, opencode, vscode", async () => {
    const claudeDir = join(tmpDir, ".claude");
    const codexDir = join(tmpDir, ".codex", "sessions");
    const geminiDir = join(tmpDir, ".gemini");
    const ocDir = join(tmpDir, "opencode");
    const vscodeDir = join(tmpDir, "Code", "User");

    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await mkdir(geminiDir, { recursive: true });
    await mkdir(ocDir, { recursive: true });
    await mkdir(vscodeDir, { recursive: true });

    const result = await buildDriverSet({
      claudeDir,
      codexSessionsDir: codexDir,
      geminiDir,
      openCodeDir: ocDir,
      vscodeCopilotDirs: [vscodeDir],
    });

    // Order should be deterministic
    expect(result.fileDrivers[0].source).toBe("claude-code");
    expect(result.fileDrivers[1].source).toBe("codex");
    expect(result.fileDrivers[2].source).toBe("gemini-cli");
    expect(result.fileDrivers[3].source).toBe("opencode");
    expect(result.fileDrivers[4].source).toBe("vscode-copilot");
  });

  it("returns resolved paths in the result", async () => {
    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "x"),
      codexSessionsDir: join(tmpDir, "y"),
      geminiDir: join(tmpDir, "z"),
      openCodeDir: join(tmpDir, "oc"),
      vscodeCopilotDirs: [],
    });

    expect(result.paths.claudeDir).toBe(join(tmpDir, "x"));
    expect(result.paths.codexSessionsDir).toBe(join(tmpDir, "y"));
    expect(result.paths.geminiDir).toBe(join(tmpDir, "z"));
    expect(result.paths.openCodeDir).toBe(join(tmpDir, "oc"));
  });

  it("handles empty vscodeCopilotDirs array", async () => {
    const result = await buildDriverSet({
      claudeDir: join(tmpDir, "nope"),
      codexSessionsDir: join(tmpDir, "nope"),
      geminiDir: join(tmpDir, "nope"),
      openCodeDir: join(tmpDir, "nope"),
      vscodeCopilotDirs: [],
    });

    expect(result.discoverOpts.vscodeCopilotDirs).toBeUndefined();
  });

  // ── sourceFilter ────────────────────────────────────────────────

  describe("sourceFilter", () => {
    async function setupAllSources(base: string) {
      const claudeDir = join(base, ".claude");
      const codexDir = join(base, ".codex", "sessions");
      const geminiDir = join(base, ".gemini");
      const ocDir = join(base, "opencode");
      const vscodeDir = join(base, "Code", "User");

      await mkdir(claudeDir, { recursive: true });
      await mkdir(codexDir, { recursive: true });
      await mkdir(geminiDir, { recursive: true });
      await mkdir(ocDir, { recursive: true });
      await writeFile(join(ocDir, "opencode.db"), "");
      await mkdir(vscodeDir, { recursive: true });

      return { claudeDir, codexSessionsDir: codexDir, geminiDir, openCodeDir: ocDir, vscodeCopilotDirs: [vscodeDir] };
    }

    it("returns all drivers when sourceFilter is undefined", async () => {
      const paths = await setupAllSources(tmpDir);
      const result = await buildDriverSet(paths, undefined, undefined);

      expect(result.fileDrivers).toHaveLength(5);
      expect(result.dbDriversAvailable).toBe(true);
    });

    it("filters to single source", async () => {
      const paths = await setupAllSources(tmpDir);
      const result = await buildDriverSet(paths, undefined, new Set(["claude-code"]));

      expect(result.fileDrivers).toHaveLength(1);
      expect(result.fileDrivers[0].source).toBe("claude-code");
      expect(result.dbDriversAvailable).toBe(false);
    });

    it("filters to multiple sources", async () => {
      const paths = await setupAllSources(tmpDir);
      const result = await buildDriverSet(paths, undefined, new Set(["gemini-cli", "codex"]));

      expect(result.fileDrivers).toHaveLength(2);
      const sources = result.fileDrivers.map((d) => d.source);
      expect(sources).toContain("codex");
      expect(sources).toContain("gemini-cli");
      expect(result.dbDriversAvailable).toBe(false);
    });

    it("includes opencode DB when opencode is in filter", async () => {
      const paths = await setupAllSources(tmpDir);
      const result = await buildDriverSet(paths, undefined, new Set(["opencode"]));

      expect(result.fileDrivers).toHaveLength(1);
      expect(result.fileDrivers[0].source).toBe("opencode");
      expect(result.dbDriversAvailable).toBe(true);
    });

    it("excludes opencode DB when opencode is not in filter", async () => {
      const paths = await setupAllSources(tmpDir);
      const result = await buildDriverSet(paths, undefined, new Set(["claude-code"]));

      expect(result.dbDriversAvailable).toBe(false);
    });

    it("returns empty drivers when filter matches no existing sources", async () => {
      const result = await buildDriverSet(
        {
          claudeDir: join(tmpDir, "nope"),
          codexSessionsDir: join(tmpDir, "nope"),
          geminiDir: join(tmpDir, "nope"),
          openCodeDir: join(tmpDir, "nope"),
          vscodeCopilotDirs: [],
        },
        undefined,
        new Set(["claude-code"]),
      );

      expect(result.fileDrivers).toHaveLength(0);
    });
  });
});
