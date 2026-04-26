# 17 — Web 重写：Next.js → Vite SPA + Cloudflare Workers

## 目标

把 `packages/web` 改名为 `packages/web_legacy`（冻结、只读、过渡期保留参考价值），按 [`../surety`](../../surety) 的形态重写一份 `packages/web`：

- **前端**：Vite + React 19 + react-router v7 SPA（不再 SSR）
- **打包产物**：静态资产由 Cloudflare Worker 的 `[assets]` 服务
- **认证**：照搬 surety —— **Cloudflare Access**（团队 SSO，`Cf-Access-Jwt-Assertion` header），彻底放弃 NextAuth + Google OAuth
- **API**：`packages/web-worker` 持有 `/api/*` 入口（Hono），内部 fetch 转发到独立的 `packages/api`（保留并独立测试）；非 `/api/*` 走 SPA fallback
- **部署**：`packages/web-worker` + `packages/api` + `packages/worker` 三个独立 CF Worker；告别 Railway / Caddy / Next dev
- **保留**：
  - `packages/api`（Hono，独立部署 + 独立测试）—— **当前及本 doc 终态都是 auth / facade 层**：暴露 `/sessions`、`/search`、`/stats`、`/projects`、`/tags`、`/ingest`、`/live`，但 handler 几乎都是 `workerGetHandler/workerPostHandler` 包装（见 `packages/api/src/routes/stats.ts`、`packages/api/src/lib/worker-proxy.ts`），实际数据面在 packages/worker
  - `packages/core/infra`
  - `packages/worker` —— **不只是 ingest**：仍是 D1/R2 真正的读写承接者（sessions CRUD、search FTS5、stats 聚合、projects/tags、content 上传/下载，见 `packages/worker/src/index.ts`）。本 doc **不**做"读侧/查询侧从 worker 搬到 api"的工作，那属于另一篇设计。本 doc 只动 web 层 + auth 模型，packages/api 与 packages/worker 的职责分割维持现状

`docs/16` 已经把业务从 Next 抽成独立 Hono；本文承接其上把"前端薄壳 + auth"也从 Next 摘掉，并把 auth 模型从"自管 OAuth + cookie"换成"CF Access 托管"。

## 参考形态：`../surety`

surety 的 web/worker 组合（已生产运行，作为模板）：

```
apps/web/                  Vite SPA，build → ../worker/static
  vite.config.ts           proxy /api → SURETY_API_URL（dev 等价 Caddy）
  src/main.tsx             createRoot + BrowserRouter
  src/App.tsx              react-router v7，lazy 路由
apps/worker/               单 CF Worker
  wrangler.toml            [assets] directory=./static, run_worker_first=["/api/*"],
                           not_found_handling="single-page-application"
  src/index.ts             Hono app，挂 dbMiddleware/auth/路由
  src/middleware/access-auth.ts  Cloudflare Access JWT 校验（替代 NextAuth）
```

关键结论：surety 用 **Cloudflare Access** 做认证（团队 SSO，JWT in `Cf-Access-Jwt-Assertion` header），所以 Worker 完全无状态。pika 本次重写**采用同模型**，原 NextAuth + Google OAuth + `users`/`accounts` 表的自管认证全部退场。

## 现状盘点（pika）

### 入口、路由、auth

`packages/web` 当前形态：

- Next.js 15 App Router，SSR + RSC
- `src/app/{dashboard,login,page.tsx,layout.tsx}` 是 UI 入口；`src/app/api/auth/{[...nextauth],cli}` 是 NextAuth + CLI 换 token 的 server-only 端点
- `src/app/api/**` 其他路由在 `docs/16 P3` 已经全部改成 forwarder，调 `packages/api`（Hono，Bun runtime）
- `src/lib/auth.ts`：NextAuth v5 + Google + `D1AuthAdapter`（写 D1 的 `users` / `accounts` 表）
- `src/lib/cli-auth.ts` + `worker-cli-auth-db.ts`：CLI 换 `pk_*` token 的浏览器侧流程
- 启动靠 Caddy 在 `pika.dev.hexly.ai` 反代到 `next dev :7022` + `bun run packages/api :7023`

### Cloudflare 资源

- D1：metadata + FTS5（`pika-db` / `pika-db-test`），由 `packages/worker` 用 binding 写、由 `packages/api` 经 Worker HTTP 读写
- R2：`pika`（canonical + raw），同上
- Worker：`packages/worker`（独立 Worker，承接 D1/R2 真实读写——sessions CRUD、search FTS5、stats 聚合、projects/tags、content 上传/下载、ingest——以及 `/auth/me` + `/auth/cli-key`；`packages/api` 通过内部 HTTP `WORKER_URL` + `WORKER_SECRET` 调用）

### 关键 retrospective（约束本次重写）

- `next-auth@5.0.0-beta.30` 嵌套 `@auth/core@0.41.0`，PKCE 强制启用——Worker 上跑 Auth.js 必须直接依赖 `@auth/core`，不要走 `next-auth` 包
- web 现用 `moduleResolution: "bundler"`，**不能写 `.js` 后缀**——Vite 同样是 bundler resolution，沿用即可
- 3 层亮度：L0 background < L1 card < L2 secondary，全局 CSS 变量直接搬
- shadcn/ui + Tailwind v4 + tw-animate-css，与 surety 一致

## 认证模型（已定：Cloudflare Access）

照搬 surety `apps/worker/src/middleware/access-auth.ts`：

- 浏览器侧：用户先经 Cloudflare Access SSO（Google / 邮箱 OTP / Okta 等由 CF 团队配置），CF 在每个发往 Worker 的请求上注入 `Cf-Access-Jwt-Assertion` header
- Worker 侧：`access-auth` middleware 用 `jose.createRemoteJWKSet` 从 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` 拉公钥校验 JWT，验签通过则 `c.set("accessAuthenticated", true)` 与 `accessEmail`
- CLI / 程序化访问：依旧 `Authorization: Bearer pk_*`，由 `api-key-auth` middleware 接管（与 surety `apiKeyAuth` 一致），命中后同样 set `accessEmail`，并更新 `lastUsedAt`
- dev / 本机：`isLocalhost(c)` —— 当请求**不**带 `cf` 字段（非 CF edge）且 host 是 `localhost` / `127.0.0.1` / `*.dev.hexly.ai` 时跳过 Access 校验；带 Bearer 的本机请求仍走 `apiKeyAuth` 拿 `accessEmail`
- E2E：保留 `E2E_SKIP_AUTH=true` 旁路，与 surety 一致（`ENVIRONMENT !== "production"` 双重门槛）

### 本机 dev 身份方案

本地开发要避免"无脑注入 `dev@local` 把所有写操作落到伪用户"——pika 数据按稳定 `userId` 分区，注入伪 email 后 P1.3 幂等 upsert 会创建一个空白 dev 用户，本地浏览器调试将看不到任何真实数据，dev 写操作也会污染这个伪用户。

策略（按优先级取）：

1. **首选——浏览器带 Bearer**：本机不依赖 CF Access SSO，浏览器侧通过用户脚本/扩展或开发面板注入 `Authorization: Bearer pk_<dev>` header（dev 专用 token，从 `/cli` 页面或 `pika login` 拿）。`apiKeyAuth` 命中后 `accessEmail` 来自 `api_tokens.email` → 真实 userId，浏览器看到的是真实数据。
2. **次选——显式指定模拟身份**：`isLocalhost` 旁路时读 `X-Dev-User-Email` header（或 `DEV_USER_EMAIL` env / cookie）；缺省时**拒绝**而非默认 `dev@local`。dev 工程师必须在 `.env.local` 设 `DEV_USER_EMAIL=<自己的真实 email>`，启动时 worker 在控制台打印当前模拟身份。这把"哪个用户"显式化，避免误用伪用户。
3. **不允许**：在 dev 路径上无条件注入 `dev@local` 然后 upsert。这是 surety 的做法但 surety 不存在 pika 这种"老 userId 分区"的历史包袱。

执行时 P1.2 / P1.3 落地按上面 #2 实施（同时支持 #1，因为 `apiKeyAuth` 优先级高于 `isLocalhost`）。

环境变量需要新增 / 变更：
- `CF_ACCESS_TEAM_DOMAIN`（如 `hexly.cloudflareaccess.com`）
- `CF_ACCESS_AUD`（Application Audience Tag，CF Access app 配置后生成）
- 删：`NEXTAUTH_SECRET`、`AUTH_URL`、`USE_SECURE_COOKIES`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`

## 身份模型与迁移（关键，先于 P1）

既有数据面以 **稳定的 `userId`** 为主键：`packages/api/src/middleware/auth.ts` 的 `AuthVariables.userId`、`packages/api/src/app.ts` 上所有 route 的 `c.get("userId")`、`packages/worker` 的 D1 查询 / R2 key 全部按 `user_id` 过滤。CF Access 给的是 **`accessEmail`**，不能直接替换。这里需要先把"email → userId"映射定下来，否则浏览器虽认证但拉不到任何历史数据。

策略：
1. **沿用现有 `users` 表作为 email → userId 的映射源**。NextAuth 历史落库的 `users.email` + `users.id` 即既有映射，迁移期不动这张表的 PK
2. **首次登录创建/补齐**（幂等 upsert，防并发）：web-worker 的 access-auth middleware 在拿到 `accessEmail` 之后：
   ```sql
   INSERT INTO users (id, email, name) VALUES (?, ?, ?)
     ON CONFLICT(email) DO NOTHING;
   SELECT id FROM users WHERE email = ?;
   ```
   即"先 upsert 再 re-select"，两步在同一事务里执行。理由：首登浏览器会并发打多个 `/api/*` 请求，纯 SELECT-then-INSERT 会在 `users.email UNIQUE` 上撞车造成偶发 500。`scripts/migrations/001-init.sql:6` 已建 UNIQUE，按上面写法天然幂等。落库行：`id = crypto.randomUUID()`、`email = accessEmail`、`name = accessEmail` 占位
3. **api_tokens 同时绑两列**：`api_tokens` 新表使用 `user_id`（FK → `users.id`）作为主关联列，`email` 作为冗余便于运维查询；与 surety 仅存 email 的形态不同（pika 已有 userId 不能丢）
4. **packages/api 的认证变量保持 `userId`**：web-worker → api 透传的 header 改为 `X-Pika-User-Id: <userId>`（不是 email）+ `X-Pika-User-Email: <email>`（仅审计用）；packages/api 的 middleware 新增"信任 service binding 透传的 X-Pika-User-Id"分支，写入 `c.set("userId", ...)`
5. **CLI Bearer 不直连 packages/api**：CLI 始终打 `pika.hexly.ai`，Bearer 校验**只**发生在 web-worker；packages/api 不公开、不接 Bearer / cookie，仅信任 service binding 透传的 `X-Pika-User-Id`。`api_tokens` 表的读权限因此归 web-worker，packages/api 不再绑该表。下文 §Bearer 链路重写 / §安全边界 详解
6. **schema 迁移**：新建 `api_tokens(id INTEGER PK, user_id TEXT NOT NULL REFERENCES users(id), email TEXT NOT NULL, token_prefix TEXT, hashed TEXT NOT NULL, name TEXT, created_at TEXT, last_used_at TEXT, expires_at TEXT)`；旧 `users.api_key` 列保留只读（不再写），P6 清理时再删
7. **遗留 NextAuth 行的命运**：原 NextAuth 用户的 `users.id` 是 OAuth-account 创建时生成的；这些 id 继续被 packages/api / packages/worker 引用，因此 P1 起就要把 access-auth 的 email-to-userId 查询接到 **同一张** `users` 表，新老 user 共存于同一主键空间

## Bearer 链路重写（修订 P3 旧表述）

文档前一版"保留现有 Bearer 分支不变"是错的。当前 `packages/api/src/middleware/auth.ts:75 resolveBearerUser()` 调用旧 `packages/worker /auth/me`；旧 worker 又查 `users.api_key`（`packages/worker/src/auth.ts:66`）。两者都属于 NextAuth 时代的链路，都要随 P1 一起退场。

**单入口模型**：CLI 继续打 `pika.hexly.ai/api/...`，由 web-worker 校验 Bearer + 转发；packages/api 不暴露公网。这与现有 CLI base URL 契约（`packages/cli/src/config/manager.ts:5` + `packages/cli/src/api/client.ts:220` 在 `pika.hexly.ai` 后拼 `/api`）零冲突，CLI 不需要任何修改。

```
CLI ── Authorization: Bearer pk_xxx ──▶ pika.hexly.ai/api/...
                                          │
                                          │ web-worker:
                                          │   access-auth (CF Access JWT)        ─┐ 命中任一即放行
                                          │   api-key-auth (Bearer pk_*)         ─┘
                                          │     hash → SELECT user_id, email
                                          │              FROM api_tokens
                                          │              WHERE hashed = ?
                                          │     UPDATE last_used_at（async）
                                          │   resolveUserId (email → users.id)
                                          ▼
                                       service binding API.fetch(req)
                                       注入 X-Pika-User-Id / X-Pika-User-Email
                                          │
                                          ▼
                                       packages/api（仅 service binding 入口，
                                                     不绑公网 route）
                                       middleware: 信任 header 直接 set userId
```

落地步骤（拆进 P1 / P3）：
1. P1：`api_tokens` 表 + repo 写在 `packages/core/infra/api-tokens.ts`（runtime-agnostic），先供 web-worker 使用
2. P1：web-worker 接管 `/api/auth/tokens(*)`（生成 / 列出 / 撤销）和 `/api/auth/cli`（CLI loopback callback，见 §CLI 协议）
3. P1：web-worker `api-key-auth` middleware 落地（hash + 查 `api_tokens` + 更新 `last_used_at`），与 surety 行为一致
4. P3：packages/api 删除现有 `resolveBearerUser` + cookie decode 全部分支；middleware 只剩 "信任 service binding 透传的 X-Pika-User-Id"（见 §安全边界）。**不**对外提供 Bearer 校验
5. P6：删除 `packages/worker/src/auth.ts` 中 `pk_*` 校验分支与 `/auth/me` 路由（worker 继续承接 sessions/search/stats/projects/tags/content + ingest 数据面，仅卸掉 auth 相关入口）

```
                    Cloudflare Access (团队 SSO)
                          │  注入 Cf-Access-Jwt-Assertion
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  packages/web-worker (Cloudflare Worker)                     │
│                                                              │
│  wrangler.toml:                                              │
│    [assets] directory=./dist  binding=ASSETS                 │
│             run_worker_first=["/api/*"]                      │
│             not_found_handling="single-page-application"     │
│                                                              │
│  src/index.ts (Hono):                                        │
│    middleware: access-auth → api-key-auth → resolveUserId    │
│    /api/live              → 200                             │
│    /api/me                → { email, userId }                │
│    /api/auth/tokens(*)    → CLI token CRUD（D1 api_tokens）  │
│    /api/auth/cli          → CLI loopback mint（见 §CLI 协议）│
│    /api/*                 → API.fetch (service binding 透传) │
│                              带 X-Pika-User-Id / -Email      │
│    其他                   → ASSETS.fetch()  (SPA)            │
│                                                              │
│  bindings: DB(D1, 读 users + api_tokens),                    │
│            API(service binding → packages/api),              │
│  vars: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD                  │
└──────────────┬──────────────────────────────────────────────┘
               │ service binding（无公网；带 X-Pika-User-Id）
               ▼
┌─────────────────────────────────────────────────────────────┐
│  packages/api (独立 Cloudflare Worker)                       │
│  Hono auth/facade 层（根挂载，与 web_legacy strip-/api 契约一致）│
│  当前 handler 多为 workerGetHandler/workerPostHandler 包装    │
│  独立 wrangler 部署 + 独立测试                                │
│  认证：仅信任 X-Pika-User-Id（service binding 唯一入口）      │
│       不公开域名，不接 Bearer / cookie                        │
└──────────────┬──────────────────────────────────────────────┘
               │ 内部 HTTP (WORKER_URL + WORKER_SECRET)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  packages/worker (独立 Cloudflare Worker)                    │
│  D1 / R2 数据面：sessions CRUD、search、stats、projects、     │
│                  tags、content 上传/下载、ingest             │
└─────────────────────────────────────────────────────────────┘
```

要点：
- 浏览器只看到 `pika.hexly.ai` 一个 origin
- **packages/api 不暴露公网域名**：wrangler 不绑 `routes`，仅作为 web-worker 的 service binding 目标存在。这样 packages/api 全部入口都来自 web-worker，`X-Pika-User-Id` 天然可信
- **CLI 继续打 `pika.hexly.ai`（单入口）**：CLI 现行 `createPikaClient()` 在 `pika.hexly.ai` 后拼 `/api`，本次重写**不动 CLI 的 base URL 契约**。Bearer `pk_*` 由 web-worker 的 `api-key-auth` 校验，命中后 web-worker 把请求经 service binding 透传给 packages/api，注入 `X-Pika-User-Id` / `X-Pika-User-Email`
- 旧 `packages/worker` 的 `/auth/me` + `pk_*` 分支在 P6 一并删除

## 安全边界（service binding 信任分支）

`X-Pika-User-Id` 只能来自 web-worker，packages/api **必须**用单一、不可伪造的机制识别这一来源。文档前一版写的"`c.req.raw.cf` 缺失等等价方式"过松——本机 / 测试 / 直连都会让该字段缺失，不能进鉴权设计。

收敛为：

- **唯一信任机制**：packages/api 的 wrangler 配置**不绑任何 `routes` / 公网 custom domain**。它仅作为 `[[services]] binding=API` 的目标存在，所有入站流量都必然来自 web-worker（CF 平台保证）
- **不依赖 `cf` 字段、不依赖 host 头、不依赖共享 secret**：service binding 拓扑本身就是认证。哥/CF docs 都把 service binding 描述为"内部不可路由出公网"
- **packages/api middleware 只做一件事**：`X-Pika-User-Id` 存在 → set `userId`；不存在 → 401。不再有 Bearer / cookie 分支
- **公网 Bearer 校验单点在 web-worker**：`api-key-auth` middleware 直查 D1 `api_tokens`，命中后才允许进入透传逻辑
- **dev 环境**：本地 `wrangler dev --local --service-binding API=pika-api` 同样把 packages/api 暴露在 service binding 后面；本机直连 packages/api dev server 仍然支持，但额外要求 `E2E_SKIP_AUTH=true && ENVIRONMENT !== "production"`，避免无意把 dev binding 当公网用
- **回滚预案**：若哥后续决定把 packages/api 暴露公网（如压测 / 运维需要），必须改为：(a) 公开域名 + Bearer 直查 `api_tokens`；(b) 删除 service binding 信任分支。**两者不共存**



## 路径契约（修订）

当前 `packages/api/src/app.ts:28-`：route 直接挂在根（`/search`、`/stats`、`/sessions`、`/projects`、`/tags`、`/ingest`、`/live`），**没有** `/api` 前缀。docs/16 的 web forwarder 在 `packages/web/src/lib/api-forward.ts:38-47` 主动 strip 入口请求的 `/api` 前缀再转发，所以 packages/api 自己不挂 `/api`。

**单入口模型下的契约**：CLI 与浏览器都打 `pika.hexly.ai/api/...` → web-worker 收到 → 经 service binding `API.fetch(req)` 透传给 packages/api。

是否给 packages/api 加 `/api` 前缀？分两个阶段处理，**避免在过渡期打断 web_legacy**：

### 阶段 1（P1–P5）：packages/api **保留**根挂载

- 不改 packages/api 路径：`/search`、`/stats`、…、`/live` 维持现状
- web-worker 的 proxy 在透传前 strip `/api` 前缀，与 web_legacy `api-forward.ts:38` 行为一致
- web_legacy forwarder 继续工作，不动
- 单测、`wrangler dev` 直连入口仍打 `/search` 等根路径

### 阶段 2（P6 web_legacy 删除时一次性切换）

- 同一 commit：删 web_legacy forwarder + packages/api 加 `/api` 前缀（`app.route("/api/search", ...)`、`/api/live`）+ web-worker proxy 去掉 strip
- 单测同步改 path
- 仅有一个切换点，不会打断任何过渡期形态

**为什么不一次性搬完前缀**：哥已把 web_legacy 保留到验证后删除。过渡期 web_legacy → packages/api 的契约是"strip /api"，若 P3 立即切前缀，web_legacy 转发后变成 `/search`（被 strip 掉了）→ packages/api 期望 `/api/search` → 404。要么改 web_legacy（违反"不动"原则）、要么推迟 packages/api 切换。本文选后者。

**备选 A（已否决）**：packages/api 永远根挂载。代价：与 surety 习惯不一致；若哥后续撤销 §安全边界 决定把 packages/api 暴露公网，路径会少一截，调试不直观

**备选 B（已否决）**：P3 立即切前缀 + 同步改 web_legacy forwarder。代价：违反"web_legacy 冻结"原则，过渡期单测要改两遍

## 静态产物目录约定（修订）

文档前一版三处写法（架构图 `../web/dist`、包结构 `../web-worker/dist`、wrangler 示例 `./dist`）冲突。**统一约定**：

- vite 写：`packages/web/vite.config.ts` 的 `build.outDir` = `../web-worker/dist`（项目根相对 `packages/web-worker/dist`）
- wrangler 读：`packages/web-worker/wrangler.toml` 的 `[assets] directory = "./dist"`（wrangler.toml 同目录的 `dist/`，与 vite 写入位置一致）
- 架构图脚注：以"web-worker 视角"写 `directory=./dist`，已修订
- `.gitignore`：`packages/web-worker/dist/` 入忽略（构建产物，不入仓）
- CI：`bun run --cwd packages/web build && bun run --cwd packages/web-worker deploy` 顺序保证 wrangler 读到最新静态资产

## 包结构

```
packages/
├── core/             不动（infra/* 已就绪，cookie helper 后续可清理）
├── api/              不动（Hono auth/facade 层，独立 CF Worker 部署 + 独立测试；handler 多为对 packages/worker 的 proxy 包装）
├── worker/           不动（D1/R2 数据面 worker：sessions/search/stats/projects/tags/content + ingest）
├── cli/              小改：登录从 OAuth 流程换成"页面生成 token"流程
├── web_legacy/       由现 web 改名而来；冻结，验证 vite 版无误后删除
├── web/              全新 Vite SPA
└── web-worker/       全新 CF Worker（assets + access-auth + /api 转发）

packages/web/        （前端，对齐 surety apps/web）
├── package.json              vite + react 19 + react-router v7 + tailwind v4
├── vite.config.ts            build.outDir = ../web-worker/dist （静态资产单点写）
│                             dev proxy /api → http://localhost:7025 (web-worker)
├── index.html
├── tsconfig.json             extends 根 base，paths @/*、@pika/api types
├── public/                   favicon、og 等
├── src/
│   ├── main.tsx              createRoot + BrowserRouter
│   ├── App.tsx               lazy 路由 (dashboard/login/sessions/...)
│   ├── globals.css           从 web_legacy 搬，3 层亮度变量保持
│   ├── api.ts                fetch wrapper，统一相对路径 /api/*
│   ├── lib/                  format / palette / 等纯前端 helper
│   ├── components/           UI（shadcn 全套搬）
│   ├── hooks/                use* (含 SWR)
│   └── app/                  按页面组织（dashboard/login/sessions/...）

packages/web-worker/  （Worker，对齐 surety apps/worker）
├── wrangler.toml             [assets] directory=./dist
│                             [[services]] binding=API name=pika-api
│                             vars CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD
├── src/index.ts              Hono root
├── src/middleware/
│   ├── access-auth.ts        JWT verify (jose + JWKS)
│   ├── api-key-auth.ts       Bearer pk_* (查 D1 api_tokens)
│   └── is-localhost.ts       dev/E2E bypass
├── src/routes/
│   ├── live.ts               /api/live
│   ├── me.ts                 /api/me  → { email }
│   ├── auth-tokens.ts        /api/auth/tokens(*) CLI token CRUD
│   └── proxy.ts              /api/* 透传到 API service binding
└── src/lib/
    └── env.ts                AppEnv 类型
```

## 迁移分阶段（atomic commits）

> 每个 commit 必须独立：可单独 build 通过、可单独回滚、不引入半成品状态。commit message 用 `type(scope): subject (P{n}.{m})` 模板。每条勾选框作为执行 todo。

### P0. 冻结 + 脚手架

- [x] **P0.1** `chore(web): rename packages/web → packages/web_legacy + freeze (P0.1)`
  - `git mv packages/web packages/web_legacy`
  - `packages/web_legacy/package.json`：`name` → `@pika/web-legacy`，加 `"private": true`
  - `packages/web_legacy/CLAUDE.md` 写一行：**FROZEN — see docs/17**
  - 根 `tsconfig.json` references 的 `packages/web` 改为 `packages/web_legacy`
  - 根 `package.json` scripts：现有 `dev:web` / `build:web` / `lint:web` 等加 `legacy:` 前缀；根 `dev` / `build` 暂改成只跑 api/worker（不挂 legacy）
  - 验收：`bun install` 通过；`bun run --cwd packages/web_legacy build` 仍绿；`bun run lint` 全包绿

- [x] **P0.2** `feat(web): scaffold vite spa skeleton (P0.2)`
  - 新建 `packages/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx}`
  - 依赖：`vite`、`@vitejs/plugin-react`、`@tailwindcss/vite`、`react@19`、`react-dom@19`、`react-router@7`、`swr`、`tailwindcss@4`、`tw-animate-css`
  - `vite.config.ts`：`build.outDir = "../web-worker/dist"`、`emptyOutDir = true`、`server.port = 7024`、`server.proxy["/api"] = "http://127.0.0.1:7025"`
  - `src/App.tsx`：`<BrowserRouter>` + 单一路由 `/` → `<h1>Hello pika</h1>`
  - 验收：`bun run --cwd packages/web build` 产出 `packages/web-worker/dist/index.html`；`bun run --cwd packages/web dev` 起在 7024

- [x] **P0.3** `feat(web-worker): scaffold worker with assets + /api/live (P0.3)`
  - 新建 `packages/web-worker/{package.json,tsconfig.json,wrangler.toml,src/index.ts}`
  - 依赖：`hono`、`wrangler`（dev）
  - `wrangler.toml`：见 §端口与部署 wrangler 片段（先放最小集：`[assets] directory=./dist`、`run_worker_first=["/api/*"]`、`not_found_handling="single-page-application"`、占位 `routes`）
  - `src/index.ts`：Hono 挂 `/api/live` → `c.json({ ok: true })`，其余路径不处理（落到 `[assets]` SPA fallback）
  - **暂不**接 access-auth / api-key-auth / service binding
  - 验收：`bun run --cwd packages/web build && bun run --cwd packages/web-worker dev`（wrangler :7025）→ 浏览器看到 hello、`/api/live` 返回 `{ok:true}`

- [x] **P0.4** `chore(root): wire web + web-worker into root scripts (P0.4)`
  - 根 `package.json` 加 `web:dev` / `web:build` / `web-worker:dev` / `web-worker:deploy` 别名
  - `dev:all`（已有）追加 web 与 web-worker 启动
  - CI（`.github/workflows/*`）保持不动，下个 phase 再切
  - 验收：`bun run dev:all` 同时起 web/web-worker/api；`bun run build` 包含 web build → web-worker dist

### P1. CF Access 中间件 + 身份模型

- [x] **P1.1** `feat(core): add api_tokens schema + repo (P1.1)`
  - `scripts/migrations/00X-api-tokens.sql`：建表 `api_tokens(id INTEGER PK AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), email TEXT NOT NULL, token_prefix TEXT, hashed TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT)` + indexes
  - `packages/core/infra/api-tokens.ts`：runtime-agnostic repo（`createApiToken` / `findByHashed` / `listByUser` / `revoke` / `updateLastUsed`）
  - `packages/core/index.ts` 加 barrel 导出
  - L1 测试：repo 用 `bun:sqlite` migration 跑过
  - 验收：`bun test packages/core` 全绿；schema migration 在本地 D1 执行成功

- [x] **P1.2** `feat(web-worker): cf access + api-key-auth middleware (P1.2)`
  - `src/middleware/{access-auth,api-key-auth,is-localhost}.ts` 照搬 surety 三件套；access-auth 用 `jose.createRemoteJWKSet` + 本 doc 的 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`
  - api-key-auth 走 `packages/core/infra/api-tokens` repo（hash 比对 + `updateLastUsed`）
  - is-localhost：dev/E2E 旁路。**不**默认注入 `dev@local`（避免污染老 userId 分区），改为：读 `DEV_USER_EMAIL` env 或 `X-Dev-User-Email` header；缺省时返回 401 并在 console 打印提示。详见 §认证模型 → 本机 dev 身份方案
  - middleware chain：`isLocalhost ?? accessAuth ?? apiKeyAuth ?? 401`
  - L1 测试：三件套各 1 个 happy + 1 个 401
  - 验收：`bun test packages/web-worker` 全绿；`wrangler dev` 本机 `isLocalhost` 命中

- [x] **P1.3** `feat(web-worker): /api/me + email→userId idempotent upsert (P1.3)`
  - `src/lib/resolve-user.ts`：`accessEmail` → `users` 表幂等 upsert（`INSERT ... ON CONFLICT(email) DO NOTHING; SELECT id ...`，见 §身份模型 #2）
  - `src/routes/me.ts`：`GET /api/me` → `{ email, userId }`
  - middleware 末端 `c.set("userId", ...)` + `c.set("email", ...)`
  - L1 测试：并发 10 次同 email 仅落 1 行 `users`
  - 验收：浏览器登录后 `curl /api/me` 返回 `{ email, userId }`

- [x] **P1.4** `feat(web-worker): /api/auth/tokens crud (P1.4)`
  - `src/routes/auth-tokens.ts`：`GET/POST/DELETE /api/auth/tokens(/:id)` 调 `api-tokens` repo；POST 返回明文 `pk_xxx` 一次（hash 后入库）
  - L1 测试：CRUD + hash 不可逆
  - 验收：手工 `curl -X POST /api/auth/tokens` 拿到 `pk_xxx`，再 `Authorization: Bearer pk_xxx` 打 `/api/me` 通过

- [x] **P1.5** `feat(web-worker): /api/auth/cli loopback callback (P1.5)`
  - `src/routes/auth-cli.ts` 照搬 surety；`callback_url` 校验仅放行 `http://127.0.0.1:*` / `http://localhost:*`；mint 后 302
  - L1 测试：非 loopback callback → 400；state 校验
  - 验收：本机起 `nc -l PORT` + 浏览器打 URL，loopback 收到 `?api_key=pk_xxx&state=...`

### P2. SPA 路由 + 共享样式

- [x] **P2.1** `feat(web): port globals.css + tailwind v4 + shadcn primitives (P2.1)`
  - 拷贝 `web_legacy/src/{globals.css,components.json,components/ui/*}` → `packages/web/src/`
  - 拷贝 `lib/{format,palette,calendar-helpers,navigation,utils}.ts`、`hooks/*`
  - 验证 3 层亮度变量（L0/L1/L2）保留
  - L1 测试：`utils.cn()` snapshot

- [x] **P2.2** `feat(web): api fetch wrapper + useMe + RequireAuth (P2.2)`
  - `src/lib/api.ts`：`apiFetch` / `apiJson` / `swrFetcher` / `ApiError`，相对 `/api/*`，`credentials: include`，401 → `window.location.reload()`（CF Access 接管）
  - `src/hooks/use-me.ts`：SWR 拉 `/api/me`
  - `src/components/auth/RequireAuth.tsx`：未登录显示 loading + 触发刷新
  - L1 测试：`useMe` loading/error/ok 三态

- [x] **P2.3** `feat(web): app shell + sidebar + theme toggle (P2.3)`
  - 拷贝 `components/layout/{app-shell,sidebar,sidebar-context,breadcrumbs,theme-toggle}` 并去 `"use client"`、`next/link` → `react-router Link`、`next/navigation` → `useNavigate`
  - sidebar 用 `useMe()` 渲染邮箱；登出按钮 `<a href="https://nocoo.cloudflareaccess.com/cdn-cgi/access/logout">`
  - 路由占位：`/`、`/login`（删除）、`/dashboard` 全打 placeholder
  - 验收：browser 进入 → 看到 shell + sidebar + theme toggle

### P3. /api 转发到 packages/api（鉴权 + 部署，不动 handler）

> 范围澄清：本阶段**不**重构 packages/api 的业务 handler。`packages/api/src/routes/{stats,sessions,search,projects,tags}.ts` 当前是 `workerGetHandler/workerPostHandler` 对 `packages/worker` 的包装，本 doc 维持现状。读侧/查询侧从 worker 迁到 api 是后续独立 doc 的事。

- [x] **P3.1** `feat(api): wrangler.toml without public routes (P3.1)`
  - `packages/api/wrangler.toml` 见 §端口与部署 片段：**不绑** `routes` / `custom_domain`，仅作为 service binding 目标
  - `[env.test]` 同样不绑（顶层无 routes，无继承风险）
  - dev：`wrangler dev --port 7023`
  - 验收：`wrangler dev` 起得来

- [x] **P3.2** `refactor(api): replace auth middleware with X-Pika-User-Id only (P3.2)`
  - 删 `packages/api/src/middleware/auth.ts` 的 `resolveBearerUser` / cookie decode 分支
  - 新 middleware：`X-Pika-User-Id` 存在 → `c.set("userId", ...)`；E2E 旁路：`E2E_SKIP_AUTH=true && ENVIRONMENT !== "production"` → `X-E2E-User`；否则 401
  - 删 `packages/api` 对 `@auth/core` 的依赖（如还有）
  - L1 测试：四态（header 存在/缺失/E2E 旁路/prod 强制）
  - 验收：`bun test packages/api` 全绿

- [x] **P3.3** `feat(web-worker): /api/* proxy via service binding (P3.3)`
  - `wrangler.toml` 加 `[[services]] binding=API service=pika-api`
  - `src/routes/proxy.ts`：匹配 `/api/*` 中**非内置**路径（live/me/auth/tokens/auth/cli 留 web-worker）
  - strip `/api` 前缀（与 web_legacy `api-forward.ts:38` 一致）
  - 注入 `X-Pika-User-Id` + `X-Pika-User-Email`
  - `c.env.API.fetch(rewrittenReq)` 透传，body 用 `duplex: "half"` 流式
  - L1 测试：透传 + header 注入 + 路径 strip
  - 验收：`wrangler dev --local --service-binding API=pika-api` 联调；`curl /api/stats` 同时打通 web-worker → api

- [x] **P3.4** `chore(web_legacy): point api-forward at packages/api wrangler dev (P3.4)`
  - `packages/web_legacy` 的 `API_INTERNAL_URL` 改指 `http://localhost:7023`（packages/api wrangler dev port）
  - 验证：web_legacy 与 web-worker 同时打 packages/api 都返回相同结果
  - 验收：legacy L2 e2e 全绿

### P4. 域级数据流逐个搬

> 每域一个 commit；UI 复刻 web_legacy 同页，验收维度：组件单测 + Playwright spec 拷贝 + 视觉对照（3 层亮度 / 色板 / 排版无回归）。

- [x] **P4.1** `feat(web): dashboard overview page (P4.1)`
- [x] **P4.2** `feat(web): sessions list + filters (P4.2)`
- [x] **P4.3** `feat(web): session detail with content/star/tags/trash (P4.3)`
- [x] **P4.4** `feat(web): search page (P4.4)`
- [x] **P4.5** `feat(web): tags management (P4.5)`
- [x] **P4.6** `feat(web): projects + activity (P4.6)`
- [x] **P4.7** `feat(web): cli token management page (P4.7)`（复刻 surety `apps/web/src/app/cli/page.tsx`，仅承担列出/撤销，不承担登录）

### P5. CLI 闭环

- [x] **P5.1** `chore(cli): verify apiBaseUrl points at pika.hexly.ai (P5.1)`
  - 验证 `packages/cli/src/config/manager.ts` 默认 base URL 已是 `pika.hexly.ai`（CLI 单入口契约，无需改动）
  - `login-flow.test.ts` 仅切测试 base URL，用例不动

- [x] **P5.2** `chore(web_legacy): drop worker-cli-auth-db (P5.2)`
  - 在 P0 重命名后这些文件已在 `packages/web_legacy/src/lib/{worker-cli-auth-db,cli-auth,auth-adapter}.ts`（原 `packages/web/src/lib/`）
  - 本步骤只是确认 `packages/cli` 端**不**再调用这些代码（这些是 web 服务端 mint 路径，CLI 侧从不直接 import 它们）
  - 实际删除发生在 P6.3 的 `git rm -r packages/web_legacy`；此 commit 只做"CLI 包对 worker-cli-auth-db 调用面"的核对（应为零调用）
  - 验收：`grep -r "worker-cli-auth-db\|cli-auth-db" packages/cli/` 为空；`pika login` → `pika sync` → `pika sessions list` 端到端跑通（dev 环境打 web-worker）

### P6. 路径切换 + 删除 web_legacy + 部署

> 顺序原则：**先把代码切到终态（P6.1–P6.3），然后 test 部署验证（P6.4），最后 prod 切流（P6.5）**。这样上线的就是终态代码，不存在"deploy 出去的不是最终代码、之后又没补一次 deploy"的脱节。

- [x] **P6.1** `feat(api,web-worker): switch /api prefix in single atomic commit (P6.1)`
  - packages/api routes 全部加 `/api` 前缀（`/search` → `/api/search`，`/live` → `/api/live`，等）
  - 同步改 packages/api 单测 path
  - 删 web-worker `proxy.ts` 中 strip `/api` 逻辑
  - 见 §路径契约 阶段 2
  - 此 commit 与 web_legacy 不再兼容（web_legacy 仍 strip /api），所以必须紧跟 P6.2 删除

- [x] **P6.2** `chore: remove packages/web_legacy + caddy + dev-all legacy parts (P6.2)`
  - `git rm -r packages/web_legacy`
  - 删 Caddy 配置中 web 部分
  - `scripts/dev-all.ts` 删 web_legacy 启动
  - 根 `package.json` 删 `legacy:*` scripts、`overrides.next`、`next-auth` / `@auth/core` 依赖

- [x] **P6.3** `feat(worker): drop /auth/me + /auth/cli-key + pk_* legacy branches (P6.3)`
  - `packages/worker/src/auth.ts` 删 `pk_*` 校验
  - `packages/worker/src/index.ts` 删 `/auth/me` 路由（line ~847）+ `/auth/cli-key` 路由（line ~1048，旧 web_legacy 内部 mint 入口；P1 之后 token mint 已转到 web-worker `/api/auth/tokens` 与 `/api/auth/cli`）
  - 验收：`grep -rn "/auth/me\|/auth/cli-key" packages/worker/src` 为空
  - worker 仅保留 D1/R2 数据面入口（sessions/search/stats/projects/tags/content + ingest）

- [ ] **P6.4** `chore(deploy): test env validation (P6.4)`（operator）
  - `wrangler deploy --env=test`（packages/worker，先于下游）
  - `wrangler deploy --env=test`（packages/api，不绑 routes）
  - `wrangler deploy --env=test`（packages/web-worker，注意 `[env.test] routes = []`）
  - 验证：test 域名走 CF Access SSO、`/api/me`、`/api/auth/tokens`、CLI loopback、几个核心页面、ingest 通路
  - 失败回滚：本 commit 仅是部署动作，回滚等于 `wrangler rollback` 上一个 test 版本；代码不动

- [ ] **P6.5** `chore(deploy): prod cutover (P6.5)`（operator）
  - `wrangler deploy`（packages/worker → prod）
  - `wrangler deploy`（packages/api → prod，不绑 routes）
  - `wrangler deploy`（packages/web-worker → prod，绑 `pika.hexly.ai`）
  - 不灰度（哥定）：直接切 DNS / 域名绑定到新 Worker
  - 验证：核心页面 + CLI 端到端 OK
  - 失败回滚：`wrangler rollback` 三个 worker 上一个 prod 版本（旧版本里 packages/api 还是根挂载、web-worker 仍 strip /api、packages/worker 仍带 /auth/me + /auth/cli-key + pk_*，三者互相兼容）

- [ ] **P6.6** `docs: archive next/nextauth in 05-dashboard + cross-link 16/17 (P6.6)`
  - `docs/05-dashboard.md` 把 Next.js / NextAuth 内容归档到本 doc 的"历史形态"附录
  - `docs/16` 加 trailer 指向本 doc 终态


## 拓扑权衡（vs 参考项目）

`../surety` / `../backy` / `../dove` 都是**单 CF Worker** 形态：一个 worker 同时托管 `[assets]` 静态资产 + Hono `/api/*` + CF Access 校验 + D1/R2 binding。pika 17 选择**三 worker**（`packages/web-worker` → service binding → `packages/api` → 内部 HTTP → `packages/worker`）。差异不是无意识的，记录在此免得后人按"为什么不照抄 surety"重开问题。

| 项 | 参考（单 worker） | pika 17（三 worker） | 取舍 |
|---|---|---|---|
| 部署单元 | 1 | 3 | pika 多两个 wrangler / CI job |
| Worker 间通信 | 进程内调用 | service binding（web-worker → api）+ HTTP+secret（api → worker） | 多两跳；service binding 不算公网，HTTP 已是现状 |
| 测试边界 | 单 vitest / wrangler | `packages/api`、`packages/worker` 各自独立 vitest + L2 e2e | pika 现状已分割，重做单 worker 等于扔掉 docs/16 的成果 |
| handler 搬迁量 | n/a（绿地）或 backy Wave B 全搬 | **0**：packages/api 维持 worker-proxy facade，packages/worker 留 D1/R2 真实读写 | 节省一整个 wave |

**为什么不合并**：
- `packages/worker` 已是独立部署的 D1/R2 写端（ingest）+ 读端（sessions/search/stats/...），重写成"被 web-worker import 的 module"等于推翻 docs/11（Unified Worker API）落地成果
- `packages/api` 在 docs/16 已抽成独立 Hono + 独立测试，合并回 web-worker 会丢测试边界
- backy 的 Wave B / B' 之所以做 RuntimeContext + 流式重写，是因为它**没有**等价的 packages/worker；pika 这条链路天然是分的，不需要重新抽

**代价**：
- 三层链路调试比单 worker 难（service binding 故障要分两段查）
- wrangler.toml × 3，CF Access 配置 × 1（仅 web-worker）
- 长期看，packages/api 是 "auth + facade" 的薄层，未来若想合并仍可（参考 dove 的最终形态），但**不在本 doc 范围**

## 端口与部署

| 服务 | dev | prod |
|---|---|---|
| `web`（vite build only） | 不起 server，build 产物给 web-worker | 由 web-worker 静态托管 |
| `web-worker`（wrangler） | 7025 | Cloudflare Workers (`pika.hexly.ai`) |
| `api`（hono on workers） | 7023 | 独立 Cloudflare Worker（`pika-api`，仅 service binding，不绑公网域名） |
| `worker`（D1/R2 数据面） | wrangler | Cloudflare Workers（独立） |
| `web_legacy` | — | 不部署（验证后删除） |

dev 形态（照搬 surety）：
- 单进程 `wrangler dev`（web-worker），`vite build --watch` 写入 `packages/web-worker/dist`，`[assets]` 直接读
  - 或 `vite dev` 7024 + `vite.config.ts proxy /api → http://localhost:7025`（surety 现行方案）
- `packages/api` 走 `wrangler dev` 起在另一个端口（7023），`packages/web-worker` 用本地 service binding（`wrangler dev --local --service-binding API=pika-api`）连接
- Caddy（dev only）把 `pika.dev.hexly.ai` 反代到 `wrangler :7025`，与现有 hexly.ai 域名习惯一致；CF Access 在 dev 环境通过 `isLocalhost` 旁路

### wrangler.toml 关键配置（参照 backy）

`packages/web-worker/wrangler.toml`：

```toml
name = "pika-web"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

routes = [
  { pattern = "pika.hexly.ai", custom_domain = true },
]

[vars]
ENVIRONMENT = "production"
CF_ACCESS_TEAM_DOMAIN = "nocoo.cloudflareaccess.com"
CF_ACCESS_AUD = "fbbaaf21dcbbae0d677207bd16798d64458336069f105669a55d449362e08862"

[assets]
directory = "./dist"            # vite build outDir 单点（见 §静态产物目录约定）
binding = "ASSETS"
run_worker_first = ["/api/*"]
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"                  # web-worker 仅读 users + api_tokens
database_name = "pika-db"
database_id = "<prod>"

[[services]]
binding = "API"
service = "pika-api"            # service binding → packages/api，不走公网

[env.test]
name = "pika-web-test"
routes = []                      # ⚠️ 必填：[env.test] 默认继承顶层 routes，会把 pika.hexly.ai 抢走（backy 踩过坑）
[env.test.vars]
ENVIRONMENT = "test"
E2E_SKIP_AUTH = "true"
CF_ACCESS_TEAM_DOMAIN = "nocoo.cloudflareaccess.com"
CF_ACCESS_AUD = "fbbaaf21dcbbae0d677207bd16798d64458336069f105669a55d449362e08862"
[env.test.assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = ["/api/*"]
not_found_handling = "single-page-application"
[[env.test.d1_databases]]
binding = "DB"
database_name = "pika-db-test"
database_id = "<test>"
[[env.test.services]]
binding = "API"
service = "pika-api-test"
```

`packages/api/wrangler.toml`：

```toml
name = "pika-api"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

# 关键：不绑 routes / 不绑 custom_domain。仅作为 web-worker 的 service binding 目标存在。
# 见 §安全边界——这是 X-Pika-User-Id 信任的唯一根。

[vars]
ENVIRONMENT = "production"
WORKER_URL = "https://pika-worker.<account>.workers.dev"  # 内部 HTTP，不暴露给浏览器
# WORKER_SECRET 走 `wrangler secret put`

[env.test]
name = "pika-api-test"
# routes 字段省略；顶层也没有 routes，无继承风险

[env.test.vars]
ENVIRONMENT = "test"
E2E_SKIP_AUTH = "true"
WORKER_URL = "https://pika-worker-test.<account>.workers.dev"
```

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| CF Access 配置错（aud / team domain）导致全员 401 | P1 末尾验证；保留 wrangler env override，必要时关掉 access-auth 应急 |
| `packages/api` 改成 CF Worker 部署后 Bun-only API 不兼容（如 `bun:sqlite`、`Bun.serve`） | api 业务层本身已 runtime-agnostic（docs/16 P2），仅入口需要重写 wrangler；若真不通，**回滚到上一个 commit**（继续 docs/16 终态：Railway 部署 packages/api + web_legacy 转发），不引入"web-worker 公网 fetch + 共享 secret"分支——那会破坏 §安全边界（service-binding-only 信任根）。即风险只在"P1–P5 推进到一半"时回退到既有架构，不为它新增第二套安全模型 |
| Worker CPU 50ms 限制 | 关键路径基准；超限的批量操作走 Workflows / Queue，非 P0 |
| react-router v7 与 Next 语义差异 | P2 一开始把 layout/AppShell 跑通 |
| CLI 流程回归 | P5 完整 e2e；保留 web_legacy 作为对照 |
| 直接切流无灰度，故障面大 | 哥已定不灰度；以 P4-P5 完整 e2e 验收作为兜底，发现问题立即回滚 DNS |
| D1 schema 变更（新增 `api_tokens`） | 迁移可加可不删，旧 NextAuth 表保留只读 |

## Out of Scope

- 把 `packages/worker`（D1/R2 数据面 worker）合并到 `web-worker` / `api`
- 数据库 ORM 替换 / D1 schema 重设计（`users` / `accounts` 表保留只读，后续清理）
- 移动端 PWA / SSR 重新引入
- 灰度 / 双栈并行（哥定：写完直接部署）
- 保留 `web_legacy` 长期参考（哥定：vite 版验证无误后立即删除）

## 决策（已确定）

1. **认证**：Cloudflare Access（同 surety），删 NextAuth + Google OAuth + `users`/`accounts` 表写入逻辑
2. **Worker 位置**：独立 `packages/web-worker` 子包（对齐 surety）
3. **`packages/api` 去留**：完整保留独立部署 + 独立测试（不并入 web-worker）
4. **`web_legacy` 保留时长**：vite 版部署验证无误后立即删除
5. **dev 形态**：照搬 surety —— `vite dev` + `wrangler dev` + 可选 Caddy 同源
6. **切流**：不灰度，写完直接部署到 `pika.hexly.ai`

## 修订记录

- 2026-04-26：基于 5 条契约挑战补齐 §身份模型与迁移、§Bearer 链路重写、§路径契约、§静态产物目录约定、§CLI 协议（修订 P5），并同步更新架构图与 P3。要点：
  - `accessEmail` 不能直接当 userId 用；新建 `users.email → users.id` 的查询/补齐路径，packages/api 仍以 `userId` 为认证变量
  - 旧 `packages/worker /auth/me` + `users.api_key` 分支随 P1 退场（注：本条原写"packages/api 直接持有 api_tokens 表读权限"，已被三轮修订推翻；现以三轮口径为准——api_tokens 仅归 web-worker 读取，packages/api 不接 Bearer 也不绑该表）
  - packages/api 全面挂 `/api` 前缀，与 web-worker 透传契约对齐；不做 path rewrite（注：此条已被二轮 §路径契约 推翻；现以两阶段口径为准——P1–P5 packages/api 维持根挂载、由 web-worker strip `/api`，P6 删 web_legacy 时再单 commit 切前缀）
  - 静态产物目录单点：vite build → `packages/web-worker/dist`，wrangler `[assets] directory="./dist"`
  - CLI 登录保留 loopback `/api/auth/cli` 端点（surety 同款），不改 `@nocoo/cli-base` 协议

- 2026-04-26（二轮）：基于 4 条剩余契约挑战收紧。要点：
  - **CLI 域名契约**：单入口模型，CLI 仍打 `pika.hexly.ai`（即 web-worker），由 web-worker 处理 Bearer + service binding 转发；packages/api 不绑公网域名，无 `pika-api.hexly.ai`
  - **路径契约两阶段**：P1–P5 期间 packages/api 保持根挂载（`/search`、`/live`…），web-worker 复刻 web_legacy 的 strip-`/api` 行为，避免打断 web_legacy；P6 删 web_legacy 时单 commit 同步加 `/api` 前缀 + 删 strip
  - **service binding 信任边界**：packages/api 在 wrangler 中**不绑公网路由**是唯一信任根，不再依赖 `c.req.raw.cf` 探测或共享 secret；只信任 `X-Pika-User-Id` header
  - **首登并发幂等**：email→userId 补齐改 `INSERT ... ON CONFLICT(email) DO NOTHING; SELECT id ...` 模式，消除 check-then-insert race

- 2026-04-26（三轮）：消两处自相矛盾。
  - §身份模型 #5 旧文"CLI bearer 直连 packages/api、api 持 api_tokens 读权限"删除，改为"Bearer 仅在 web-worker 校验、packages/api 不绑 api_tokens"，与 §Bearer 链路重写 / §安全边界 单入口模型一致
  - §风险与回滚 删除"web-worker 公网 fetch + 共享 secret"fallback 分支：那会同时破坏 §安全边界 的 service-binding-only 信任根。回滚口径改为"回到上一个 commit（docs/16 Railway 终态）"，不引入第二套安全模型

- 2026-04-26（四轮）：诚实化 packages/api 与 packages/worker 的职责。原文档把 packages/api 描述为"业务路由层"、把 packages/worker 收窄成"ingest"，与代码现状不符（`packages/api/src/routes/stats.ts` 全是 `workerGetHandler` 包装；真实读写仍在 `packages/worker/src/index.ts`），本 doc 也未规划这次搬迁。修正为：packages/api 在本 doc 终态仍是 auth/facade 层；packages/worker 继续承接 D1/R2 的读写数据面（sessions/search/stats/projects/tags/content + ingest），不只是 ingest。读侧迁移留给后续独立 doc。同步更新 §目标 / 架构图 / P3 范围澄清。

- 2026-04-26（五轮，对齐 ../surety / ../backy / ../dove）：补两处。
  - 新增 §拓扑权衡：解释 pika 走三 worker（web-worker + api + worker）而参考项目都是单 worker 的取舍——保留 docs/11/16 的独立部署边界、避免重写 packages/worker handler；代价是多两段 wrangler/CI 与一跳 service binding
  - §端口与部署 补 wrangler.toml 关键片段（web-worker / api 各一份），AUD/Team 用占位符并参照 backy；显式注释 `[env.test] routes = []`，避免 backy 踩过的"prod 域名被 test 抢走"坑

- 2026-04-26（六轮，原子化 todo 与执行细节）：
  - **本机 dev 身份**：原计划 `isLocalhost` 注入 `dev@local`，会被 P1.3 幂等 upsert 成空白伪用户，本机浏览器调试看不到真实数据且 dev 写操作会落到伪 userId。新增 §认证模型 → 本机 dev 身份方案，要求显式 `DEV_USER_EMAIL` env 或 `X-Dev-User-Email` header；缺省 401，不默认注入。P1.2 同步收紧
  - **P6.4 覆盖 /auth/cli-key**：原计划只删 `/auth/me` + `pk_*`，遗漏了 `packages/worker/src/index.ts:1048` 的 `/auth/cli-key` 内部 mint 入口；该路径在 P1 之后已被 web-worker `/api/auth/tokens` + `/api/auth/cli` 取代，必须一并删
  - **P5.2 路径修正**：实际遗留代码在 `packages/web_legacy/src/lib/worker-cli-auth-db.ts`（P0 重命名后），不在 `packages/cli/`。P5.2 改为"核对 CLI 侧零调用"，物理删除随 P6.3 `git rm -r packages/web_legacy` 一并发生

- 2026-04-26（七轮，P6 顺序）：原 P6 顺序"先 deploy 再切代码"导致 P6.1 部署的不是终态，P6.2/P6.4 之后又没补一次 deploy。重排为：P6.1 切 /api 前缀 → P6.2 删 web_legacy → P6.3 删 worker 旧 auth 路由（三个代码 commit）→ P6.4 test deploy 验证 → P6.5 prod 切流（两个 deploy commit）→ P6.6 文档。失败回滚口径写明：deploy 步骤 `wrangler rollback` 上一版本即可；上一版本三 worker 互相兼容（旧 strip + 旧根挂载 + 旧 /auth/me）
