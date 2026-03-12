import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorStore } from "./cursor-store.js";
import type { CursorState, ClaudeCursor } from "@pika/core";

describe("CursorStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pika-cursor-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty state when file does not exist", async () => {
    const store = new CursorStore(tempDir);
    const state = await store.load();
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
    expect(state.updatedAt).toBeNull();
  });

  it("saves and loads cursor state round-trip", async () => {
    const store = new CursorStore(tempDir);
    const cursor: ClaudeCursor = {
      inode: 123,
      mtimeMs: 1709827200000,
      size: 4096,
      offset: 1024,
      updatedAt: "2026-03-07T10:00:00Z",
    };
    const state: CursorState = {
      version: 1,
      files: { "/path/to/file.jsonl": cursor },
      updatedAt: "2026-03-07T10:00:00Z",
    };
    await store.save(state);
    const loaded = await store.load();
    expect(loaded.files["/path/to/file.jsonl"]).toEqual(cursor);
    expect(loaded.updatedAt).toBe("2026-03-07T10:00:00Z");
  });

  it("creates nested directories on save", async () => {
    const nestedDir = join(tempDir, "deep", "nested");
    const store = new CursorStore(nestedDir);
    await store.save({ version: 1, files: {}, updatedAt: null });
    const loaded = await store.load();
    expect(loaded.version).toBe(1);
  });

  it("persists valid JSON to cursors.json", async () => {
    const store = new CursorStore(tempDir);
    await store.save({
      version: 1,
      files: {
        "/test": {
          inode: 1,
          mtimeMs: 1000,
          size: 500,
          offset: 0,
          updatedAt: "2026-01-01T00:00:00Z",
        } as ClaudeCursor,
      },
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const raw = await readFile(join(tempDir, "cursors.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.files["/test"].inode).toBe(1);
  });

  it("writes pretty-printed JSON with trailing newline", async () => {
    const store = new CursorStore(tempDir);
    await store.save({ version: 1, files: {}, updatedAt: null });
    const raw = await readFile(join(tempDir, "cursors.json"), "utf-8");
    expect(raw).toContain("\n");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
  });

  it("handles corrupted file gracefully", async () => {
    await writeFile(join(tempDir, "cursors.json"), "corrupted{{{");
    const store = new CursorStore(tempDir);
    const state = await store.load();
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
  });

  it("returns undefined for unknown file cursor", async () => {
    const store = new CursorStore(tempDir);
    const state = await store.load();
    expect(state.files["/nonexistent"]).toBeUndefined();
  });

  it("exposes filePath", () => {
    const store = new CursorStore(tempDir);
    expect(store.filePath).toBe(join(tempDir, "cursors.json"));
  });

  it("preserves dirMtimes and openCodeSqlite fields", async () => {
    const store = new CursorStore(tempDir);
    const state: CursorState = {
      version: 1,
      files: {},
      dirMtimes: { "/home/user/.local/share/opencode/storage/message/ses_abc": 1709827200000 },
      openCodeSqlite: {
        inode: 456,
        lastTimeCreated: "2026-03-07T09:00:00Z",
        updatedAt: "2026-03-07T10:00:00Z",
      },
      updatedAt: "2026-03-07T10:00:00Z",
    };
    await store.save(state);
    const loaded = await store.load();
    expect(loaded.dirMtimes).toEqual(state.dirMtimes);
    expect(loaded.openCodeSqlite).toEqual(state.openCodeSqlite);
  });
});
