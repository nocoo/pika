# Pika 架构与部署

> 当前架构快照。其他历史设计文档已删除 — 此文是单一事实源。

---

## 1. 拓扑

整个站点是 **一个 Cloudflare Worker**。Worker 同时：
1. 通过 `[assets]` 块伺服 SPA 静态文件（`packages/web-worker/dist/`）
2. 通过 Hono 在 `/api/*` 上挂载所有业务路由

无 Railway，无独立 Next.js 进程，无 web ↔ api 之间的 service binding。

```
            Browser / CLI
                │
                ▼
   ┌────────────────────────────────────┐
   │  Cloudflare Access (人)            │
   │  └─ JWT in Cf-Access-Jwt-Assertion │
   │  Bypass policy on /api/ingest/*    │
   └────────────────┬───────────────────┘
                    ▼
   ┌────────────────────────────────────┐
   │  Worker `pika` (or `pika-test`)    │
   │                                    │
   │   [assets]  ──► dist/index.html    │
   │   /api/*    ──► Hono               │
   │                                    │
   │   Bindings:                        │
   │     DB     → D1 pika-db            │
   │     BUCKET → R2 pika               │
   │     ASSETS → SPA                   │
   └─┬───────┬──────────────────────────┘
     │       │
     ▼       ▼
   D1     R2
```

部署目标：

| 环境 | Worker | 主域名 | 兼容域名 |
|------|--------|--------|----------|
| prod | `pika` | `pika.hexly.ai` | `pika-ingest.worker.hexly.ai`（老 CLI 二进制硬编码） |
| test | `pika-test` | `pika-test.hexly.ai` | — |

`wrangler.toml` 顶层是 prod；`[env.test]` 是 test。

---

## 2. 包结构

```
packages/
├── core/         共享类型 + 校验器（无运行时依赖）
├── cli/          @nocoo/pika：解析 + 上传
├── web/          Vite + React 19 SPA（构建到 ../web-worker/dist）
└── web-worker/   单 Worker：[assets] + /api/* Hono
```

`packages/web/vite.config.ts` 的 `build.outDir = "../web-worker/dist"` —— `bun run build` 完成后 web-worker 包内同时有源代码和构建产物，`wrangler deploy` 一发即可。

---

## 3. Worker 内部

```
src/
├── index.ts             Hono 主入口
├── api/                 业务子应用
│   ├── ingest.ts        POST /sessions · POST /presign · POST /confirm-raw · PUT /content/*
│   ├── sessions.ts      sessions CRUD + content read
│   ├── projects.ts      projects 列表 / 重命名
│   ├── tags.ts          tags + session_tags
│   ├── search.ts        FTS5 搜索
│   ├── stats.ts         dashboard 统计
│   └── live.ts          health check（公开）
├── routes/
│   ├── me.ts            GET /api/me
│   ├── auth-cli.ts      pk_* 创建跳转回调
│   └── auth-tokens.ts   token 管理
├── middleware/
│   ├── access-auth.ts   验 CF Access JWT，set accessAuthenticated + accessEmail
│   ├── api-key-auth.ts  Authorization: Bearer pk_* → set userId
│   └── resolve-user.ts  accessEmail → users.id → set userId
├── lib/
│   ├── env.ts           AppEnv (Hono Bindings + Variables)
│   ├── resolve-user.ts  D1 user lookup
│   └── r2-client.ts     aws4fetch presigned URL
└── data/                D1/R2 IO 实现
```

中间件链（`/api/*`）：

```
accessAuth → apiKeyAuth → resolveUser → handler
```

- `accessAuth`：验签 CF Access JWT — **fail-closed**：env 缺失 → 500，JWT 缺失 → 401，验签失败 → 403。`/api/live` 公开。本地 dev 跳过（保留 `DEV_USER_EMAIL` 注入）。例外：`/api/ingest/*` 带 `Authorization: Bearer ...` 时直接放行给 `apiKeyAuth`，因为 CF Access 在 `/api/ingest/*` 配的是 path-level **bypass policy**，CLI 请求不会带 JWT；Bearer 短路严格限定在 `/api/ingest/*`，防止泄露的 `pk_*` 在浏览器路径上替代 CF Access。
- `apiKeyAuth`：识别 `Authorization: Bearer pk_*`，查 `api_tokens` 表，set `userId`。
- `resolveUser`：如果 `userId` 已被 apiKeyAuth set 过则跳过；否则用 `accessEmail` 查 `users` 表 set `userId`。
- 终端 401：handler 自己用 `requireAuth(c)` 判断。

---

## 4. 鉴权矩阵

| 调用方 | 路径 | 凭证 | 中间件结果 |
|-------|------|------|----------|
| 浏览器 | `/api/*`（除 ingest） | CF Access JWT cookie | accessAuth ✓ → resolveUser ✓ |
| CLI | `/api/ingest/*` | `Authorization: Bearer pk_*` | CF Access **bypass policy** ✓ → apiKeyAuth ✓ |
| 任何 | `/api/live` | — | accessAuth 跳过 → 200 |

**关键 CF Access 配置**：`/api/ingest/*` 必须配 bypass policy，否则 CLI 拿到的是 302 HTML 登录页，`response.json()` 解析崩。Token bearer 不能让 CF Access 放行 —— bypass 是 path-level 的。

---

## 5. 数据模型

### D1 (`pika-db` / `pika-db-test`)

| 表 | 用途 |
|----|------|
| `users` | OAuth 主体（email, id） |
| `api_tokens` | `pk_*` SHA-256 哈希 |
| `accounts`, `sessions`, `verificationTokens` | NextAuth 历史遗留（暂保留） |
| `messages` | 单条消息（role, tokens, model, ordinal） |
| `message_chunks` | content + tool_context 切片（FTS5 输入） |
| `chunks_fts*` | FTS5 全文索引 |
| `tags`, `session_tags` | 多对多标签 |

迁移 SQL：`scripts/migrations/001-init.sql` … `006-api-tokens.sql`。

```bash
# 应用到 prod
CLOUDFLARE_ACCOUNT_ID=... bunx wrangler d1 execute pika-db --remote --file=scripts/migrations/006-api-tokens.sql
```

### R2 (`pika` / `pika-test`)

```
{userId}/{sessionKey}/canonical.json.gz       规范化对话 JSON（可重写）
{userId}/{sessionKey}/raw/{rawHash}.json.gz   原始驱动产出（不可变）
```

CLI 上传走两条路：
- **Presign**（默认）：`POST /api/ingest/presign` → 直 PUT 到 R2 → `POST /api/ingest/confirm-raw`
- **Proxy**（兜底）：`PUT /api/ingest/content/{sessionKey}/raw`，worker 转发到 R2

---

## 6. 本地开发

```bash
bun install
bun run dev:all         # vite :7022  +  wrangler dev :8787
```

`scripts/dev-all.ts` 并发起两个子进程，统一 prefix 输出，Ctrl-C 联动 reap（`detached: true` + `process.kill(-pid)` 杀整个进程组，避免 wrangler 的 workerd 孤儿占住端口）。

`packages/web-worker/.dev.vars`：
```
DEV_USER_EMAIL=you@example.com
```
本地无 CF Access JWT 时，accessAuth 用这个 email 走 `resolveUser`，命中 prod D1 拿到真 `userId`（D1 binding 上 `remote = true`）。

Vite 开发服务器把 `/api/*` 反代到 `localhost:8787`。

---

## 7. CI/CD

`.github/workflows/ci.yml`：

```yaml
quality:    # base-ci v2026.5 (SHA-pinned): build + L1(coverage≥90%) + tsc + biome + gitleaks + osv
  uses: nocoo/base-ci/.github/workflows/bun-quality.yml@aec4adc1a817c56790d1698329ef9398a15a754a  # v2026.5

deploy:     # 仅 push to main
  needs: quality
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  - bun run build                                     # SPA → packages/web-worker/dist
  - cloudflare/wrangler-action@v3 (deploy --env="")   # 整 worker 一发
  - curl pika.hexly.ai/api/live (200 或 401 都算通过)
```

Repo secret 需要：`CLOUDFLARE_API_TOKEN`（API token，不是 global key；scope = Workers Scripts:Edit + D1:Edit + R2:Edit）。

`--env=""` 显式选 top-level 配置；空字串避开 wrangler 在缺 Memberships:Read 权限时调用 `/memberships` 而失败。

手动部署：
```bash
cd packages/web-worker
CLOUDFLARE_ACCOUNT_ID=... bunx wrangler deploy             # prod
CLOUDFLARE_ACCOUNT_ID=... bunx wrangler deploy --env test  # test
```

---

## 8. 测试与质量门

| 触发 | 工具 | 内容 |
|------|------|------|
| pre-commit (husky) | `bunx vitest run --coverage` + biome | L1 单元 ≥90% + 格式 |
| pre-push (husky) | build + L1 + tsc + biome + gitleaks + osv | 阻塞推送 |
| CI quality | base-ci | 同上，远程复跑 |
| CI deploy | wrangler + curl | 部署 + smoke |

双测试运行器：
- `bun test` — 包含 `bun:sqlite` 迁移测试，仅本地
- `bunx vitest run` — Node 下，CI 用

---

## 9. 易踩坑速查

| 症状 | 根因 | 处理 |
|------|------|------|
| 浏览器 login redirect 循环 | `CF_ACCESS_TEAM_DOMAIN` 配错 → JWT 验签静默失败 | wrangler.toml 顶层 + `[env.test]` 都得对 |
| Token 管理页 HTTP 500 | prod D1 缺表 | `wrangler d1 execute … --file=scripts/migrations/00X.sql` |
| `pika sync` JSON parse 崩 | `/api/ingest/*` 被 CF Access 拦了 → CLI 拿到 HTML | 加 CF Access bypass policy |
| `Session not found: claude%3A...` | URL-encoded sessionKey 没 decode | `decodeURIComponent` 在路由层 |
| 老 CLI 报 1014/SSL | 二进制硬编码 `pika-ingest.worker.hexly.ai` | wrangler.toml 保留这个 `[[routes]]` |
| `dev:all` EADDRINUSE | wrangler 的 workerd 孤儿 | `dev-all.ts` 已用 `detached + kill -pid` |

---

## 10. 不再使用的东西

> 历史包袱清理记录，避免重复发现。

- ❌ Railway（Web Hosting）— 已下线，单 Worker 替代
- ❌ Next.js 15（App Router）— 已替换为 Vite + React 19 SPA
- ❌ NextAuth Google OAuth — 已替换为 CF Access SSO + `pk_*` token
- ❌ `packages/api`、`packages/worker` — 合并进 `packages/web-worker`
- ❌ Service binding `WORKER_SECRET` — 单进程同源，无需
- ❌ D1 HTTP REST API（`CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` / `CF_D1_API_TOKEN`）— 改为原生 D1 binding
