# 07 - E2E Test Plan (Manual, Per-Source)

## Objective

Validate the full upload pipeline end-to-end: CLI parse → upload → D1 metadata → R2 content → dashboard display.
Each source is tested independently, from fewest sessions to most, with D1 cleared between rounds.

## Local Session Inventory

| # | Source | Driver Kind | Session Count | Files/DB | Order |
|---|--------|-------------|---------------|----------|-------|
| 1 | VSCode Copilot | FileDriver | ~5 | 5 JSONL files | **1st** |
| 2 | Gemini CLI | FileDriver | ~74 | 74 JSON files | **2nd** |
| 3 | Codex CLI | FileDriver | ~113 | 113 JSONL files | **3rd** |
| 4 | Claude Code | FileDriver | ~903 | 903 JSONL files | **4th** |
| 5 | OpenCode JSON | FileDriver | ~3249 | 3249 JSON files | **5th** |
| 6 | OpenCode SQLite | DbDriver | ~4268 | 2.6 GB SQLite DB | **6th** |

> OpenCode JSON runs before SQLite. Cross-source dedup means SQLite should only upload sessions NOT already covered by JSON. Test both independently first, then combined.

## Prerequisites

### P1: Deploy latest Worker

The current production worker returns 401 on `GET /live` (should be public per code).
This confirms the deployed version is stale — all 14 bug fixes are NOT live.

```bash
# From packages/worker/
wrangler deploy
# Verify:
curl https://pika-ingest.worker.hexly.ai/live
# Expected: { "ok": true, "latencyMs": ..., "version": "0.1.0" }
```

### P2: Deploy latest Web (Railway)

The web app at `pika.nocoo.dev` is not resolving. Ensure Railway deployment is live.

```bash
# Verify:
curl https://pika.nocoo.dev/api/live
# Expected: 200 OK
```

### P3: Clear D1 Database

Wipe all user data from D1 to start clean. Preserve schema + users table.

```bash
# From packages/worker/
wrangler d1 execute pika-db --remote --command "DELETE FROM session_tags"
wrangler d1 execute pika-db --remote --command "DELETE FROM message_chunks"
wrangler d1 execute pika-db --remote --command "DELETE FROM messages"
wrangler d1 execute pika-db --remote --command "DELETE FROM sessions"
# Verify empty:
wrangler d1 execute pika-db --remote --command "SELECT COUNT(*) as c FROM sessions"
# Expected: c = 0
```

> Do NOT delete `users` or `accounts` — those hold OAuth state.

### P4: Clear Local Cursors

```bash
rm -f ~/.config/pika/cursors.json
```

### P5: CLI Login

```bash
bunx pika login
# Or for dev:
bunx pika login --dev
```

Verify: `~/.config/pika/config.json` contains `{ "token": "pk_...", "deviceId": "..." }`

---

## Test Protocol (Per Source)

Each source follows the same 6-step protocol:

### Step 1: Pre-Sync Baseline

```bash
# Confirm D1 is empty (or only has previous source's data)
wrangler d1 execute pika-db --remote --command \
  "SELECT source, COUNT(*) as c FROM sessions GROUP BY source"
```

### Step 2: Run Sync (Upload)

```bash
# Sync only (all sources will be parsed, but we test one at a time)
bunx pika sync
```

> Note: `pika sync` processes ALL available sources in one run. To test one source at a time,
> we clear cursors + D1 between rounds and only have that source's files available.
> **Alternative**: run sync once per round; since cursors are cleared, it will re-upload everything.
> After each round, verify only the expected source's sessions appear.

### Step 3: Verify D1 Metadata

```bash
# Total session count by source
wrangler d1 execute pika-db --remote --command \
  "SELECT source, COUNT(*) as sessions, 
          SUM(total_messages) as messages,
          SUM(user_messages) as user_msgs,
          SUM(assistant_messages) as assistant_msgs
   FROM sessions GROUP BY source"

# Verify key fields are populated (no NULLs where unexpected)
wrangler d1 execute pika-db --remote --command \
  "SELECT COUNT(*) as missing_content FROM sessions 
   WHERE content_key IS NULL AND source = '<SOURCE>'"

wrangler d1 execute pika-db --remote --command \
  "SELECT COUNT(*) as missing_raw FROM sessions 
   WHERE raw_key IS NULL AND source = '<SOURCE>'"

# Verify messages exist for at least some sessions
wrangler d1 execute pika-db --remote --command \
  "SELECT COUNT(DISTINCT session_id) as sessions_with_messages FROM messages"

# Verify FTS chunks exist
wrangler d1 execute pika-db --remote --command \
  "SELECT COUNT(*) as chunk_count FROM message_chunks"
```

**Expected**: 
- Session count matches local file count (±variance for multi-session files or dedup)
- `content_key` and `raw_key` are NOT NULL for all sessions
- Messages and chunks exist for all sessions

### Step 4: Verify R2 Content

```bash
# Spot-check: pick a session_key from D1, verify R2 objects exist
wrangler d1 execute pika-db --remote --command \
  "SELECT session_key, content_key, raw_key, content_hash, raw_hash 
   FROM sessions WHERE source = '<SOURCE>' LIMIT 3"

# For each content_key/raw_key, verify in R2:
# (Use wrangler r2 or the dashboard API to check object existence)
```

### Step 5: Dashboard Verification (Manual)

Open `https://pika.nocoo.dev` in browser and verify:

| Check | What to Look For |
|-------|------------------|
| **Session List** | Sessions appear, correct source icon, correct timestamp |
| **Session Count** | Total matches D1 query |
| **Source Filter** | Filtering by source shows only that source's sessions |
| **Session Detail** | Click a session → full conversation replays correctly |
| **Message Roles** | User/assistant messages display with correct roles |
| **Tool Calls** | Tool use messages show tool name and input |
| **Token Counts** | Non-zero token counts where applicable |
| **Search** | Search for a known term → returns relevant sessions with highlights |
| **Project Grouping** | Sessions grouped by project (if applicable to source) |

### Step 6: Local-to-Cloud Comparison

```bash
# Compare local parse output vs D1 metadata for a sample session
# Pick a session, parse it locally, compare fields:
wrangler d1 execute pika-db --remote --command \
  "SELECT session_key, total_messages, user_messages, assistant_messages,
          total_input_tokens, total_output_tokens, model, project_ref, title
   FROM sessions WHERE session_key = '<KEY>'"
```

Cross-reference with local parse output (run parser manually or inspect cursor state).

---

## Per-Source Test Rounds

### Round 1: VSCode Copilot (~5 sessions)

**Why first**: Smallest dataset, fast feedback loop.

**Source specifics**:
- CRDT JSONL files in `~/Library/Application Support/Code/User/`
- Workspace sessions + global sessions
- `processedRequestIds` dedup in cursor

**Verification focus**:
- [ ] P1: Worker deployed, `GET /live` returns 200
- [ ] P2: Web app accessible
- [ ] P3: D1 cleared
- [ ] P4: Cursors cleared
- [ ] P5: CLI logged in
- [ ] Sync completes without errors
- [ ] D1: ~5 sessions with source=`vscode-copilot`
- [ ] D1: All have `content_key` and `raw_key` NOT NULL
- [ ] D1: Messages and chunks populated
- [ ] Dashboard: Sessions visible, detail view works
- [ ] Dashboard: Search returns results
- [ ] Incremental re-sync: run `pika sync` again → 0 new uploads (cursor skip)

### Round 2: Gemini CLI (~74 sessions)

**Pre-round**: Clear D1 + cursors (keep Round 1 data OR start fresh — decide at runtime).

**Source specifics**:
- JSON files in `~/.gemini/tmp/{hash}/chats/session-*.json`
- Array-index incremental parsing
- `sourceMessageCount` cursor (Bug #3 fix)

**Verification focus**:
- [ ] D1 cleared (or incremental from Round 1)
- [ ] Cursors cleared
- [ ] Sync completes without errors
- [ ] D1: ~74 sessions with source=`gemini-cli`
- [ ] D1: Token counts populated (Gemini reports tokens)
- [ ] D1: Model field populated
- [ ] Dashboard: Gemini sessions display correctly
- [ ] Dashboard: Session detail shows tool calls (if any)
- [ ] Incremental re-sync: 0 new uploads

### Round 3: Codex CLI (~113 sessions)

**Source specifics**:
- JSONL files in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Byte-offset incremental parsing
- One session per file

**Verification focus**:
- [ ] D1: ~113 sessions with source=`codex`
- [ ] D1: Token counts via diff computation
- [ ] Dashboard: Codex sessions render correctly
- [ ] Incremental re-sync: 0 new uploads

### Round 4: Claude Code (~903 sessions)

**Source specifics**:
- JSONL files in `~/.claude/projects/**/*.jsonl`
- Multi-session per file (conversation turns split by session boundaries)
- Full canonical snapshot (Bug #2 fix)
- Byte-offset incremental

**Verification focus**:
- [ ] D1: Session count ≥903 (multi-session files may produce more)
- [ ] D1: All `content_key` / `raw_key` populated
- [ ] D1: Project refs populated (Claude has strong project context)
- [ ] Dashboard: Project grouping works
- [ ] Dashboard: Large sessions replay fully
- [ ] Dashboard: Search across Claude sessions works
- [ ] Incremental re-sync: 0 new uploads

### Round 5: OpenCode JSON (~3249 sessions)

**Source specifics**:
- JSON files in `~/.local/share/opencode/storage/session/{projectId}/ses_*.json`
- Message dirs provide change detection
- Raw source files preserved (Bug #5 fix)
- Deposits state into `SyncContext.openCodeSessionState` for SQLite dedup

**Verification focus**:
- [ ] D1: ~3249 sessions with source=`opencode`
- [ ] D1: Raw archives contain original source files
- [ ] Dashboard: OpenCode sessions display correctly
- [ ] Dashboard: Session detail shows full conversation
- [ ] Incremental re-sync: 0 new uploads
- [ ] **Save SyncContext state** (for Round 6 comparison)

### Round 6: OpenCode SQLite (~4268 sessions, deduplicated)

**Source specifics**:
- 2.6 GB SQLite DB at `~/.local/share/opencode/opencode.db`
- Watermark cursor with `lastMessageIds` boundary dedup
- Cross-source dedup: skips sessions already uploaded by JSON driver
- Full canonical output (queries ALL messages, not just delta)
- Raw fidelity: virtual paths for each DB row

**Two sub-tests**:

#### 6a: SQLite After JSON (Normal Flow — Cross-Source Dedup)

Run after Round 5 (JSON already uploaded). SQLite should only upload sessions NOT in JSON.

- [ ] Expected: `4268 - 3249 = ~1019` new sessions (approximate — dedup logic compares message counts)
- [ ] D1: Total opencode sessions ≈ 4268 (JSON + SQLite unique)
- [ ] Dashboard: All OpenCode sessions visible, no duplicates

#### 6b: SQLite Standalone (No JSON)

Clear D1 + cursors. Disable JSON source (rename `storage/session/` temporarily). Run sync.

- [ ] D1: ~4268 sessions from SQLite alone
- [ ] D1: All have `content_key` / `raw_key`
- [ ] Dashboard: All sessions render, raw download works
- [ ] Restore JSON source path after test

---

## Cumulative Final Verification

After all 6 rounds (or a single "all sources" sync):

```bash
# Total counts
wrangler d1 execute pika-db --remote --command \
  "SELECT source, COUNT(*) as sessions,
          SUM(total_messages) as total_msgs,
          COUNT(CASE WHEN content_key IS NOT NULL THEN 1 END) as with_content,
          COUNT(CASE WHEN raw_key IS NOT NULL THEN 1 END) as with_raw
   FROM sessions GROUP BY source ORDER BY sessions"

# FTS health
wrangler d1 execute pika-db --remote --command \
  "SELECT COUNT(*) as total_chunks FROM message_chunks"

# Search test
# On dashboard: search for common terms, verify cross-source results
```

**Dashboard final checks**:
- [ ] Stats page: source distribution pie chart matches D1 counts
- [ ] Stats page: daily activity chart shows reasonable data
- [ ] Stats page: top projects listed
- [ ] Session list: pagination works across all sessions
- [ ] Session list: sort by date, tokens, duration all work
- [ ] Star/tag a session → persists on reload

---

## Rollback Plan

If any round fails:

1. **Capture error output**: `pika sync 2>&1 | tee sync-round-N.log`
2. **Check parse errors**: `cat ~/.config/pika/parse-errors.jsonl`
3. **Clear D1 + cursors**: Reset to pre-round state
4. **Fix the issue**: Update code, commit, redeploy worker/web
5. **Re-run the round**

---

## Success Criteria

All 6 rounds pass with:
- Zero sync errors
- D1 session counts match expected
- 100% `content_key` and `raw_key` coverage (no NULL)
- Dashboard renders all sessions correctly
- FTS search returns relevant results
- Incremental re-sync produces 0 new uploads
- Cross-source dedup works correctly (OpenCode JSON vs SQLite)
