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

### New Auth: API Key for CLI Direct Access

Add API key auth to Worker, allowing CLI to call Worker directly (bypassing Next.js for performance-critical paths).

```typescript
// Worker auth: accept either WORKER_SECRET or API key
function validateAuth(request: Request, env: Env): AuthResult {
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
  if (token.startsWith("pk_")) {
    const userId = await lookupApiKey(token, env.DB);
    if (!userId) return { valid: false };
    return { valid: true, userId, source: "api_key" };
  }
  
  return { valid: false };
}
```

### API Key Lookup

```sql
-- Existing table (from NextAuth adapter)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,  -- SHA-256 of pk_...
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- Worker lookup (by hash, not raw key)
SELECT user_id FROM api_keys WHERE key_hash = ?
```

**Security:**
- API keys stored as SHA-256 hash (never raw)
- Worker computes hash on each request
- Rate limit by API key: 100 req/s per key

## New Worker Routes

### Read Routes (migrate from D1 direct)

| Route | Method | Purpose | Current Location |
|-------|--------|---------|------------------|
| `/sessions` | GET | List sessions with filters | `lib/sessions.ts` |
| `/sessions/:id` | GET | Get session detail | `lib/session-detail.ts` |
| `/sessions/:id/content` | GET | Get session content | Already in worker |
| `/projects` | GET | List projects | `lib/projects.ts` |
| `/projects/activity` | GET | Activity heatmap | `lib/stats.ts` |
| `/search` | GET | FTS search | `lib/search.ts` |
| `/tags` | GET | List tags | `lib/tags.ts` |
| `/stats` | GET | Dashboard stats | `lib/stats.ts` |
| `/filters` | GET | Available filter values | `lib/sessions.ts` |

### Write Routes (already in worker, add new)

| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/ingest/sessions` | POST | Batch upsert metadata | Exists |
| `/ingest/content/:key/:type` | PUT | Upload content | Exists |
| `/sessions/:id/star` | PATCH | Toggle star | New |
| `/sessions/:id/tags` | PATCH | Update tags | New |
| `/sessions/:id/trash` | DELETE | Soft delete | New |
| `/sessions/batch` | PATCH | Batch operations | New |
| `/tags` | POST | Create tag | New |
| `/tags/:id` | PATCH/DELETE | Update/delete tag | New |

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

### Phase 3: API Key Auth

- Add API key validation to worker
- Add rate limiting per API key
- Update CLI to optionally call worker directly

### Phase 4: Next.js Migration

- Create `lib/worker-client.ts` — HTTP client for worker
- Replace `getD1Client()` calls with worker client
- Remove `lib/d1.ts` and D1 HTTP API env vars

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

- Remove `CF_D1_*` env vars from Next.js
- Delete `lib/d1.ts`, `lib/d1-cli-auth-db.ts`
- Update docs and CLAUDE.md

## Worker Route Structure

```typescript
// packages/worker/src/index.ts — updated router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Public routes (no auth)
    if (url.pathname === "/live") return handleLive(env);
    
    // Auth check
    const auth = validateAuth(request, env);
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
        case url.pathname === "/projects":
          return handleListProjects(auth.userId, url.searchParams, env);
        case url.pathname === "/search":
          return handleSearch(auth.userId, url.searchParams, env);
        case url.pathname === "/stats":
          return handleStats(auth.userId, env);
        case url.pathname === "/filters":
          return handleFilters(auth.userId, env);
        case url.pathname === "/tags":
          return handleListTags(auth.userId, env);
        case url.pathname.startsWith("/content/"):
          return handleContentRead(extractKey(url.pathname), auth.userId, env);
      }
    }
    
    // Write routes
    if (request.method === "POST") {
      if (url.pathname === "/ingest/sessions") {
        return handleSessionIngest(await request.json(), env);
      }
      if (url.pathname === "/tags") {
        return handleCreateTag(auth.userId, await request.json(), env);
      }
    }
    
    if (request.method === "PUT") {
      const contentPath = parseContentPath(url.pathname);
      if (contentPath) {
        return contentPath.type === "canonical"
          ? handleCanonicalUpload(contentPath.sessionKey, auth.userId, request, env)
          : handleRawUpload(contentPath.sessionKey, auth.userId, request, env);
      }
    }
    
    if (request.method === "PATCH") {
      if (url.pathname.match(/^\/sessions\/[^/]+\/star$/)) {
        return handleToggleStar(auth.userId, extractId(url.pathname), env);
      }
      if (url.pathname.match(/^\/sessions\/[^/]+\/tags$/)) {
        return handleUpdateTags(auth.userId, extractId(url.pathname), await request.json(), env);
      }
      if (url.pathname === "/sessions/batch") {
        return handleBatchOperation(auth.userId, await request.json(), env);
      }
    }
    
    if (request.method === "DELETE") {
      if (url.pathname.match(/^\/sessions\/[^/]+\/trash$/)) {
        return handleTrashSession(auth.userId, extractId(url.pathname), env);
      }
    }
    
    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
```

## Caching Strategy

Worker-side caching using Cloudflare Cache API:

```typescript
async function withCache<T>(
  request: Request,
  ttlSeconds: number,
  handler: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  
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

// Usage
return withCache(request, 60, () => handleListSessions(userId, params, env));
```

**Cache TTLs:**
| Route | TTL | Rationale |
|-------|-----|-----------|
| `/sessions` | 30s | List changes on sync |
| `/sessions/:id` | 5min | Detail rarely changes |
| `/projects` | 5min | Derived from sessions |
| `/stats` | 5min | Aggregate, slow to change |
| `/search` | 0 | Must be fresh |
| `/filters` | 5min | Derived values |

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
- [ ] `packages/worker/src/routes/sessions.ts`
- [ ] `packages/worker/src/routes/projects.ts`
- [ ] `packages/worker/src/routes/search.ts`
- [ ] `packages/worker/src/routes/stats.ts`
- [ ] `packages/worker/src/routes/tags.ts`
- [ ] `packages/worker/src/auth.ts`
- [ ] `packages/worker/src/cache.ts`
- [ ] `packages/web/src/lib/worker-client.ts`

### Files to Delete
- [ ] `packages/web/src/lib/d1.ts`
- [ ] `packages/web/src/lib/d1.test.ts`
- [ ] `packages/web/src/lib/d1-cli-auth-db.ts`
- [ ] `packages/web/src/lib/d1-cli-auth-db.test.ts`

### Env Vars to Remove (Next.js)
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
