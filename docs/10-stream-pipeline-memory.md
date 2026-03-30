# 10 — Sync Pipeline Memory Optimization: Stream-based Batching

> **Status**: Draft — pending review before implementation
> **Date**: 2026-03-30
> **Scope**: `packages/cli/src/commands/sync-pipeline.ts`

## Problem

Running `pika sync` against a large corpus (~5,800 sessions) reaches **14.3 GB RSS** (10.7% system memory). The root cause is the monolithic `allResults[]` array that accumulates ALL parsed sessions before any upload begins.

### Memory profile

| Component | Per session | x5,800 sessions |
|-----------|-------------|-----------------|
| `canonical` (with `messages[]`) | ~1.5 MB | ~8.7 GB |
| `raw` (JSON string) | ~5 MB | ~29 GB |
| `toSessionSnapshot()` copies | ~6.5 MB | ~37.7 GB |
| **Total theoretical peak** | ~13 MB | **~43 GB** |

GC overhead reduces the real RSS to ~14 GB, but this is still unsustainable.

### Why it happens

The pipeline operates in strict sequential phases:

```
Discover ALL files → Parse ALL files → Upload ALL metadata → Upload ALL content
```

- `allResults[]` (line 165) holds every `ParseResult` simultaneously
- `toSessionSnapshot()` is called TWICE per session — once in metadata phase (line 338), once in content phase (line 368) — each time creating new JSON strings and hash objects
- `raw` field survives from parse through both upload phases

## Proposed solution: Stream-based batching

Convert to **parse-batch-upload-release** per batch:

```
for each file:
  parse → feed into currentBatch (capacity = METADATA_BATCH_SIZE = 50)
  when batch full:
    metadata upload → content upload → release batch → GC-eligible
after all files:
  flush remaining partial batch
```

### Peak memory comparison

| Scenario | Current | After streaming |
|----------|---------|-----------------|
| Peak sessions in memory | ~5,800 | ~50 (1 batch) |
| Peak RSS estimate | ~14 GB | ~1-2 GB |
| `toSessionSnapshot()` calls per session | 2 | 1 (reuse `precomputed`) |

### Key design decisions

1. **Batch = `METADATA_BATCH_SIZE`** (50 sessions) — reuse existing constant, no new config
2. **Single `toSessionSnapshot()` call** per session — compute hashes once during metadata phase, pass `precomputed` to content phase
3. **`raw` cleared after content upload** per batch — not during parse (that was the previous failed attempt which broke `toSessionSnapshot()`)
4. **Cursor rollback preserved** — `prevCursors` map only needs to cover the current batch's sessions, not all sessions

## Implementation plan

### Step 1: Refactor `sync-pipeline.ts`

Replace the three-phase pipeline (parse-all → metadata-all → content-all) with streaming batches:

```typescript
// Pseudocode — actual implementation will follow existing code style
const currentBatch: ParseResult[] = [];
const batchSessionToFile = new Map<string, string>();
const batchPrevCursors = new Map<string, FileCursor | undefined>();

function flushBatch() {
  if (currentBatch.length === 0) return;

  const uploadable = currentBatch.filter(r => r.canonical.messages.length > 0);
  if (uploadable.length === 0) { currentBatch.length = 0; return; }

  // Phase 1: metadata upload (toSessionSnapshot computes hashes)
  const transformed = uploadable.map(r => toSessionSnapshot(r.canonical, r.raw));
  uploadMetadataBatches(transformed.map(t => t.snapshot), uploadOpts);

  // Phase 2: content upload (reuse precomputed hashes)
  uploadContentBatch(uploadable.map((r, i) => ({
    canonical: r.canonical,
    raw: r.raw,
    precomputed: transformed[i].precomputed,
  })), contentOpts);

  // Release memory for this batch
  for (const r of currentBatch) { r.raw = undefined; }
  currentBatch.length = 0;
  batchSessionToFile.clear();
  batchPrevCursors.clear();
}

for (const driver of fileDrivers) {
  for (const filePath of files) {
    const results = await driver.parse(filePath, resume);

    // ... cursor building (same as current) ...

    currentBatch.push(...results);
    if (currentBatch.length >= METADATA_BATCH_SIZE) {
      flushBatch();
    }
  }
}
flushBatch(); // remaining partial batch
```

### Step 2: Update `SyncProgressLogger` interface

The current logger has separate stage-level callbacks (`uploadMetadataStart/Done`, `uploadContentStart/Done`). These fire per-batch now instead of once globally. Two options:

- **Option A**: Keep existing logger interface, aggregate counts internally, fire callbacks once at end
- **Option B**: Add `batchStart/batchDone` callbacks, fire existing callbacks per batch

**Recommendation**: Option A — keeps the logger interface unchanged, simpler for callers.

### Step 3: Update tests

- All existing test cases should pass unchanged (same functional behavior)
- Add test for partial batch (< METADATA_BATCH_SIZE items)
- Add test verifying memory release (`raw === undefined` after flush)
- Add test for cursor rollback within streaming context

### Step 4: Verify with real data

Run `pika sync` on the same large corpus and compare RSS:
- Before: ~14 GB
- Expected after: ~1-2 GB

## Files to modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sync-pipeline.ts` | Major refactor — streaming batch loop |
| `packages/cli/src/commands/sync-pipeline.test.ts` | Update tests for streaming behavior |

## Files NOT modified

| File | Reason |
|------|--------|
| `packages/cli/src/upload/engine.ts` | No changes — `toSessionSnapshot()`, `splitBatches()`, `uploadMetadataBatches()` stay the same |
| `packages/cli/src/upload/content.ts` | No changes — `uploadContentBatch()` stays the same |
| `packages/cli/src/drivers/` | No changes — driver interface unchanged |
| `packages/core/src/constants.ts` | No changes — reuse `METADATA_BATCH_SIZE` |

## Risk assessment

| Risk | Mitigation |
|------|------------|
| Upload failure mid-batch loses progress | Cursor rollback already handles this per-file; extend to per-batch |
| `toSessionSnapshot()` called with `raw=undefined` | Clear `raw` AFTER content upload, not during parse |
| Logger callback semantics change | Aggregate internally, fire once at end |
| Regression in upload correctness | Existing test suite covers upload logic; add streaming-specific tests |

## Out of scope

- Parallel file parsing (single-threaded parse is already fast enough)
- Changing batch size or making it configurable
- Modifying the upload engine or content upload modules
- Database schema changes
