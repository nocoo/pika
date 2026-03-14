# 08 - OpenCode SQLite Driver Bug: Never Wired in Sync Command

## Problem

The OpenCode SQLite driver (`opencode-sqlite.ts`) is fully implemented and tested, but **never instantiated or invoked** during `pika sync`. This means all sessions stored in OpenCode's SQLite database (`~/.local/share/opencode/opencode.db`) are silently skipped.

### Impact

| Metric | Value |
|--------|-------|
| Missing sessions | **4,383** (100% of SQLite-stored sessions) |
| DB size | 2.9 GB |
| Total messages | 91,234 |
| Overlap with JSON driver | **0** (completely disjoint datasets) |

OpenCode migrated from JSON files to SQLite storage. The JSON driver handles 3,249 legacy sessions; the SQLite driver should handle 4,383 newer sessions. Zero overlap confirms these are entirely different session populations.

## Root Cause

The bug is in `packages/cli/src/commands/sync.ts`. The registry correctly detects the DB exists, but `sync.ts` never constructs the driver instance.

### Broken Chain

```
buildDriverSet()
  ├── fileDrivers: [...5 drivers]     ← ✅ constructed and used
  ├── dbDriversAvailable: true        ← ✅ detected
  └── dbDriver: ???                   ← ❌ never constructed

sync.ts L82-95:
  runSyncPipeline({
    fileDrivers: driverSet.fileDrivers,   ← ✅ passed
    discoverOpts: driverSet.discoverOpts, ← ✅ passed
    cursorState,
    syncCtx,
    // dbDriver: ???                      ← ❌ MISSING — field is optional, TS doesn't warn
  })

sync-pipeline.ts L179:
  if (dbDriver) { ... }                  ← always undefined, Stage 2b always skipped
```

### Why It Wasn't Caught

1. `SyncPipelineInput.dbDriver` is typed as `optional` — TypeScript doesn't flag the omission
2. The pipeline silently skips Stage 2b when `dbDriver` is undefined — no warning logged
3. `pika status` only shows cursor-tracked files, not DB driver state
4. The JSON driver covers legacy OpenCode sessions, masking the gap

## Fix

`sync.ts` must construct the SQLite driver when `driverSet.dbDriversAvailable === true`:

### Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sync.ts` | Import `createOpenCodeSqliteDriver`, construct instance, pass as `dbDriver` |
| `packages/cli/src/drivers/registry.ts` | Return DB path in `DriverSet` so `sync.ts` knows where to open |

### Implementation

```typescript
// sync.ts — after buildDriverSet()
import { Database } from "bun:sqlite";
import { createOpenCodeSqliteDriver } from "../drivers/session/opencode-sqlite";

let dbDriver;
if (driverSet.dbDriversAvailable && driverSet.paths?.openCodeDbPath) {
  const openDb = (path: string) => new Database(path, { readonly: true });
  dbDriver = createOpenCodeSqliteDriver(openDb, driverSet.paths.openCodeDbPath);
}

const result = await runSyncPipeline(
  {
    fileDrivers: driverSet.fileDrivers,
    discoverOpts: driverSet.discoverOpts,
    cursorState,
    syncCtx,
    dbDriver,  // ← now wired
  },
  { ... },
);
```

### Cross-Source Dedup

The OpenCode SQLite driver already handles dedup with the JSON driver via `SyncContext.openCodeSessionState` (see `opencode-sqlite.ts`). The JSON driver runs first (Stage 1+2) and deposits state into `syncCtx`; the SQLite driver reads it in Stage 2b. With zero overlap between JSON and SQLite session IDs, dedup is a no-op but the safety mechanism is in place.

## Verification

After fix, run `pika sync --dev` and confirm:
1. `Parsed N session(s)` includes ~4,383 additional sessions from SQLite
2. Server session count for `opencode` source increases from 3,249 to ~7,632
3. Cursor state includes `openCodeSqlite` entry
4. No duplicate sessions on server (dedup works)

## Atomic Commits

1. `fix: wire opencode sqlite driver in sync command` — construct and pass dbDriver
2. `test: verify opencode sqlite sessions uploaded` — if needed

## Prevention

Consider making `SyncPipelineInput.dbDriver` required (not optional) and explicitly passing `undefined` when no DB driver exists. This forces callers to consciously decide rather than silently omitting.
