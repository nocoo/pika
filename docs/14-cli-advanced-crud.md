# 14. CLI Advanced CRUD & Filtering

> Enhance Pika CLI with batch trash, advanced filtering, and session editing capabilities.

## Overview

Building on [doc 13](./13-pika-cli-crud.md), this document extends CLI capabilities with:

1. **Batch Trash** — Trash/restore multiple sessions at once via CLI
2. **Advanced Filtering** — Filter by message counts, token usage, and duration
3. **Session Editing** — Update title and description
4. **Tags Enhancement** — Case-insensitive matching with auto-create

---

## 1. Batch Trash

### Current State

- ✅ API endpoint exists: `POST /api/sessions/batch` (proxies to Worker)
- ✅ Batch actions supported: `delete`, `restore`, `star`, `unstar` (see `packages/web/src/lib/sessions.ts`)
- ✅ Single-session CLI: `pika sessions trash <id>` and `pika sessions trash <id> --restore`
- ❌ CLI only accepts **one** positional ID (see `packages/cli/src/commands/sessions/trash.ts:69`)

### Proposed Enhancement

Update CLI to accept multiple session IDs and call the existing batch endpoint.

**CLI Shape Change**:

```bash
# Current (single ID only)
pika sessions trash <id>

# New (variadic IDs)
pika sessions trash <id...>

# Examples
pika sessions trash sess_1 sess_2 sess_3
pika sessions trash sess_1 sess_2 sess_3 --restore
```

**Existing API** (no change needed):

```typescript
// POST /api/sessions/batch (proxies to Worker /sessions/batch)
// Request body
{
  action: "delete" | "restore" | "star" | "unstar";
  ids: string[];
}

// Response
{
  affected: number;
}
```

---

## 2. Advanced Filtering

### Current State

`pika sessions list` supports:

| Filter | Status | Example |
|--------|--------|---------|
| `--source` | ✅ | `--source=claude-code` |
| `--project` | ✅ | `--project=pika` |
| `--starred` | ✅ | `--starred` |
| `--deleted` | ✅ | `--deleted` |
| `--from` / `--to` | ✅ | `--from=2026-04-01` |
| `--sort` | ✅ | `--sort=total_messages` |

### Gap Analysis

| Filter | API Support | CLI Support |
|--------|-------------|-------------|
| `minMessages` / `maxMessages` | ✅ | ❌ |
| `model` | ✅ | ❌ |
| `minDuration` / `maxDuration` | ❌ | ❌ |
| `minInputTokens` / `maxInputTokens` | ❌ | ❌ |
| `minOutputTokens` / `maxOutputTokens` | ❌ | ❌ |

### Proposed Enhancements

#### 2.1 CLI Filter Flags

```bash
pika sessions list [existing flags...]

# Message count filters
  --min-messages <n>     Minimum total messages
  --max-messages <n>     Maximum total messages

# Token usage filters
  --min-input-tokens <n>   Minimum input tokens
  --max-input-tokens <n>   Maximum input tokens
  --min-output-tokens <n>  Minimum output tokens
  --max-output-tokens <n>  Maximum output tokens
  --min-total-tokens <n>   Minimum total tokens (input + output)
  --max-total-tokens <n>   Maximum total tokens

# Duration filters (in seconds, or with suffix: 5m, 1h, 2d)
  --min-duration <dur>   Minimum session duration
  --max-duration <dur>   Maximum session duration

# Model filter
  --model <name>         Filter by model (e.g., claude-sonnet-4-20250514)
```

#### 2.2 API Changes Required

Add query parameters to `GET /sessions` in Worker (`packages/worker/src/routes/sessions.ts`):

```typescript
// New query params
{
  minMessages?: number;
  maxMessages?: number;
  minInputTokens?: number;
  maxInputTokens?: number;
  minOutputTokens?: number;
  maxOutputTokens?: number;
  minTotalTokens?: number;
  maxTotalTokens?: number;
  minDuration?: number;      // seconds
  maxDuration?: number;      // seconds
}
```

**SQL WHERE clauses** (add to `buildWhereClause` in `packages/worker/src/routes/sessions.ts`):

```sql
-- Message filters (existing columns)
AND total_messages >= :minMessages
AND total_messages <= :maxMessages

-- Token filters (existing columns)
AND total_input_tokens >= :minInputTokens
AND total_input_tokens <= :maxInputTokens
AND total_output_tokens >= :minOutputTokens
AND total_output_tokens <= :maxOutputTokens
AND (total_input_tokens + total_output_tokens) >= :minTotalTokens
AND (total_input_tokens + total_output_tokens) <= :maxTotalTokens

-- Duration filter (existing column)
AND duration_seconds >= :minDuration
AND duration_seconds <= :maxDuration
```

#### 2.3 Duration Parser

CLI accepts human-readable durations:

```typescript
// packages/cli/src/output/duration.ts

/**
 * Parse duration string to seconds.
 * Supports: 30 (seconds), 5m (minutes), 2h (hours), 1d (days)
 */
export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) throw new Error(`Invalid duration: ${input}`);

  const value = parseInt(match[1], 10);
  const unit = match[2] || "s";

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return value * multipliers[unit];
}
```

#### 2.4 Usage Examples

```bash
# Find long sessions (> 2 hours)
pika sessions list --min-duration=2h

# Find expensive sessions (> 100k tokens)
pika sessions list --min-total-tokens=100000 --sort=total_input_tokens

# Find quick debugging sessions (< 10 messages, < 5 minutes)
pika sessions list --max-messages=10 --max-duration=5m

# Find heavy Claude Code sessions
pika sessions list --source=claude-code --min-output-tokens=50000

# Find sessions using a specific model
pika sessions list --model=claude-sonnet-4-20250514
```

---

## 3. Session Editing

### Current State

- ✅ `sessions star` — Star/unstar sessions
- ✅ `sessions trash` — Soft-delete/restore sessions
- ❌ `sessions edit` — Update title/description
- ✅ `tags add/remove` — Tag management exists

### Clarification: `description` vs `summary`

The sessions table has an existing `summary` field (see `docs/02-database.md:77`):

```sql
summary TEXT,  -- AI-generated summary (future)
```

The new `description` field is **user-authored** — a manual annotation the user writes to describe what happened in a session. This is distinct from `summary`, which is reserved for future AI-generated content.

| Field | Source | Purpose |
|-------|--------|---------|
| `summary` | AI-generated (future) | Automatic session summary |
| `description` | User-authored | Manual notes/annotations |

### Proposed Enhancements

#### 3.1 Session Edit Command

```bash
pika sessions edit <id> [options]

Options:
  --title <string>        Set session title
  --description <string>  Set session description (user notes, supports markdown)
  --clear-title           Clear title (revert to auto-generated)
  --clear-description     Clear description
```

**API Change Required**: `PATCH /sessions/:id` in Worker

```typescript
// Request body
{
  title?: string | null;        // null = clear
  description?: string | null;  // null = clear
}

// Response
{
  id: string;
  title: string | null;
  description: string | null;
  updated_at: string;
}
```

**Database Change**: Add `description` column to sessions table.

```sql
-- scripts/migrations/005-session-description.sql
ALTER TABLE sessions ADD COLUMN description TEXT;
```

#### 3.2 Usage Examples

```bash
# Set a descriptive title
pika sessions edit sess_abc123 --title "OAuth token refresh implementation"

# Add a description
pika sessions edit sess_abc123 --description "Implemented refresh token rotation with 7-day expiry. See PR #42."

# Clear auto-generated title
pika sessions edit sess_abc123 --clear-title

# Update both
pika sessions edit sess_abc123 \
  --title "Login bug fix" \
  --description "Fixed race condition in token validation"
```

---

## 4. Tags Enhancement

### Current Design (correct)

- Tags are stored in a unified `tags` table (per user)
- Sessions reference tags via `session_tags` join table (tag_id only)
- No duplicate tag definitions — one tag can be used across many sessions

### Current Limitation

- CLI requires UUID: `pika tags add sess_1 tag_abc123`
- Tag lookup is case-sensitive
- `tags remove` also requires UUID

### Proposed Changes

1. **Case-insensitive matching**: Tag names match regardless of case
2. **Auto-create on add**: If tag doesn't exist, create it automatically
3. **Name-based lookup**: Accept tag name instead of UUID (for both add and remove)

```bash
# New (ergonomic) — all equivalent
pika tags add sess_1 bug
pika tags add sess_1 Bug
pika tags add sess_1 BUG

# If "bug" doesn't exist, auto-create it
# If "Bug" exists, use that (case-insensitive match)

# Remove also accepts name
pika tags remove sess_1 bug
```

### API Changes Required

**Both PUT and DELETE `/sessions/:id/tags`** need updates:

```typescript
// PUT /sessions/:id/tags — add tag
// DELETE /sessions/:id/tags — remove tag
// Request body (same for both)
{
  tagName?: string;   // Name — case-insensitive lookup
  tagId?: string;     // ID — direct reference (backward compatible)
}

// Logic for both endpoints:
// 1. If tagId provided → use directly
// 2. If tagName provided:
//    a. SELECT id FROM tags WHERE user_id = ? AND LOWER(name) = LOWER(tagName)
//    b. For PUT: if not found → INSERT new tag, use new id
//    c. For DELETE: if not found → return 404
// 3. Execute the add/remove operation
```

**Tag lookup query** (case-insensitive):

```sql
SELECT id, name FROM tags
WHERE user_id = ? AND LOWER(name) = LOWER(?)
```

### Database Consideration

The current schema has `UNIQUE(user_id, name)` which is case-sensitive in SQLite by default.

**Recommendation**: Use application-level enforcement:
- Store original case (preserve user's preference: "Bug" vs "bug")
- Compare with `LOWER()` to prevent duplicates
- On insert, check `LOWER(name)` doesn't already exist

---

## Implementation Plan

### 1. CLI Filter Exposure ✓

Expose existing API filters (`model`, `minMessages`, `maxMessages`) to CLI.

#### 1.1 Add model and message count flags to sessions list ✓

- File: `packages/cli/src/commands/sessions/list.ts`
- Add `--model`, `--min-messages`, `--max-messages` args
- Pass to API as query params

#### 1.2 Add tests for new filter flags ✓

- File: `packages/cli/src/commands/sessions/sessions.test.ts`
- Test that flags are passed correctly to API client

---

### 2. Advanced Filter API ✓

Add duration and token filters.

#### 2.1 Add duration parser utility ✓

- File: `packages/cli/src/output/duration.ts`
- Parse `5m`, `2h`, `1d` to seconds
- Add unit tests

#### 2.2 Add filter params to Worker sessions endpoint ✓

- File: `packages/worker/src/routes/sessions.ts`
- Update `WhereParams` interface to include new fields
- Update `buildWhereClause` function to add WHERE conditions for:
  - `minDuration`, `maxDuration`
  - `minInputTokens`, `maxInputTokens`
  - `minOutputTokens`, `maxOutputTokens`
  - `minTotalTokens`, `maxTotalTokens`
- Parse new query params in route handler and pass to `buildWhereClause`

Note: The Worker has its own `buildWhereClause` (line ~136) separate from `packages/web/src/lib/sessions.ts`. The CLI calls the Worker API, so only the Worker's query builder needs updating.

#### 2.3 Add CLI flags for duration and token filters ✓

- File: `packages/cli/src/commands/sessions/list.ts`
- Add `--min-duration`, `--max-duration`, `--min-input-tokens`, etc.
- Use duration parser for duration flags

#### 2.4 Add tests for advanced filters ✓

- API tests for new query params
- CLI tests for duration parsing and flag passing

---

### 3. Session Edit ✓

Allow editing session title and description.

#### 3.1 Add description column to sessions table ✓

- File: `scripts/migrations/005-session-description.sql`
- `ALTER TABLE sessions ADD COLUMN description TEXT`

#### 3.2 Add PATCH /sessions/:id endpoint ✓

- File: `packages/worker/src/routes/sessions.ts`
- Accept `{ title?, description? }` body
- `null` value clears the field
- File: `packages/web/src/app/api/sessions/[id]/route.ts` — add PATCH handler to existing route file (currently only has GET)

#### 3.3 Add sessions edit CLI command ✓

- File: `packages/cli/src/commands/sessions/edit.ts`
- Add `--title`, `--description`, `--clear-title`, `--clear-description` flags
- Wire to PATCH endpoint

#### 3.4 Add tests for session edit ✓

- Worker API tests for PATCH endpoint
- CLI tests for edit command

---

### 4. Tags Enhancement ✓

Case-insensitive tag matching with auto-create on add.

#### 4.1 Update tag operations to case-insensitive lookup ✓

- File: `packages/worker/src/routes/tags.ts`
- Use `LOWER(name) = LOWER(?)` for tag queries
- Preserve original case on insert
- Check for case-insensitive duplicates before insert

#### 4.2 Update PUT /sessions/:id/tags to accept tagName ✓

- File: `packages/worker/src/routes/tags.ts`
- Accept `{ tagName }` in addition to `{ tagId }`
- Auto-create tag if not found (case-insensitive match first)

#### 4.3 Update DELETE /sessions/:id/tags to accept tagName ✓

- File: `packages/worker/src/routes/tags.ts`
- Accept `{ tagName }` in addition to `{ tagId }`
- Case-insensitive lookup, return 404 if not found

#### 4.4 Update tags add CLI to use tag name ✓

- File: `packages/cli/src/commands/tags/add.ts`
- Rename positional arg from `tagId` to `tag` (accepts name or UUID)
- Pass as `tagName` if not UUID format, `tagId` if UUID

#### 4.5 Update tags remove CLI to use tag name ✓

- File: `packages/cli/src/commands/tags/remove.ts`
- Same logic: accept name or UUID

#### 4.6 Add tests for tag enhancements ✓

- API tests for case-insensitive lookup and auto-create
- API tests for DELETE with tagName
- CLI tests for name-based tag operations

---

### 5. Batch Trash CLI ✓

Wire CLI to existing batch endpoint.

#### 5.1 Update CLI trash command for variadic IDs ✓

- File: `packages/cli/src/commands/sessions/trash.ts`
- Change positional arg from single `id` to variadic `ids`
- Single ID: call existing `PATCH /sessions/:id/trash`
- Multiple IDs: call `POST /sessions/batch` with `action: "delete"` or `action: "restore"`
  - Note: CLI ApiClient base URL already includes `/api`, so call `client.post("/sessions/batch", ...)`

#### 5.2 Add tests for batch trash CLI ✓

- Test single ID still works (backward compatible)
- Test multiple IDs calls batch endpoint
- Test `--restore` flag with multiple IDs

---

## Open Questions (Resolved)

1. **Description length limit**: No explicit limit in SQLite TEXT column; application-level enforcement can be added later if needed.
2. **Batch operation limits**: Using existing D1 batch limits (50 per D1 batch). Chunking can be added to CLI if needed.
3. **Tag case preservation**: ✓ Implemented — stores original case, compares case-insensitively using `LOWER()`.

## Implementation Status

**All tasks complete!** 1564 tests passing.
