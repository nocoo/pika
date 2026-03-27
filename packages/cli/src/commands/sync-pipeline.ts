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
  OpenCodeSqliteCursor,
  ParseError,
  ParseResult,
} from "@pika/core";
import { METADATA_BATCH_SIZE } from "@pika/core";
import type {
  DbDriver,
  DiscoverOpts,
  FileDriver,
  SyncContext,
} from "../drivers/types";
import type {
  BatchContentUploadResult,
  ContentUploadOptions,
} from "../upload/content";
import { uploadContentBatch } from "../upload/content";
import type {
  PrecomputedHashes,
  UploadEngineOptions,
  UploadResult,
} from "../upload/engine";
import {
  splitBatches,
  toSessionSnapshot,
  uploadMetadataBatches,
} from "../upload/engine";
import type { FileFingerprint } from "../utils/file-changed";

// ── Types ──────────────────────────────────────────────────────

/**
 * Progress callback for the sync pipeline.
 *
 * Injected by the CLI command to emit human-readable progress lines.
 * Tests leave it undefined — all logging is skipped.
 */
export interface SyncProgressLogger {
  /** Called once per source when discovery starts */
  discoverStart(source: string): void;
  /** Called once per source after discovery completes */
  discoverDone(source: string, fileCount: number): void;
  /** Called per file after parse completes */
  parseDone(source: string, filePath: string, sessionCount: number): void;
  /** Called once when the upload metadata stage starts */
  uploadMetadataStart(sessionCount: number): void;
  /** Called once after metadata upload completes */
  uploadMetadataDone(ingested: number, conflicts: number): void;
  /** Called once when content upload stage starts */
  uploadContentStart(sessionCount: number): void;
  /** Called per session when content upload completes */
  uploadContentProgress(done: number, total: number): void;
  /** Called once after all content uploads complete */
  uploadContentDone(uploaded: number, skipped: number, errors: number): void;
  /** Called once when the DB driver stage starts */
  dbDriverStart(source: string): void;
  /** Called once after DB driver completes */
  dbDriverDone(source: string, sessionCount: number): void;
}

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
  /** Content upload concurrency (default: CONTENT_UPLOAD_CONCURRENCY) */
  contentConcurrency?: number;
  /** Optional progress logger — omit to suppress all progress output */
  logger?: SyncProgressLogger;
}

export interface SyncPipelineInput {
  fileDrivers: FileDriver<FileCursorBase>[];
  /** DB driver for SQLite-based sources. Pass `undefined` explicitly when no DB driver exists. */
  dbDriver: DbDriver<OpenCodeSqliteCursor> | undefined;
  discoverOpts: DiscoverOpts;
  cursorState: CursorState;
  syncCtx: SyncContext;
}

export interface SyncPipelineResult {
  /** Total sessions parsed (with messages) across all sources */
  totalParsed: number;
  /** Total empty sessions filtered out (0 messages) */
  totalEmpty: number;
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
export async function getFingerprint(
  filePath: string,
): Promise<FileFingerprint> {
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
  const { fileDrivers, dbDriver, discoverOpts, syncCtx } = input;
  const log = opts.logger;

  const cursorState = {
    ...input.cursorState,
    files: { ...input.cursorState.files },
  };

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
    log?.discoverStart(driver.source);
    const files = await driver.discover(discoverOpts);
    log?.discoverDone(driver.source, files.length);

    for (const filePath of files) {
      totalFiles++;

      let fingerprint: FileFingerprint;
      try {
        fingerprint = await getFingerprint(filePath);
      } catch {
        // File may have been deleted between discover and stat
        continue;
      }

      const existingCursor = cursorState.files[filePath] as
        | FileCursorBase
        | undefined;

      if (driver.shouldSkip(existingCursor, fingerprint)) {
        totalSkipped++;
        continue;
      }

      const resume = driver.resumeState(existingCursor, fingerprint);

      try {
        const results = await driver.parse(filePath, resume);

        if (results.length > 0) {
          allResults.push(...results);
          log?.parseDone(driver.source, filePath, results.length);

          // Save previous cursor for rollback and map sessionKeys to filePath
          prevCursors.set(
            filePath,
            cursorState.files[filePath] as FileCursor | undefined,
          );
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
      log?.dbDriverStart(dbDriver.source);
      prevDbCursor = cursorState.openCodeSqlite;
      const dbResult = await dbDriver.run(prevDbCursor, syncCtx);
      allResults.push(...dbResult.results);
      for (const r of dbResult.results) {
        dbSourcedSessionKeys.add(r.canonical.sessionKey);
      }
      cursorState.openCodeSqlite = dbResult.cursor;
      log?.dbDriverDone(dbDriver.source, dbResult.results.length);
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

  // Filter out empty sessions (0 messages) — these are parser artefacts
  // from source files that contained only metadata and no real conversation.
  // Cursors are already saved above so empty files won't be re-parsed.
  const emptyCount = allResults.filter(
    (r) => r.canonical.messages.length === 0,
  ).length;
  const uploadableResults = allResults.filter(
    (r) => r.canonical.messages.length > 0,
  );

  let uploadResult: UploadResult | undefined;
  let contentResult: BatchContentUploadResult | undefined;

  if (opts.upload && uploadableResults.length > 0) {
    const uploadOpts: UploadEngineOptions = {
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      userId: opts.userId,
      fetch: opts.fetch,
      sleep: opts.sleep,
    };

    const contentOpts: ContentUploadOptions = {
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      fetch: opts.fetch,
      sleep: opts.sleep,
    };

    const totalSessions = uploadableResults.length;
    log?.uploadMetadataStart(totalSessions);

    // ── Batch upload: process PIPELINE_BATCH_SIZE sessions at a time ──
    // This prevents the entire session set from being serialized to JSON
    // and held in memory simultaneously. Each batch's JSON strings, gzip
    // buffers, and precomputed hashes are GC-eligible after the batch completes.
    const pipelineBatches = splitBatches(
      uploadableResults,
      METADATA_BATCH_SIZE,
    );

    // Aggregated results across all batches
    uploadResult = {
      totalIngested: 0,
      totalConflicts: 0,
      totalBatches: 0,
      errors: [],
    };
    contentResult = {
      uploaded: 0,
      skipped: 0,
      errors: [],
    };

    // Progress tracking for content upload (shared across batches)
    let contentDone = 0;
    log?.uploadContentStart(totalSessions);

    for (const batch of pipelineBatches) {
      // Transform to snapshots for this batch only (JSON + hashes)
      const transformed = batch.map((r) =>
        toSessionSnapshot(r.canonical, r.raw),
      );
      const batchSnapshots = transformed.map((t) => t.snapshot);
      const batchPrecomputed = new Map<string, PrecomputedHashes>();
      for (const t of transformed) {
        batchPrecomputed.set(t.snapshot.sessionKey, t.precomputed);
      }

      // Upload metadata for this batch
      const batchUploadResult = await uploadMetadataBatches(
        batchSnapshots,
        uploadOpts,
      );
      uploadResult.totalIngested += batchUploadResult.totalIngested;
      uploadResult.totalConflicts += batchUploadResult.totalConflicts;
      uploadResult.totalBatches += batchUploadResult.totalBatches;
      uploadResult.errors.push(...batchUploadResult.errors);

      // Wrap content upload to track per-session progress
      const wrappedContentOpts: ContentUploadOptions = { ...contentOpts };
      const originalFetch = contentOpts.fetch ?? globalThis.fetch;
      if (log) {
        const completedSessions = new Set<string>();
        wrappedContentOpts.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          const url =
            typeof input === "string" ? input : (input as Request).url;
          if (
            url.includes("/api/ingest/content/") &&
            url.endsWith("/canonical")
          ) {
            const parts = url.split("/");
            const sessionKey = decodeURIComponent(parts[parts.length - 2]);
            if (!completedSessions.has(sessionKey)) {
              completedSessions.add(sessionKey);
              contentDone++;
              log.uploadContentProgress(contentDone, totalSessions);
            }
          }
          return response;
        };
      }

      const batchContentResult = await uploadContentBatch(
        batch.map((r) => ({
          canonical: r.canonical,
          raw: r.raw,
          precomputed: batchPrecomputed.get(r.canonical.sessionKey),
        })),
        log ? wrappedContentOpts : contentOpts,
        opts.contentConcurrency,
      );

      contentResult.uploaded += batchContentResult.uploaded;
      contentResult.skipped += batchContentResult.skipped;
      contentResult.errors.push(...batchContentResult.errors);

      // ── Rollback cursors for sessions with content upload errors ──
      if (batchContentResult.errors.length > 0) {
        const rolledBackFiles = new Set<string>();
        let rollbackDbCursor = false;
        for (const { sessionKey } of batchContentResult.errors) {
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
          if (dbSourcedSessionKeys.has(sessionKey)) {
            rollbackDbCursor = true;
          }
        }
        if (rollbackDbCursor) {
          cursorState.openCodeSqlite = prevDbCursor;
        }
      }
    }

    log?.uploadMetadataDone(
      uploadResult.totalIngested,
      uploadResult.totalConflicts,
    );
    log?.uploadContentDone(
      contentResult.uploaded,
      contentResult.skipped,
      contentResult.errors.length,
    );
  }

  return {
    totalParsed: uploadableResults.length,
    totalEmpty: emptyCount,
    totalFiles,
    totalSkipped,
    parseErrors,
    uploadResult,
    contentResult,
    cursorState,
  };
}
