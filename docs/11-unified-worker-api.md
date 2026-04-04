# 11 - Unified Worker API

## Overview

Consolidate all D1/R2 operations through the Cloudflare Worker, eliminating direct D1 HTTP API calls from Next.js. This unifies data access, simplifies auth, and prepares for future CLI direct-to-worker access.

## Current Architecture

```
CLI ──► Next.js API ──► Worker ──► D1/R2   (writes)
             │
             └──────────► D1 HTTP API      (reads)
```

**Problems:**
1. Two auth mechanisms: WORKER_SECRET (worker) + CF_D1_API_TOKEN (D1 direct)
2. Two code paths: `lib/ingest.ts` (proxy) vs `lib/d1.ts` (direct)
3. D1 HTTP API rate limits (100 req/s) vs Worker D1 bindings (no limit)
4. Cannot easily add caching/rate-limiting at the data layer

## Target Architecture

```
CLI ──► Next.js API ──► Worker ──► D1/R2   (all operations)
```

**Benefits:**
1. Single auth: WORKER_SECRET for all D1/R2 access
2. Single code path: all queries via Worker
3. Native D1 bindings: no HTTP API rate limits
4. Centralized caching, rate-limiting, observability

## API Key Authentication

### Current Auth Flow (Web-to-Worker)

```
Next.js API (validates JWT) ──► Worker (validates WORKER_SECRET + X-User-Id)
```

### Current CLI Auth (unchanged)

CLI uses `pk_` prefixed API key stored as SHA-256 hash in `users.api_key` column:

```sql
-- Existing schema (from docs/02-database.md)
CREATE TABLE users (
  ...
  api_key TEXT UNIQUE,  -- SHA-256 hash of "pk_" + 32 hex chars
  ...
);
```

The Worker will reuse this existing auth model — no schema migration required.

### New Auth: API Key for Worker Direct Access

Add API key auth to Worker, allowing CLI to call Worker directly (bypassing Next.js for performance-critical paths).

```typescript
// Worker auth: accept either WORKER_SECRET or API key
async function validateAuth(request: Request, env: Env): Promise<AuthResult> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { valid: false };
  }
  
  const token = auth.slice(7);
  
  // 1. WORKER_SECRET (internal Next.js → Worker)
  if (token === env.WORKER_SECRET) {
    const userId = request.headers.get("X-User-Id");
    if (!userId) return { valid: false };
    return { valid: true, userId, source: "internal" };
  }
  
  // 2. API key (pk_...) — CLI direct access
  // Hash the key and lookup in users.api_key (same as cli-auth.ts)
  if (token.startsWith("pk_")) {
    const hashedKey = await hashApiKey(token);
    const user = await env.DB.prepare(
      "SELECT id FROM users WHERE api_key = ?"
    ).bind(hashedKey).first<{ id: string }>();
    if (!user) return { valid: false };
    return { valid: true, userId: user.id, source: "api_key" };
  }
  
  return { valid: false };
}

// Reuse hashApiKey from packages/web/src/lib/cli-auth.ts
async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

**Security:**
- API keys stored as SHA-256 hash in `users.api_key` (existing schema)
- Worker computes hash on each request, same as `cli-auth.ts`
- Rate limit by API key: 100 req/s per key

## New Worker Routes

### Read Routes (migrate from D1 direct)

| Route | Method | Purpose | Current Next.js Location |
|-------|--------|---------|--------------------------|
| `/sessions` | GET | List sessions with filters | `api/sessions/route.ts` |
| `/sessions/:id` | GET | Get session detail | `api/sessions/[id]/route.ts` |
| `/sessions/:id/content` | GET | Get session content (proxy to R2) | `api/sessions/[id]/content/route.ts` → Worker `/content/:key` |
| `/projects` | GET | List projects | `api/projects/route.ts` |
| `/projects/activity` | GET | Activity heatmap | `api/projects/activity/route.ts` |
| `/search` | GET | FTS search | `api/search/route.ts` |
| `/tags` | GET | List tags | `api/tags/route.ts` |
| `/stats` | GET | Dashboard stats | `api/stats/route.ts` |
| `/sessions/filters` | GET | Available filter values | `api/sessions/filters/route.ts` |

**Note**: `/sessions/:id/content` currently does D1 lookup first, then proxies to Worker's `/content/:key`. After migration, Worker handles both steps internally.

### Write Routes

| Route | Method | Purpose | Status | Current Next.js |
|-------|--------|---------|--------|-----------------|
| `/ingest/sessions` | POST | Batch upsert metadata | Exists | — |
| `/ingest/content/:key/:type` | PUT | Upload content | Exists | — |
| `/sessions/:id/star` | PATCH | Set star status | New | `api/sessions/[id]/star/route.ts` PATCH |
| `/sessions/:id/tags` | GET | List session tags | New | `api/sessions/[id]/tags/route.ts` GET |
| `/sessions/:id/tags` | PUT | Add tag to session | New | `api/sessions/[id]/tags/route.ts` PUT |
| `/sessions/:id/tags` | DELETE | Remove tag from session | New | `api/sessions/[id]/tags/route.ts` DELETE |
| `/sessions/:id/trash` | PATCH | Soft delete/restore | New | `api/sessions/[id]/trash/route.ts` PATCH |
| `/sessions/batch` | POST | Batch operations | New | `api/sessions/batch/route.ts` POST |
| `/tags` | POST | Create tag | New | `api/tags/route.ts` POST |
| `/tags/:id` | PATCH | Update tag | New | `api/tags/[tagId]/route.ts` PATCH |
| `/tags/:id` | DELETE | Delete tag | New | `api/tags/[tagId]/route.ts` DELETE |
| `/auth/cli-key` | POST | Generate CLI API key | New | `api/auth/cli/route.ts` (key gen only) |
| `/ingest/presign` | POST | Presign R2 upload URL | New | `api/ingest/presign/route.ts` |
| `/ingest/confirm-raw` | POST | Confirm raw upload | New | `api/ingest/confirm-raw/route.ts` |

### Auth-related Routes (remain in Next.js)

These routes depend on NextAuth session cookies and cannot move to Worker:

| Route | Method | Purpose | Reason |
|-------|--------|---------|--------|
| `/api/auth/cli` | GET | CLI login redirect flow | Requires NextAuth session cookie + browser redirect |
| `/api/auth/[...nextauth]` | ALL | NextAuth handlers | Core auth, cannot move |

**Note**: `/api/auth/cli` handles the browser OAuth flow and redirect. After successful auth, it will call Worker `/auth/cli-key` to generate the API key. The key generation logic moves to Worker; the OAuth redirect stays in Next.js.

## Implementation Plan

### Phase 1: Worker Read APIs

- Add read route handlers to worker
- Implement query builders (reuse logic from `lib/*.ts`)
- Add response caching (Cache API)

```typescript
// Example: GET /sessions
async function handleListSessions(
  userId: string,
  params: URLSearchParams,
  env: Env
): Promise<Response> {
  const { sql, bindings } = buildSessionsQuery(userId, params);
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  
  return Response.json({
    sessions: result.results,
    total: result.results.length,
  });
}
```

### Phase 2: Worker Write APIs

- Add star/trash/tag mutation handlers
- Add batch operations handler
- Add tag CRUD handlers
- Add `/auth/cli-key` endpoint for API key generation:

```typescript
/**
 * POST /auth/cli-key — Generate a new CLI API key for authenticated user.
 * 
 * ⚠️ INTERNAL ONLY: Must be called with auth.source === "internal" (WORKER_SECRET).
 * Rejects API key callers to prevent existing key holders from minting new keys.
 * 
 * Called by Next.js /api/auth/cli after OAuth flow completes.
 * Generates fresh key, stores hash in users.api_key, returns plaintext key.
 */
async function handleCliKeyGeneration(
  userId: string,
  authSource: "internal" | "api_key",
  env: Env
): Promise<Response> {
  // Only allow internal calls (Next.js via WORKER_SECRET)
  if (authSource !== "internal") {
    return Response.json(
      { error: "Forbidden: this endpoint is internal only" },
      { status: 403 }
    );
  }

  // Generate pk_ + 32 hex chars
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const apiKey = `pk_${hex}`;
  
  // Hash for storage
  const hashedKey = await hashApiKey(apiKey);
  
  // Store in users.api_key (existing column)
  const result = await env.DB.prepare("UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(hashedKey, userId)
    .run();
  
  // Verify update succeeded (user exists)
  if (result.meta.changes === 0) {
    return Response.json(
      { error: `User ${userId} not found. OAuth sign-in may not have persisted the user row.` },
      { status: 404 }
    );
  }
  
  // Return plaintext key (shown once to user)
  return Response.json({ apiKey });
}
```

- Add `/ingest/presign` and `/ingest/confirm-raw` endpoints

### Phase 3: API Key Auth

- Add API key validation to worker
- Add rate limiting per API key
- Update CLI to optionally call worker directly

### Phase 4: Next.js Migration

- Create `lib/worker-client.ts` — HTTP client for worker
- Replace `getD1Client()` calls with worker client
- **Do NOT delete `lib/d1.ts` yet** — wait for Phase 5

```typescript
// lib/worker-client.ts
export class WorkerClient {
  constructor(
    private workerUrl: string,
    private workerSecret: string,
  ) {}

  async query<T>(path: string, userId: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.workerUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.workerSecret}`,
        "X-User-Id": userId,
      },
    });

    if (!response.ok) {
      throw new WorkerError(response.status, await response.text());
    }

    return response.json();
  }
}
```

### Phase 5: Cleanup

**Prerequisites**: All routes that use `getD1Client()` must be migrated first:
- `/api/auth/cli` → refactor to call Worker `/auth/cli-key` for key generation (OAuth flow stays in Next.js)
- `/api/live` → Next.js health check can call Worker `/live` (already exists)
- `/api/ingest/presign` → migrate to Worker `/ingest/presign`
- `/api/ingest/confirm-raw` → migrate to Worker `/ingest/confirm-raw`

Only after all D1 consumers are migrated:
- Remove `CF_D1_*` env vars from Next.js
- Delete `lib/d1.ts`, `lib/d1.test.ts`, `lib/d1-cli-auth-db.ts`, `lib/d1-cli-auth-db.test.ts`
- Update docs and CLAUDE.md

**⚠️ Warning**: Do NOT delete `d1.ts` while any Next.js route still imports `getD1Client()`. The files listed in "Files to Update" section all depend on it.

## Worker Route Structure

```typescript
// packages/worker/src/index.ts — updated router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Public routes (no auth)
    if (url.pathname === "/live") return handleLive(env);
    
    // Auth check
    const auth = await validateAuth(request, env);
    if (!auth.valid) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    // Read routes
    if (request.method === "GET") {
      switch (true) {
        case url.pathname === "/sessions":
          return handleListSessions(auth.userId, url.searchParams, env);
        case url.pathname.match(/^\/sessions\/[^/]+$/)?.length > 0:
          return handleGetSession(auth.userId, extractId(url.pathname), env);
        case url.pathname.match(/^\/sessions\/[^/]+\/content$/)?.length > 0:
          return handleGetSessionContent(auth.userId, extractId(url.pathname), env);
        case url.pathname.match(/^\/sessions\/[^/]+\/tags$/)?.length > 0:
          return handleGetSessionTags(auth.userId, extractId(url.pathname), env);
        case url.pathname === "/sessions/filters":
          return handleFilters(auth.userId, env);
        case url.pathname === "/projects":
          return handleListProjects(auth.userId, url.searchParams, env);
        case url.pathname === "/projects/activity":
          return handleProjectActivity(auth.userId, url.searchParams, env);
        case url.pathname === "/search":
          return handleSearch(auth.userId, url.searchParams, env);
        case url.pathname === "/stats":
          return handleStats(auth.userId, env);
        case url.pathname === "/tags":
          return handleListTags(auth.userId, env);
        case url.pathname.startsWith("/content/"):
          return handleContentRead(extractKey(url.pathname), auth.userId, env);
      }
    }
    
    // Write routes
    if (request.method === "POST") {
      if (url.pathname === "/ingest/sessions") {
        // SECURITY: Always override body.userId with authenticated user
        // to prevent impersonation via forged payload
        const payload = await request.json();
        payload.userId = auth.userId;
        return handleSessionIngest(payload, env);
      }
      if (url.pathname === "/tags") {
        return handleCreateTag(auth.userId, await request.json(), env);
      }
      if (url.pathname === "/sessions/batch") {
        return handleBatchOperation(auth.userId, await request.json(), env);
      }
      if (url.pathname === "/auth/cli-key") {
        // INTERNAL ONLY: Generate API key, reject api_key callers
        return handleCliKeyGeneration(auth.userId, auth.source, env);
      }
    }
    
    if (request.method === "PUT") {
      const contentPath = parseContentPath(url.pathname);
      if (contentPath) {
        return contentPath.type === "canonical"
          ? handleCanonicalUpload(contentPath.sessionKey, auth.userId, request, env)
          : handleRawUpload(contentPath.sessionKey, auth.userId, request, env);
      }
      // PUT /sessions/:id/tags — add tag
      if (url.pathname.match(/^\/sessions\/[^/]+\/tags$/)) {
        return handleAddSessionTag(auth.userId, extractId(url.pathname), await request.json(), env);
      }
    }
    
    if (request.method === "PATCH") {
      if (url.pathname.match(/^\/sessions\/[^/]+\/star$/)) {
        // Body: { starred: boolean } — set star status (not toggle)
        return handleSetStar(auth.userId, extractId(url.pathname), await request.json(), env);
      }
      if (url.pathname.match(/^\/sessions\/[^/]+\/trash$/)) {
        return handleTrashSession(auth.userId, extractId(url.pathname), await request.json(), env);
      }
      if (url.pathname.match(/^\/tags\/[^/]+$/)) {
        return handleUpdateTag(auth.userId, extractTagId(url.pathname), await request.json(), env);
      }
    }
    
    if (request.method === "DELETE") {
      // DELETE /sessions/:id/tags — remove tag
      if (url.pathname.match(/^\/sessions\/[^/]+\/tags$/)) {
        return handleRemoveSessionTag(auth.userId, extractId(url.pathname), await request.json(), env);
      }
      if (url.pathname.match(/^\/tags\/[^/]+$/)) {
        return handleDeleteTag(auth.userId, extractTagId(url.pathname), env);
      }
    }
    
    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
```

## Caching Strategy

Worker-side caching using Cloudflare Cache API with **user-scoped keys**:

```typescript
/**
 * Cache key MUST include userId to prevent cross-user data leakage.
 * User-specific data (sessions, projects, stats) is private.
 */
function buildCacheKey(request: Request, userId: string): Request {
  const url = new URL(request.url);
  // Append userId to cache key to isolate per-user
  url.searchParams.set("_uid", userId);
  return new Request(url.toString(), { method: "GET" });
}

async function withCache(
  request: Request,
  userId: string,
  ttlSeconds: number,
  handler: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = buildCacheKey(request, userId);
  
  // Check cache
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  
  // Generate response
  const response = await handler();
  
  // Cache successful responses
  if (response.ok) {
    const cloned = response.clone();
    cloned.headers.set("Cache-Control", `private, max-age=${ttlSeconds}`);
    await cache.put(cacheKey, cloned);
  }
  
  return response;
}

// Usage — userId is REQUIRED for user-scoped routes
return withCache(request, auth.userId, 60, () => handleListSessions(auth.userId, params, env));
```

**⚠️ Critical**: Cache key MUST include `userId`. Without it, two users hitting the same URL would share cached results — a data isolation breach.

**Cache TTLs:**
| Route | TTL | Rationale |
|-------|-----|-----------|
| `/sessions` | 30s | List changes on sync |
| `/sessions/:id` | 5min | Detail rarely changes |
| `/projects` | 5min | Derived from sessions |
| `/stats` | 5min | Aggregate, slow to change |
| `/search` | 0 | Must be fresh |
| `/sessions/filters` | 5min | Derived values |

## Rate Limiting

Per-API-key rate limiting using Cloudflare Durable Objects (optional) or simple in-memory:

```typescript
// Simple in-memory rate limiter (resets on worker restart)
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(apiKey: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(apiKey);
  
  if (!entry || entry.resetAt < now) {
    rateLimits.set(apiKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (entry.count >= limit) {
    return false;
  }
  
  entry.count++;
  return true;
}

// In auth handler
if (auth.source === "api_key") {
  if (!checkRateLimit(token, 100, 1000)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
}
```

## Migration Checklist

### Files to Create
- [x] `packages/worker/src/routes/sessions.ts`
- [x] `packages/worker/src/routes/projects.ts`
- [x] `packages/worker/src/routes/search.ts`
- [x] `packages/worker/src/routes/stats.ts`
- [x] `packages/worker/src/routes/tags.ts`
- [x] `packages/worker/src/auth.ts` — reuse `hashApiKey` from `cli-auth.ts`
- [ ] `packages/worker/src/cache.ts`
- [x] `packages/web/src/lib/worker-client.ts`

### Files to Update (migrate to Worker before Phase 5)
- [ ] `packages/web/src/app/api/auth/cli/route.ts` — refactor to call Worker `/auth/cli-key` for key gen
- [ ] `packages/web/src/app/api/live/route.ts` — call Worker `/live` instead of D1 direct
- [ ] `packages/web/src/app/api/ingest/presign/route.ts` — migrate to Worker `/ingest/presign`
- [ ] `packages/web/src/app/api/ingest/confirm-raw/route.ts` — migrate to Worker `/ingest/confirm-raw`

### Files to Delete (only after ALL D1 consumers migrated)
- [ ] `packages/web/src/lib/d1.ts`
- [ ] `packages/web/src/lib/d1.test.ts`
- [ ] `packages/web/src/lib/d1-cli-auth-db.ts`
- [ ] `packages/web/src/lib/d1-cli-auth-db.test.ts`

**⚠️ Deletion order**: These files can ONLY be deleted after all routes in "Files to Update" are migrated. Premature deletion breaks `/api/auth/cli`, `/api/live`, `/api/ingest/presign`, `/api/ingest/confirm-raw`.

### Env Vars to Remove (Next.js, after migration complete)
- [ ] `CF_ACCOUNT_ID`
- [ ] `CF_D1_DATABASE_ID`
- [ ] `CF_D1_API_TOKEN`

### Env Vars to Keep
- [ ] `WORKER_URL`
- [ ] `WORKER_SECRET`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Worker cold start latency | +50-100ms on first request | Cache API, keep-alive |
| Worker CPU time limit (50ms) | Complex queries timeout | Pagination, query optimization |
| Single point of failure | All data access blocked | Multi-region worker, fallback to D1 HTTP |
| Migration bugs | Data inconsistency | Feature flags, gradual rollout |

## Success Metrics

1. **Latency**: p50 < 100ms, p99 < 500ms (vs current D1 HTTP ~200ms p50)
2. **Error rate**: < 0.1% (vs current ~0.5% D1 HTTP throttling)
3. **Code reduction**: Remove ~500 LOC from Next.js
4. **Auth simplification**: 1 secret instead of 4 env vars
