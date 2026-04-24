# 16 — API Layer Extraction (packages/api)

## 目标

从 `packages/web` 抽出独立 HTTP API 服务 `packages/api`，把 web 打薄为**纯前端 + auth**，为未来迁移到 Vite（SPA / vinext）做准备。

**核心原则**：
- web 仅保留 UI、NextAuth、SSR 必需的 server code
- api 是独立可运行 HTTP 服务（Hono），承载所有业务数据访问
- web 通过同源反代调用 api，与未来 vite 前端完全一致

## 现状分析

### 完整路由清单（21 个 route handler）

逐个枚举现有 `packages/web/src/app/api/**/route.ts`，避免漏数：

**Auth（留在 web，绑 NextAuth）**
- `auth/[...nextauth]/route.ts` — NextAuth 核心
- `auth/cli/route.ts` — CLI 换 token，读 session cookie

**业务（搬到 api）**
- `sessions/route.ts` — 列表
- `sessions/[id]/route.ts` — GET 详情 / PATCH 更新（无 DELETE）
- `sessions/[id]/content/route.ts` — GET R2 conversation content
- `sessions/[id]/star/route.ts` — PATCH 收藏切换
- `sessions/[id]/tags/route.ts` — GET 列出标签 / PUT 添加单个标签（body: `tagId` 或 `tagName`）/ DELETE 移除单个标签（body: `tagId` 或 `tagName`）
- `sessions/[id]/trash/route.ts` — PATCH 回收站切换
- `sessions/batch/route.ts` — 批量操作
- `sessions/filters/route.ts` — 过滤器选项
- `search/route.ts`
- `stats/route.ts`
- `tags/route.ts` / `tags/[tagId]/route.ts`
- `projects/route.ts` / `projects/activity/route.ts`
- `ingest/presign/route.ts` — R2 预签名
- `ingest/confirm-raw/route.ts` — 确认 raw 对象
- `ingest/content/[...path]/route.ts` — PUT 上传 canonical/raw content 到 Worker/R2（`PUT /api/ingest/content/{sessionKey}/{type}`）
- `ingest/sessions/route.ts` — 正式 ingest 接口
- `live/route.ts` — 健康检查

### `src/lib/*.ts` 分类（不变，初稿已核对）

- 纯业务可搬到 api：`sessions.ts`、`search.ts`、`stats.ts`、`tags.ts`、`projects.ts`、`ingest.ts`、`session-detail.ts`
- **共享基础设施（提到 `packages/core/src/infra/`，web + api 都依赖）**：`d1.ts`、`r2.ts`、`worker-client.ts`
  - 原因：web 仍需要它们 —— `auth.ts`(D1AuthAdapter) → `d1.ts`、`ingest/presign` → `r2.ts`、`ingest/confirm-raw` + `worker-cli-auth-db.ts` → `worker-client.ts`
- Auth 相关**必须留 web**：`auth.ts`、`auth-adapter.ts`、`cli-auth.ts`、`session-user.ts`、`worker-proxy.ts`（过渡期）、`worker-cli-auth-db.ts`
- UI helpers 留 web：`format.ts`、`calendar-helpers.ts`、`navigation.ts`、`palette.ts`、`utils.ts`

### CLI token 现状（初稿错认，已修正）

**不存在独立 `api_tokens` 表**。实际链路：
1. 用户在 web 登录 → NextAuth 发 session cookie
2. CLI 打开浏览器 → `web /api/auth/cli` 读 session → 调 Worker `/auth/cli-key`
3. Worker 内部生成 plaintext `pk_...`、hash 后写到 `users.api_key`、把 plaintext 返给 web → web 返给 CLI
4. CLI 后续请求带 `Authorization: Bearer pk_...`
5. 现在由 web 的 `resolveUserForWorker` 调 Worker `/auth/me` 校验

→ api 层的 bearer 校验**不再需要直连 D1**，复用 Worker `/auth/me` 即可。`worker-cli-auth-db.ts` 仅在 web 的 `/api/auth/cli` flow 里使用，**不需要搬**。

## 最终架构

### 同源反代（最终决策，解决 cookie 问题）

NextAuth cookie 是 **host-only + `__Secure-authjs.session-token`**（`packages/web/src/lib/auth.ts` 未设 `domain`）。
浏览器不会把它带到任何其他 origin/子域，因此：

- **不做**跨域 CORS + `credentials: "include"`
- **不改** cookie domain（扩大攻击面 + 改动风险大）
- **做**：Caddy / 反代把 `/api/*` 按前缀分流到不同 upstream，浏览器始终只看到 web 同源

```
用户浏览器 ──→ pika.dev.hexly.ai  ──→ Caddy
                                      ├─ /api/auth/**    → web:7022 (NextAuth + CLI auth)
                                      ├─ /api/**         → api:7023 (业务 Hono)
                                      └─ /**             → web:7022 (UI)
```

RSC / server action 内部也同理：
- 开发：`API_INTERNAL_URL=http://localhost:7023`（直接命中 api，跳过 Caddy）
- 生产：`API_INTERNAL_URL=http://api.internal:7023`（或 Railway 私网）
- 调用时必须**手动透传** `Authorization` 或 `Cookie` header（见 auth 契约）

### 认证契约（修正 cookie 名与 secret 来源）

当前 Auth.js v5 实际配置：
- cookie 名：`__Secure-authjs.session-token`（HTTPS）/ `authjs.session-token`（HTTP）
- secret 环境变量：`NEXTAUTH_SECRET`（见 `docs/05-dashboard.md`）
- strategy：JWT（非 database session）

api 层 auth middleware 两种路径：

| Caller | 凭证 | api 侧验证 |
|---|---|---|
| 浏览器同源请求 | Cookie `(__Secure-)?authjs.session-token` | 用共享 `NEXTAUTH_SECRET` + `@auth/core/jwt` 的 `decode` 验 JWT，优先读 `userId`，fallback 到 `sub` → userId。**cookie 名解析复用 web 的 `shouldUseSecureCookies()` 逻辑**（提到 `packages/core/src/infra/authjs-cookie.ts` 共享），不依赖入站协议推断，也不引新 env |
| CLI / server 内部 | `Authorization: Bearer pk_...` | 转发到 Worker `/auth/me`（已存在）拿 userId |
| E2E | `X-E2E-User: <userId>` | 仅当 `E2E_SKIP_AUTH=true` 且 `NODE_ENV === 'development'` 时启用（与 web 现有门槛一致） |

**不共享 `JWT_SECRET`**（初稿写错），直接共享 `NEXTAUTH_SECRET`。decode 要匹配 Auth.js v5 的实现：v5 用 JWE（加密而非仅签名），需引入 `@auth/core/jwt` 并使用 `decode()` 而不是通用 `jose.jwtVerify`。

```
┌─────────────────────────────────────────────────────────┐
│  packages/web (Next.js, 未来 → vinext/vite)              │
│  UI + NextAuth + /api/auth/** (NextAuth) +              │
│  /api/auth/cli (读 cookie → Worker cli-key)             │
└──────────┬──────────────────────────────────────────────┘
           │ 同源 fetch，Caddy 前缀路由
           ▼
┌─────────────────────────────────────────────────────────┐
│  packages/api (Hono)                                     │
│  middleware: decode authjs JWT | Bearer→Worker /auth/me │
│                | E2E bypass (dev only)                  │
│  routes: sessions/** search stats tags/** projects/**    │
│          ingest/** live                                 │
└──────────┬──────────────────────────────────────────────┘
           │ Worker Client (WORKER_SECRET)
           ▼
      Cloudflare Worker → D1 / R2
```

## 包结构（补全路由）

```
packages/api/src/
├── app.ts / server.ts / index.ts
├── env.ts
├── middleware/{auth,error,logger}.ts
├── routes/
│   ├── sessions/
│   │   ├── index.ts        # GET /sessions, POST ... /sessions/batch, /filters
│   │   ├── detail.ts       # GET/PATCH /sessions/:id
│   │   ├── content.ts      # GET /sessions/:id/content → Worker R2 fetch
│   │   ├── star.ts         # PATCH /sessions/:id/star
│   │   ├── tags.ts         # GET/PUT/DELETE /sessions/:id/tags
│   │   └── trash.ts        # PATCH /sessions/:id/trash
│   ├── search.ts  stats.ts  live.ts
│   ├── tags.ts             # /tags, /tags/:tagId
│   ├── projects.ts         # /projects, /projects/activity
│   └── ingest/
│       ├── presign.ts
│       ├── confirm-raw.ts
│       ├── content.ts      # PUT /ingest/content/:path*  (上传 canonical/raw 到 R2)
│       └── sessions.ts
└── lib/                    # 从 web 搬来的纯业务
```

## 迁移分阶段（atomic commits）

### 切流方案（统一约定，禁止混用）

cutover 不依赖 `next.config.ts` 的 `rewrites()`。原因：Next 的数组形式 rewrites 在 filesystem 检查**之后**才应用，本地 `app/api/.../route.ts` 还在时 rewrite 不会命中 → 不是可靠的 cutover 手段。本 doc 全程**不使用 rewrites 做切流**，dev 同源模拟由 Caddy（或等价反代）承担。

统一采用**「保留 web handler，handler 内 fetch 转发到 api」**的双写过渡：

- 阶段 a（搬业务到 api）：api 上线后，web 的 `route.ts` 内部用 `fetch(API_INTERNAL_URL + path, { method, headers, body })` 转发，并把当前请求的 `Cookie`、`Authorization` 透传过去；handler 仍然是 cutover 的真实入口
- 阶段 b（Caddy 切流）：生产 Caddy `/api/*` → api、dev 等价机制上线。浏览器**继续**打同源 `/api/*`，不需要任何前端改动；web 的转发 handler 在 Caddy 切流后不再被浏览器命中，但仍服务 RSC/server action 的 hop（直到它们改为 `API_INTERNAL_URL`）
- 阶段 c（清理）：服务端 hop 改为 `API_INTERNAL_URL` 直连 api；确认 web 转发 handler 无流量后删除

`next.config.ts` rewrites **不**用于 dev 同源模拟（与 cutover 同理：filesystem 优先于 array rewrites，handler 还在就会被劫持，行为与生产 Caddy 不一致）。dev 也走 Caddy 或等价反代。

### Caddy 路由（dev 同源切流；prod 终态走 Vite + CF Workers）

> 说明：Caddy **仅作 dev 反代**。生产形态分两阶段：（i）暂态 Railway 双服务，web 通过 `API_INTERNAL_URL` 内网调 api；（ii）终态 Vite + Cloudflare Workers 单 Worker 内路由，无 Caddy。

```
*.dev.hexly.ai → Caddy（dev only）
  /api/auth/*  → web:7022 （NextAuth + CLI auth，host-only cookie 必须留在 web 域）
  /api/*       → web:7022 → api:7023 （web forwarder 内部 fetch，仍走同一个 dev 进程对）
  /*           → web:7022 （UI）
```

dev 同时起两个进程：`bun run dev:all`。

### P0. 骨架 ✅ (commit 235657b, 2026-04-24)
- 新建 packages/api，空 Hono app + `/live`
- workspace / tsc / biome / vitest 接入；本地 7023 起
- **不**改 `next.config.ts`；冒烟通过直接 `curl localhost:7023/live`

**完成状态**：
- `packages/api/{package.json,tsconfig.json,src/{app,server,index}.ts,src/routes/live.ts}` 落地
- 根 `tsconfig.json` references 加 `packages/api`
- 4 个单测全绿（`app.test.ts` 2 + `routes/live.test.ts` 2）；`server.ts`（Bun.serve 入口）已在 `vitest.config.ts` coverage exclude 中和其他 entrypoint 一并排除，仓库整体覆盖率门槛照常通过
- 冒烟实测：`PORT=17999 bun run --cwd packages/api dev` → `curl /live` 返回 200 + `{status:"ok",component:"api",...}`，未知路径 404
- 备注：默认端口 7023 可能与本机其他服务冲突（实测哥机器上 7023 已被 node 占用），运行时可用 `PORT=...` 覆盖；P3 落地 dev 脚本时再决定终选端口

### P1. Auth middleware（契约先行）✅ (commits ff2442b + 49e7343 + 7d568fb + 3718fc8, 2026-04-24)
- `packages/api/src/middleware/auth.ts`：
  - cookie 解码：遍历 `packages/core/src/infra/authjs-cookie.ts::SESSION_COOKIE_NAMES`（`__Secure-authjs.session-token` + `authjs.session-token` 两种变体），salt = 命中的 cookie 名。这样反向代理环境下的 prefix 不一致也能正确解码。`resolveSessionCookieName()` 仅供 web 写 cookie 时单点选择使用；api 解码侧不依赖单点结果。禁止按 `req.protocol` / `x-forwarded-proto` 推断
  - Bearer `pk_` → Worker `/auth/me`
  - E2E bypass：`E2E_SKIP_AUTH=true` 且 `NODE_ENV === 'development'` 时，读 `X-E2E-User` header → userId（沿用 web 侧 `worker-proxy.ts` / `cli-auth.ts` 现有更窄的门槛，不放宽到 preview/test）
- 共享环境变量：`NEXTAUTH_SECRET`、`NODE_ENV`、`AUTH_URL`、`USE_SECURE_COOKIES`（web 和 api 共用同一份值；不新增独立 cookie 名 env）
- 单测：合法 cookie / 过期 cookie / 缺 cookie / bearer 正常 / bearer 404 / E2E header（NODE_ENV=development）/ 非 development 时无视 E2E bypass

**完成状态**：
- `packages/core/src/infra/authjs-cookie.ts` + 9 个单测落地，web `auth.ts` 改为从 `@pika/core` 导入 `shouldUseSecureCookies`（完全去掉重复逻辑）
- `packages/api/src/middleware/auth.ts` 实现 `resolveUser()` + `requireUser()`：
  - 顺序：E2E bypass → Auth.js cookie（两种名都试，salt = 命中的 cookie 名）→ Bearer `pk_*` → Worker `/auth/me`
  - 依赖通过 `AuthMiddlewareDeps` 注入（`getSecret` / `getWorkerUrl` / `getEnv` / `fetch`），生产默认从 `process.env` 读
  - secret 兼容 `NEXTAUTH_SECRET` / `AUTH_SECRET`
- 21 个单测：合法/过期/缺失/格式错乱 cookie、payload 无 userId、salt mismatch、secret 缺失、bearer 200/404/throw/无 userId、WORKER_URL 缺失、非 pk_ bearer、E2E header 命中/缺省、E2E 在生产/未开启时被忽略、默认值取自 `process.env`、`AUTH_SECRET` fallback、默认 fetch 走全局
- 覆盖率：`packages/api/src/middleware/auth.ts` 100% line/function（branch 97.7%），仓库整体覆盖率门槛通过
- 新增依赖：`@auth/core@^0.41.0`（与 web 内嵌版本对齐），用于 `decode/encode` JWE

**Follow-up fix (commit 3718fc8, 2026-04-24)** — 解决 P1 落地后发现的 3 个问题：
- HIGH 1：`@pika/core` build 因 `authjs-cookie.ts` 引用 `NodeJS.ProcessEnv` / `process.env` 而失败。core 不引入 Node typings，helper 改写为 runtime-agnostic：导出 `AuthCookieEnv` 显式接收 env bag，不再默认读 `process.env`。web `lib/auth.ts` 改为显式传 `process.env`
- HIGH 2：`packages/api` build 因 tsconfig 未排除测试 + 测试中 `fetchSpy.mock.calls[0]` tuple 解构不安全而失败。`packages/api/tsconfig.json` 加 `"exclude": ["src/**/*.test.ts"]`（与 core 对齐）；测试中改用 `const call = fetchSpy.mock.calls[0]; expect(call).toBeDefined(); const [url, init] = call as [URL, RequestInit];`。`packages/api` 增 `@types/node` devDependency 用于生产代码 `process.env` 类型
- MEDIUM 3：`decodeFromCookies()` 注释要求 cookie 在场但解码失败时**不要 fallthrough 到 bearer**，但旧实现 return null → resolveUser 继续走 bearer 分支。改为返回 `CookieDecodeResult` 三态判别联合（`ok` / `invalid` / `absent`）；`resolveUser` 仅在 `absent` 时尝试 bearer。新增测试：`cookie 非法 + Bearer pk_legit` → 401 且 fetchSpy 未被调用
- 测试数量：21 → 22；`bun run --cwd packages/core build` / `bun run --cwd packages/api build` 都绿；1685 个单测全绿


### P2. 共享包边界（关键，不再叫「基础设施下沉」）✅ (commits 574976c + 7530f08, 2026-04-24)

`d1.ts`、`r2.ts`、`worker-client.ts` 不能搬走后只在 api 里——web 仍有真实依赖：
- `auth.ts` 通过 `D1AuthAdapter` 用 `d1.ts`（NextAuth users/accounts）
- `ingest/presign/route.ts` 用 `r2.ts`（生成 presigned URL）
- `ingest/confirm-raw/route.ts`、`worker-cli-auth-db.ts` 用 `worker-client.ts`

外加 P1 引入的共享：cookie 名派生逻辑（`authjs-cookie.ts`，封装 `shouldUseSecureCookies()`）

方案：提到 `packages/core/src/infra/`，web 和 api 都依赖。

**核心包导出设计**（当前 `packages/core/package.json` 只有单入口 `src/index.ts`，必须先扩）：

```jsonc
// packages/core/package.json
{
  "exports": {
    ".":             { "import": "./src/index.ts", "types": "./src/index.ts" },
    "./infra":       { "import": "./src/infra/index.ts", "types": "./src/infra/index.ts" },
    "./infra/d1":    { "import": "./src/infra/d1.ts", "types": "./src/infra/d1.ts" },
    "./infra/r2":    { "import": "./src/infra/r2.ts", "types": "./src/infra/r2.ts" },
    "./infra/worker-client": { "import": "./src/infra/worker-client.ts", "types": "./src/infra/worker-client.ts" },
    "./infra/authjs-cookie": { "import": "./src/infra/authjs-cookie.ts", "types": "./src/infra/authjs-cookie.ts" }
  }
}
```

- 根 tsconfig 加 `paths` 映射 `@pika/core/infra/*` → `packages/core/src/infra/*`，和 web 的 tsconfig（bundler resolution）同步
- `packages/core/src/infra/index.ts` 做 barrel，避免深路径散落
- web package 仍保留 `moduleResolution: bundler`，无 `.js` 扩展名（参见 CLAUDE.md retrospective）

P2 的 commits：
1. ✅ `574976c` — 加 `packages/core/src/infra/` 目录、barrel 与 `authjs-cookie` 导出，`packages/core/package.json` 扩展 exports map（根/web tsconfig 的 `@pika/core/*` 通配 paths 已经覆盖 `@pika/core/infra/*`，无需新增 path 映射）
2. ✅ `7530f08` — 把 `d1.ts` / `r2.ts` / `worker-client.ts`（runtime-agnostic 的 class + Config + helper）+ class 行为单测搬到 `packages/core/src/infra/`；web `lib/*.ts` 改为薄 wrapper：`export * from "@pika/core/infra/<x>"` + `getXxxClient()` 单例（读 `process.env`）+ env-reading `assertTestDatabase()` / `assertTestBucket()` wrapper
3. ✅ web 改 import：app/lib 仍走 `@/lib/*` / `./*` 不动（wrapper 透明保留 surface）；`bun run build`（含 `next build`）+ vitest（68 files / 1693 tests / 覆盖率门槛通过）+ biome 全绿
4. （此时 api 还未引用，自然兼容）

**完成状态**：
- core 新增依赖：`@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`（r2.ts 直接需要）
- 设计取舍：core 不包含任何 singleton，所有 helper / assertion 显式接收参数（`assertTestDatabase(client, databaseId)`、`assertTestBucket(bucket)`）；`process.env` 读取一律放在 web wrapper 层。这样 api / cli / worker 后续要复用 core 的 class 时不必拖 `process.env` 形状的耦合
- class 行为单测落在 `packages/core/src/infra/*.test.ts`（92 个测试：d1=20 / r2=31 / worker-client=41）；web `lib/*.test.ts` 只保留 wrapper 行为（singleton / env-reading assertion，14 个）
- 覆盖率：vitest 配置 `packages/core/src/**` 不计入 coverage 门槛，但测试仍执行；web wrapper 的 `r2.ts` branch 覆盖 50% 是 `process.env.X ?? ""` 的 nullish-fallback，无需补
- `bun run --cwd packages/core build` / `bun run --cwd packages/api build` / `bun run --cwd packages/web lint` / `bun run build`（含 `next build`）全绿

### P3. 按域迁移（每域一个 commit，共 8 个）✅ (P3.1–P3.8 done, 2026-04-24)

**完成状态**（按 commit 顺序）：
1. ✅ P3.1 `live` — commit a87b1a8 (前序 prereq commits 见 #11/#12 任务)
2. ✅ P3.2 `search` — commit `e63ce04`
3. ✅ P3.3 `stats` — commit `cbf1819`
4. ✅ P3.4 `projects` (+ `/activity`) — commit `c21f9ec`
5. ✅ P3.5 `tags` (+ `/:tagId`) — commit `1330da7`
6. ✅ P3.6 `sessions` 列表族 (`/sessions`, `/sessions/batch`, `/sessions/filters`) — commit `3424877`
7. ✅ P3.7 `sessions/:id` 族 (`:id`, `:id/content`, `:id/star`, `:id/tags`, `:id/trash`) — commit `8101447`
8. ✅ P3.8 `ingest` 族 (`presign`, `confirm-raw`, `sessions`, `content/:path*`) — commit pending

api 单测：101 tests / 6 files，覆盖率 99.52% lines / 96.8% branches / 100% funcs（≥95% / ≥90% / ≥95% 门槛）。
web 侧 `src/app/api/<domain>/**/route.ts` 全改为 `forwardGet/forwardPost/...` 一行转发；`packages/web/tests/e2e/helpers.ts` `MIGRATED_API_PREFIXES` 已覆盖全部八个域。

顺序考虑依赖 + 风险从低到高：
1. `live`（零依赖，先验证整条链路）
2. `search`（只读、无 path param）
3. `stats`（只读）
4. `projects` + `projects/activity`
5. `tags` + `tags/:tagId`
6. `sessions` 列表族（`/sessions`, `/sessions/batch`, `/sessions/filters`）
7. `sessions/:id` 族（`:id`、`:id/content`、`:id/star`、`:id/tags`、`:id/trash`）
8. `ingest` 族（`presign`、`confirm-raw`、`content/:path*`、`sessions`）

每域步骤（采用上文「阶段 a」转发模式）：
1. 搬 `packages/web/src/lib/<domain>.ts` + `.test.ts` 到 `packages/api/src/lib/`
2. `packages/api/src/routes/<domain>.*` 暴露 Hono route
3. **web 侧 `route.ts` 改为 fetch 转发**到 api（保留 handler，透传 Cookie/Authorization/X-E2E-User）
4. L1 跑通 → L2 跑通 → commit

### P4. 收敛服务端 hop（不改浏览器行为）✅ (commits P4.1 `6c92638` + P4.2 `d70dec5` + P4.3 本 commit, 2026-04-25)

**浏览器永远打同源 `/api/*`**，这是 host-only cookie 的前置条件，不能破坏。当下的形态：

- **dev**：Caddy 把 `*.dev.hexly.ai` 反代到 `localhost:7022`（web，next dev）；服务端 hop（web 的 `/api/*` route handler → api）走 `API_INTERNAL_URL`，默认 `http://localhost:7023`。dev 同时起两个进程：`bun run dev:all`（见 `scripts/dev-all.ts`）。
- **prod（暂态）**：Railway 部署 web 与 api 两个独立服务，web 通过 `API_INTERNAL_URL` 直接 fetch 到 api 的内网地址；浏览器看到的仍然是同源 `/api/*`。
- **prod（终态，未来）**：迁移到 **Vite + Cloudflare Workers**——web 和 api 合并到 CF Workers 上，路由通过 Worker `fetch` handler 内分发，不再需要 Caddy 反代。Caddy 仅是 dev 同源模拟器，**不会上生产**。这是独立的下一阶段工程，不在本 doc 范围。

**已完成**：
- ✅ P4.1：`packages/web/src/app/api/live/route.ts` 收敛到 `forwardGet`，删除自定 503 envelope（api `/live` 已经返回同 shape）
- ✅ P4.2：根 `package.json` 加 `dev:all` / `dev:api`；新增 `scripts/dev-all.ts`，并发起 web+api、prefix 着色输出、SIGINT 级联终止
- ✅ P4.3：本节文档 ↑

**验收**：
- 浏览器 Network 面板 host 始终是 web 的域（同源 `/api/*`）；api host 只在服务端日志里出现
- E2E `setup.ts` 已经同时拉起 web (:17022) + api (:17023)，本轮无需再改

**未决（非阻塞）**：服务端 hop 是否进一步引入 RSC `cache: 'no-store'` fetch 或 server actions——目前 web 本身没有 RSC 直接 fetch api 的代码，全部入口都是浏览器经由 `/api/*` → web forwarder → api，所以这一节暂不展开。一旦未来 web 引入 RSC 数据预取，按 docs/16 P4 既定原则使用 `API_INTERNAL_URL`。

### P5. 清理 ✅ (commits 见 P5.1/P5.2/P5.3, 2026-04-24/25)
- ✅ 删除 web 内业务 `src/app/api/**/route.ts`，仅保留 `auth/[...nextauth]`、`auth/cli`（P3 域迁移过程中已逐域替换为 forwarder；non-auth handlers 全部走 `createForwardHandler`）
- ✅ 删除 `worker-proxy.ts`（`resolveUserForWorker` 被 api middleware 取代）— P5.1
- ✅ web 的 `lib/{ingest,r2,worker-client}.ts` + 测试删除，`worker-cli-auth-db` 改用 `@pika/core/infra/worker-client` — P5.1
- ✅ 更新 `docs/01-architecture.md`、`docs/05-dashboard.md`、`docs/11-unified-worker-api.md` — P5.2 (commit `c876502`)
- ✅ 更新 `docs/09-quality-upgrade-6d.md`（端口表加 api）+ `CLAUDE.md` Ports 行
- ✅ CI 增加 api build/test job — P5.3 (commit `eb230c0`)

## L2 测试认证方案（解决回归风险）

### 现状校正
- `packages/web/tests/e2e/setup.ts` 只拉 Next dev server（17022），`E2E_SKIP_AUTH=true` 生效于 `worker-proxy.ts` 的 `resolveUserForWorker`
- `packages/web/tests/e2e/helpers.ts` 只有单一 `E2E_BASE_URL`，**不会**自动注入任何 auth header
- `packages/web/tests/e2e/ingest.spec.ts` **只覆盖** `ingest/sessions` + `ingest/content`，文件头注释明确：「presign / confirm-raw 走 `auth()` 不支持 bypass，所以这两个端点不在 spec 范围内」。即不是「绕开 bypass」，而是 spec 主动避开了不支持 bypass 的两条路径

### 方案
api middleware 原生支持 `X-E2E-User`，但测试基建必须**同时**改造：

1. `packages/api/vitest.e2e.config.ts` 新建（复用 web 现有结构）
2. `packages/web/tests/e2e/setup.ts`：
   - 启 web dev server（保留，给 auth/CLI auth 测试用）
   - **新增**启 api dev server：`PORT=17023 E2E_SKIP_AUTH=true bun run --cwd packages/api dev`
3. `packages/web/tests/e2e/helpers.ts` 必须重构，不能只改 base URL：
   - 拆 `E2E_WEB_BASE_URL`（17022）+ `E2E_API_BASE_URL`（17023）两个 env
   - `request()` 增加 `target: 'web' | 'api'` 参数（或按 path 前缀路由：`/api/auth/**` → web，其余 → api）
   - 在 helper 层**自动**给所有打 api 的请求注入 `X-E2E-User: E2E_USER.userId`，避免每个 spec 手写
4. **`ingest.spec.ts` 自定义 `rawRequest()` 必须一并收敛**（packages/web/tests/e2e/ingest.spec.ts:21）：该函数绕过共享 helper，支持 raw body / 自定义 Content-Type（`application/octet-stream`），目前硬编码 base URL 和 header。要么：
   - (a) 在共享 helper 新增 `rawRequest(target, method, path, body, headers)`，ingest spec 替换掉本地版本；或
   - (b) 保留 spec 内 `rawRequest`，但改为通过共享 helper 暴露的 `resolveBaseUrl(target)` + `buildAuthHeaders(target)` 拼装，确保 base URL 路由和 `X-E2E-User` 注入同源于 helper 单点
   - **推荐 (a)**，彻底去重
5. presign / confirm-raw 在 P3 ingest 域迁完之后，**仍然**不进 ingest spec（行为不变，由后续单独的 auth-aware E2E 覆盖）；本次重构不解锁这两个端点的 bypass
6. **P2 必须先把 helper 双 base URL + 自动注入 header + rawRequest 收敛全部落地**；P3 第一个域 `live` 用来端到端验证（dev server 双开 + helper 路由 + middleware bypass 都通），不通就停下来修，不进下一个域

P3 每搬完一个域，spec 里只需把 path 前缀（`/api/<domain>/*`）保持不变（helper 自动路由到 api），不需要逐个 spec 改 base URL，也不需要重写认证。

## 端口与部署

| 服务 | dev | L2 E2E | prod |
|---|---|---|---|
| web | 7022 | 17022 | Railway |
| **api** | **7023** | **17023** | **Railway 独立 service** |
| Worker | wrangler dev | — | Cloudflare |

```json
"dev": "concurrently -n web,api -c blue,green 'bun run --cwd packages/web dev' 'bun run --cwd packages/api dev'"
```
> 注：仓库当前**未安装** `concurrently`（根 `package.json` 和 `packages/web/package.json` 均无）。落地此脚本前需先 `bun add -D concurrently` 到根 workspace；或选用等价工具（如 `npm-run-all2`、`mprocs`）并相应调整命令。

Caddy 路由分流如上，**dev 也走 Caddy / 等价反代同源模拟**，不使用 Next `rewrites()`。

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| cookie 被误配跨域 | 坚持同源反代，不改 cookie domain，api 不设 CORS 允许凭证 |
| NextAuth v5 的 JWE decode 搞错 salt | P1 用 web 实际发出的 cookie 做 golden test，固定 salt = cookie 名 |
| `NEXTAUTH_SECRET` 泄露面扩大 | api 只 `decode` 不 `encode`；部署时只读；Secret rotation 走两端同步 |
| 现有 L2 依赖 web `E2E_SKIP_AUTH` | P2 先把 api 的 E2E header 方案落地，P3 第一个域（live）专门验证 |
| Worker `/auth/me` 成为 api 热路径瓶颈 | api middleware 内存短 TTL cache（5s–30s），以 bearer 为 key |
| 漏迁某个路由 | 本 doc §"完整路由清单" 作为 checklist，P5 清理前逐条勾 |
| 双进程开发痛感 | 见上文 dev 脚本（需先安装 `concurrently`）+ 共享 `.env`；README 补 troubleshoot |

## Out of Scope

- NextAuth 迁移到其他方案 / cookie 改 domain
- `worker-cli-auth-db.ts` 挪位（确认仅 web 使用）
- ORM、新 DB 驱动
- 前端 RSC → CSR 重构（vite 迁移阶段）

## 决策点

1. **HTTP 框架**：Hono（推荐）vs Elysia
2. **部署形态**：Railway 独立 service（推荐）vs web 容器多进程
3. **`NEXTAUTH_SECRET` 共享方式**：直接环境变量 vs Secret Manager 注入
4. **P0 时机**：本周 vs vinext 调研后
