/**
 * Sync pipeline — orchestrates the full discover → parse → upload cycle.
 *
 * Extracted from the sync command for testability. All I/O is injected
 * via the `SyncDeps` interface.
 *
 * Pipeline stages:
 * 1. Discovery: find source files on disk
 * 2. Incremental parse: for each file, check cursor, parse from resume point
 * 3. Streaming upload: per batch (METADATA_BATCH_SIZE sessions):
 *    a. Upload metadata (batch POST)
 *    b. Upload content (PUT canonical + raw gzip)
 *    c. Release batch memory (clear raw, reset accumulator)
 * 4. Save cursors: persist cursor state after successful upload
 *
 * Memory model: only one batch (~50 sessions) is held in memory at a time.
 * Peak RSS is bounded by ~1-2 GB regardless of total session count.
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
import type { UploadEngineOptions, UploadResult } from "../upload/engine";
import { toSessionSnapshot, uploadMetadataBatches } from "../upload/engine";
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
 * 3. Optionally uploads metadata + content in streaming batches
 * 4. Returns updated cursor state for persistence
 *
 * Parse errors are collected but do NOT block the pipeline.
 *
 * Memory is bounded: only one batch (~METADATA_BATCH_SIZE sessions)
 * is held at a time. After each batch is uploaded, raw data is released.
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

  // Aggregated counters
  let totalParsed = 0;
  let totalEmpty = 0;
  let totalFiles = 0;
  let totalSkipped = 0;
  const parseErrors: ParseError[] = [];

  // Streaming batch state — only holds one batch worth of data at a time
  const currentBatch: ParseResult[] = [];
  const batchSessionToFile = new Map<string, string>();
  const batchPrevCursors = new Map<string, FileCursor | undefined>();
  // Track DB-sourced session keys for cursor rollback
  const dbSourcedSessionKeys = new Set<string>();
  let prevDbCursor: OpenCodeSqliteCursor | undefined;

  // Upload aggregation (initialized on first batch)
  let uploadResult: UploadResult | undefined;
  let contentResult: BatchContentUploadResult | undefined;
  let uploadOpts: UploadEngineOptions | undefined;
  let contentOpts: ContentUploadOptions | undefined;

  // Content progress tracking across batches
  let contentProgressDone = 0;

  // ── Batch flush: metadata upload → content upload → release memory ──

  async function flushBatch(): Promise<void> {
    if (currentBatch.length === 0) return;

    // Filter empty sessions (0 messages) — parser artefacts
    const batchEmpty = currentBatch.filter(
      (r) => r.canonical.messages.length === 0,
    ).length;
    const uploadable = currentBatch.filter(
      (r) => r.canonical.messages.length > 0,
    );
    totalEmpty += batchEmpty;

    if (uploadable.length === 0 || !opts.upload) {
      totalParsed += uploadable.length;
      currentBatch.length = 0;
      batchSessionToFile.clear();
      batchPrevCursors.clear();
      return;
    }

    // Initialize upload state on first batch
    if (!uploadOpts) {
      uploadOpts = {
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
        userId: opts.userId,
        fetch: opts.fetch,
        sleep: opts.sleep,
      };
      contentOpts = {
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
        fetch: opts.fetch,
        sleep: opts.sleep,
      };
      uploadResult = {
        totalIngested: 0,
        totalConflicts: 0,
        totalBatches: 0,
        errors: [],
      };
      contentResult = { uploaded: 0, skipped: 0, errors: [] };
    }

    // ── Phase 1: Metadata upload ──
    // Single toSessionSnapshot() call per session — compute hashes once
    const transformed = uploadable.map((r) =>
      toSessionSnapshot(r.canonical, r.raw),
    );
    const batchSnapshots = transformed.map((t) => t.snapshot);

    const batchUploadResult = await uploadMetadataBatches(
      batchSnapshots,
      uploadOpts,
    );
    uploadResult.totalIngested += batchUploadResult.totalIngested;
    uploadResult.totalConflicts += batchUploadResult.totalConflicts;
    uploadResult.totalBatches += batchUploadResult.totalBatches;
    uploadResult.errors.push(...batchUploadResult.errors);

    // ── Phase 2: Content upload (reuse precomputed hashes) ──
    // Wrap fetch for per-session progress tracking
    const effectiveContentOpts: ContentUploadOptions = { ...contentOpts };
    if (log) {
      const completedSessions = new Set<string>();
      const originalFetch = contentOpts.fetch ?? globalThis.fetch;
      effectiveContentOpts.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        const url = typeof input === "string" ? input : (input as Request).url;
        if (
          url.includes("/api/ingest/content/") &&
          url.endsWith("/canonical")
        ) {
          const parts = url.split("/");
          const sessionKey = decodeURIComponent(parts[parts.length - 2]);
          if (!completedSessions.has(sessionKey)) {
            completedSessions.add(sessionKey);
            contentProgressDone++;
            log.uploadContentProgress(
              contentProgressDone,
              totalParsed + uploadable.length,
            );
          }
        }
        return response;
      };
    }

    const batchContentResult = await uploadContentBatch(
      uploadable.map((r, i) => ({
        canonical: r.canonical,
        raw: r.raw,
        precomputed: transformed[i].precomputed,
      })),
      log ? effectiveContentOpts : contentOpts,
      opts.contentConcurrency,
    );

    contentResult.uploaded += batchContentResult.uploaded;
    contentResult.skipped += batchContentResult.skipped;
    contentResult.errors.push(...batchContentResult.errors);

    // ── Cursor rollback for sessions with content upload errors ──
    if (batchContentResult.errors.length > 0) {
      const rolledBackFiles = new Set<string>();
      let rollbackDbCursor = false;
      for (const { sessionKey } of batchContentResult.errors) {
        const filePath = batchSessionToFile.get(sessionKey);
        if (filePath && !rolledBackFiles.has(filePath)) {
          rolledBackFiles.add(filePath);
          const prev = batchPrevCursors.get(filePath);
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

    totalParsed += uploadable.length;

    // ── Release memory for this batch ──
    // Clear raw (JSON archive) and messages (large array) — both are already
    // serialized by toSessionSnapshot() and no longer needed after upload.
    for (const r of currentBatch) {
      r.raw = undefined;
      r.canonical.messages = [];
    }
    currentBatch.length = 0;
    batchSessionToFile.clear();
    batchPrevCursors.clear();
  }

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
          currentBatch.push(...results);
          log?.parseDone(driver.source, filePath, results.length);

          // Save previous cursor for rollback and map sessionKeys to filePath
          batchPrevCursors.set(
            filePath,
            cursorState.files[filePath] as FileCursor | undefined,
          );
          for (const r of results) {
            batchSessionToFile.set(r.canonical.sessionKey, filePath);
          }

          // Build and save cursor for this file
          const newCursor = driver.buildCursor(fingerprint, results);
          cursorState.files[filePath] = newCursor as FileCursor;

          // Flush batch when it reaches capacity
          if (currentBatch.length >= METADATA_BATCH_SIZE) {
            await flushBatch();
          }
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
      const dbResult = await dbDriver.run(prevDbCursor, syncCtx, async (r) => {
        currentBatch.push(r);
        dbSourcedSessionKeys.add(r.canonical.sessionKey);

        // Flush in METADATA_BATCH_SIZE chunks to bound memory
        if (currentBatch.length >= METADATA_BATCH_SIZE) {
          await flushBatch();
        }
      });
      cursorState.openCodeSqlite = dbResult.cursor;
      log?.dbDriverDone(dbDriver.source, dbResult.rowCount);

      // Fallback: process any results returned in the array (e.g., mocks that
      // don't support the onResult callback). When onResult is used, this is a
      // no-op since results[] is empty.
      for (const r of dbResult.results) {
        currentBatch.push(r);
        dbSourcedSessionKeys.add(r.canonical.sessionKey);
        if (currentBatch.length >= METADATA_BATCH_SIZE) {
          await flushBatch();
        }
      }
    } catch (err) {
      parseErrors.push({
        timestamp: new Date().toISOString(),
        source: dbDriver.source,
        filePath: discoverOpts.openCodeDbPath ?? "opencode.db",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Flush remaining partial batch
  await flushBatch();

  // ── Fire logger stage callbacks (summary after all batches complete) ──
  // Fires in correct ordering contract: metadataStart → metadataDone → contentStart → contentDone
  if (uploadResult) {
    log?.uploadMetadataStart(totalParsed);
    log?.uploadMetadataDone(
      uploadResult.totalIngested,
      uploadResult.totalConflicts,
    );
  }
  if (contentResult) {
    log?.uploadContentStart(totalParsed);
    log?.uploadContentDone(
      contentResult.uploaded,
      contentResult.skipped,
      contentResult.errors.length,
    );
  }

  cursorState.updatedAt = new Date().toISOString();

  return {
    totalParsed,
    totalEmpty,
    totalFiles,
    totalSkipped,
    parseErrors,
    uploadResult,
    contentResult,
    cursorState,
  };
}
