/**
 * Sync pipeline — orchestrates the full discover → parse → upload cycle.
 *
 * Extracted from the sync command for testability. All I/O is injected
 * via the `SyncDeps` interface.
 *
 * Pipeline stages:
 * 1. Discovery: find source files on disk
 * 2. Incremental parse: for each file, check cursor, parse from resume point
 * 3. Upload metadata: batch POST to API
 * 4. Upload content: PUT canonical + raw gzip to API
 * 5. Save cursors: persist cursor state after successful upload
 */

import { stat } from "node:fs/promises";
import type {
  CursorState,
  FileCursor,
  FileCursorBase,
  ParseResult,
  ParseError,
  OpenCodeSqliteCursor,
} from "@pika/core";
import type { FileDriver, DbDriver, DiscoverOpts, SyncContext } from "../drivers/types";
import type { FileFingerprint } from "../utils/file-changed";
import { toSessionSnapshot, uploadMetadataBatches } from "../upload/engine";
import type { UploadEngineOptions, UploadResult } from "../upload/engine";
import { uploadContentBatch } from "../upload/content";
import type { ContentUploadOptions, BatchContentUploadResult } from "../upload/content";

// ── Types ──────────────────────────────────────────────────────

export interface SyncPipelineOptions {
  /** Upload parsed sessions to API (default: true) */
  upload: boolean;
  /** API URL for uploads */
  apiUrl: string;
  /** API key for uploads */
  apiKey: string;
  /** User ID for upload payload */
  userId: string;
  /** Override fetch for testing */
  fetch?: typeof globalThis.fetch;
  /** Override sleep for testing */
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncPipelineInput {
  fileDrivers: FileDriver<FileCursorBase>[];
  dbDriver?: DbDriver<OpenCodeSqliteCursor>;
  discoverOpts: DiscoverOpts;
  cursorState: CursorState;
  syncCtx: SyncContext;
}

export interface SyncPipelineResult {
  /** Total sessions parsed across all sources */
  totalParsed: number;
  /** Total files scanned */
  totalFiles: number;
  /** Total files skipped (unchanged) */
  totalSkipped: number;
  /** Parse errors collected (non-blocking) */
  parseErrors: ParseError[];
  /** Upload result (if upload was enabled) */
  uploadResult?: UploadResult;
  /** Content upload result (if upload was enabled) */
  contentResult?: BatchContentUploadResult;
  /** Updated cursor state (always returned, caller saves) */
  cursorState: CursorState;
}

// ── File fingerprinting ────────────────────────────────────────

/** Get file fingerprint (inode, mtime, size) */
export async function getFingerprint(filePath: string): Promise<FileFingerprint> {
  const s = await stat(filePath);
  return {
    inode: s.ino,
    mtimeMs: s.mtimeMs,
    size: s.size,
  };
}

// ── Pipeline ───────────────────────────────────────────────────

/**
 * Execute the sync pipeline.
 *
 * This is the core orchestration function. It:
 * 1. Discovers files for each source driver
 * 2. Incrementally parses changed files
 * 3. Optionally uploads metadata + content
 * 4. Returns updated cursor state for persistence
 *
 * Parse errors are collected but do NOT block the pipeline.
 */
export async function runSyncPipeline(
  input: SyncPipelineInput,
  opts: SyncPipelineOptions,
): Promise<SyncPipelineResult> {
  const {
    fileDrivers,
    dbDriver,
    discoverOpts,
    syncCtx,
  } = input;

  let cursorState = { ...input.cursorState, files: { ...input.cursorState.files } };

  const allResults: ParseResult[] = [];
  const parseErrors: ParseError[] = [];
  let totalFiles = 0;
  let totalSkipped = 0;

  // Track sessionKey→filePath and save previous cursors for rollback on content failure
  const sessionKeyToFile = new Map<string, string>();
  const prevCursors = new Map<string, FileCursor | undefined>();
  // Track DB-sourced session keys for cursor rollback
  const dbSourcedSessionKeys = new Set<string>();
  let prevDbCursor: OpenCodeSqliteCursor | undefined;

  // ── Stage 1+2: Discover + incremental parse (file drivers) ──

  for (const driver of fileDrivers) {
    const files = await driver.discover(discoverOpts);

    for (const filePath of files) {
      totalFiles++;

      let fingerprint: FileFingerprint;
      try {
        fingerprint = await getFingerprint(filePath);
      } catch {
        // File may have been deleted between discover and stat
        continue;
      }

      const existingCursor = cursorState.files[filePath] as FileCursorBase | undefined;

      if (driver.shouldSkip(existingCursor, fingerprint)) {
        totalSkipped++;
        continue;
      }

      const resume = driver.resumeState(existingCursor, fingerprint);

      try {
        const results = await driver.parse(filePath, resume);

        if (results.length > 0) {
          allResults.push(...results);

          // Save previous cursor for rollback and map sessionKeys to filePath
          prevCursors.set(filePath, cursorState.files[filePath] as FileCursor | undefined);
          for (const r of results) {
            sessionKeyToFile.set(r.canonical.sessionKey, filePath);
          }

          // Build and save cursor for this file
          const newCursor = driver.buildCursor(fingerprint, results);
          cursorState.files[filePath] = newCursor as FileCursor;
        }
      } catch (err) {
        parseErrors.push({
          timestamp: new Date().toISOString(),
          source: driver.source,
          filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Stage 2b: DB drivers ──

  if (dbDriver) {
    try {
      prevDbCursor = cursorState.openCodeSqlite;
      const dbResult = await dbDriver.run(prevDbCursor, syncCtx);
      allResults.push(...dbResult.results);
      for (const r of dbResult.results) {
        dbSourcedSessionKeys.add(r.canonical.sessionKey);
      }
      cursorState.openCodeSqlite = dbResult.cursor;
    } catch (err) {
      parseErrors.push({
        timestamp: new Date().toISOString(),
        source: dbDriver.source,
        filePath: discoverOpts.openCodeDbPath ?? "opencode.db",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Persist dirMtimes from syncCtx ──
  // (dirMtimes no longer used — removed dir-level mtime skip optimization
  //  for OpenCode, which caused changed sessions to be missed when only
  //  message/part subdirs were updated. See Bug #4.)

  cursorState.updatedAt = new Date().toISOString();

  // ── Stage 3+4: Upload (if enabled and we have results) ──

  let uploadResult: UploadResult | undefined;
  let contentResult: BatchContentUploadResult | undefined;

  if (opts.upload && allResults.length > 0) {
    // Transform to snapshots for metadata upload
    const snapshots = allResults.map((r) =>
      toSessionSnapshot(r.canonical, r.raw),
    );

    const uploadOpts: UploadEngineOptions = {
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      userId: opts.userId,
      fetch: opts.fetch,
      sleep: opts.sleep,
    };

    uploadResult = await uploadMetadataBatches(snapshots, uploadOpts);

    // Upload content
    const contentOpts: ContentUploadOptions = {
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      fetch: opts.fetch,
      sleep: opts.sleep,
    };

    contentResult = await uploadContentBatch(
      allResults.map((r) => ({ canonical: r.canonical, raw: r.raw })),
      contentOpts,
    );

    // ── Rollback cursors for sessions with content upload errors ──
    // This ensures next sync will re-parse and re-upload failed sessions.
    if (contentResult.errors.length > 0) {
      const rolledBackFiles = new Set<string>();
      let rollbackDbCursor = false;
      for (const { sessionKey } of contentResult.errors) {
        // Check file-sourced sessions
        const filePath = sessionKeyToFile.get(sessionKey);
        if (filePath && !rolledBackFiles.has(filePath)) {
          rolledBackFiles.add(filePath);
          const prev = prevCursors.get(filePath);
          if (prev === undefined) {
            delete cursorState.files[filePath];
          } else {
            cursorState.files[filePath] = prev;
          }
        }
        // Check DB-sourced sessions
        if (dbSourcedSessionKeys.has(sessionKey)) {
          rollbackDbCursor = true;
        }
      }
      if (rollbackDbCursor) {
        cursorState.openCodeSqlite = prevDbCursor;
      }
    }
  }

  return {
    totalParsed: allResults.length,
    totalFiles,
    totalSkipped,
    parseErrors,
    uploadResult,
    contentResult,
    cursorState,
  };
}
