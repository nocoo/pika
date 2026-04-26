# 05 - Dashboard

> **当前形态（docs/17 终态）**：Vite SPA + react-router 7 + SWR，由 `packages/web-worker` Cloudflare Worker 静态托管，所有 `/api/*` 通过 service binding 走 `packages/api`（Hono on Workers）→ `packages/worker`（D1/R2 数据面）。CF Access SSO + Bearer token 在 web-worker 完成。
>
> **历史形态**（Next.js 16 + NextAuth + Railway）：见末尾 [附录：Next.js 历史形态](#附录nextjs-历史形态归档)。

## Overview

Pika dashboard 现为 SPA：

- 构建：`vite build` 输出到 `packages/web-worker/dist`，由 web-worker `[assets]` 直接吐 HTML/JS/CSS
- 数据：所有页面通过 SWR 调用同源 `/api/*`
- 认证：CF Access SSO（生产）/ localhost 旁路（开发），用户态由 web-worker 通过 cookie + D1 lookup 解析后注入 `X-User-Id`
- CLI loopback / token 管理：`/api/auth/cli`、`/api/auth/tokens`（web-worker 路由）

## Tech Stack

| Component | Choice |
|-----------|--------|
| Framework | Vite 8 + React 19（SPA） |
| Router | react-router 7 |
| Data | SWR |
| CSS | Tailwind CSS v4 |
| UI | shadcn/ui（radix-ui primitives） |
| Charts | Recharts |
| Auth (browser) | CF Access SSO（cookie），开发用 `isLocalhost` 旁路 |
| Auth (CLI) | API tokens（`pk_*` SHA-256 hash），由 web-worker `/api/auth/tokens` 颁发 |
| API access | 同源 `/api/*` → web-worker → service binding → packages/api → packages/worker |
| Deployment | 三个独立 Cloudflare Worker（web-worker / api / worker） |

## Route Structure

```
packages/web/src/pages/
+-- login/                    # CF Access SSO 入口（仅 dev 旁路用）
+-- dashboard/
|   +-- page.tsx              # 概览：stats, activity, recent sessions
|   +-- sessions/             # 会话列表 + 详情
|   +-- search/               # 全文搜索
|   +-- projects/             # 项目维度聚合
|   +-- settings/
|       +-- tags/             # tag 管理
|       +-- cli/              # CLI install / auth / token 管理
+-- App.tsx                   # react-router 主路由
```

## Key Pages

### Dashboard (`/dashboard`)
- 总会话数、本周新增
- 90 天活动热力图
- 来源分布（Claude / Codex / Gemini / OpenCode / VSCode Copilot）
- 最近 10 条会话 + Top 项目
- 数据：`GET /api/stats`

### Session List (`/dashboard/sessions`)
- 全文搜索 + 多维过滤（来源 / 项目 / 时间 / 星标 / 标签）
- 排序：last active / started at / token / duration
- cursor 分页
- 数据：`GET /api/sessions?...`

### Session Detail (`/dashboard/sessions/:id`)
- D1 metadata（即时） + R2 `canonical.json.gz`（异步）
- 角色样式渲染、tool call 可展开、token 用量分段
- 操作：星标、标签、回收站、标题/描述编辑
- 数据：`GET /api/sessions/:id` + `/api/sessions/:id/content`

### Search (`/dashboard/search`)
- FTS5 全文检索（消息内容 + 工具上下文）
- `snippet()` 高亮
- 数据：`GET /api/search?q=...`
- ⌘K 快捷键打开搜索 dialog（全局）

### Projects (`/dashboard/projects`)
- 项目维度聚合 + 活动热力图
- 数据：`GET /api/projects`、`GET /api/projects/activity`

### Settings/Tags (`/dashboard/settings/tags`)
- 标签 CRUD（带颜色选择）
- 数据：`GET/POST /api/tags`、`PATCH/DELETE /api/tags/:id`

### Settings/CLI (`/dashboard/settings/cli`)
- 安装命令、认证流程、API token 列表 + 撤销
- 数据：`GET /api/auth/tokens`、`DELETE /api/auth/tokens/:id`、`/api/auth/cli`

## API Routes（终态）

所有 `/api/*` 在 `packages/web-worker` 入口分流：

- `/api/auth/cli` + `/api/auth/tokens` + `/api/me`：web-worker 自己处理（cookie + D1 token CRUD）
- 其余 `/api/*`：通过 service binding 全路径透传到 `packages/api`（Hono），再由 api 转 `packages/worker`

`packages/api` 用 `Hono.basePath("/api")`，所有 sub-route 自动落在 `/api/*` 下。

| 路径 | Method | 处理者 | 描述 |
|---|---|---|---|
| `/api/me` | GET | web-worker | 当前用户（cookie → D1 users） |
| `/api/auth/cli` | GET | web-worker | CLI loopback OAuth 换 token |
| `/api/auth/tokens` | GET/POST/DELETE | web-worker | API token 列表 / 颁发 / 撤销 |
| `/api/sessions` | GET | api → worker | 列表 + 过滤 |
| `/api/sessions/:id` | GET/PATCH | api → worker | 详情 / 编辑 |
| `/api/sessions/:id/content` | GET | api → worker | R2 canonical |
| `/api/sessions/:id/tags` | PUT/DELETE | api → worker | tag 关联 |
| `/api/sessions/:id/star` | PATCH | api → worker | 星标 |
| `/api/sessions/:id/trash` | PATCH | api → worker | 软删 / 恢复 |
| `/api/sessions/batch` | POST | api → worker | 批量操作 |
| `/api/search` | GET | api → worker | FTS5 搜索 |
| `/api/stats` | GET | api → worker | 仪表盘统计 |
| `/api/projects` | GET | api → worker | 项目列表 |
| `/api/projects/activity` | GET | api → worker | 项目活动热力图 |
| `/api/tags` | GET/POST | api → worker | 标签 CRUD |
| `/api/tags/:id` | PATCH/DELETE | api → worker | 标签更新 / 删除 |
| `/api/ingest/sessions` | POST | api → worker | metadata 入库 |
| `/api/ingest/presign` | POST | api → worker | R2 上传 presign |
| `/api/ingest/confirm-raw` | POST | api → worker | 上传确认 |
| `/api/ingest/content/:key/(canonical\|raw)` | PUT | api → worker | 内容流式上传 |
| `/api/live` | GET | api | 健康检查 |

## Component Structure

```
packages/web/src/
+-- components/
|   +-- ui/                # shadcn primitives（button/card/dialog/...）
|   +-- layout/            # AppShell（floating L1 island）+ sidebar + header
|   +-- sessions/          # list / card / filters / detail
|   +-- search/            # input + results + ⌘K dialog
|   +-- projects/          # heatmap + project cards
+-- pages/                 # 页面组件（按路由分目录）
+-- hooks/                 # useMe、useSessions、...（SWR 包装）
+-- lib/                   # api client、navigation、format、palette
```

## Worker 链路

详见 docs/17 §拓扑权衡。要点：

- `packages/web-worker`（CF Access + cookie + token）
  - 持 `[assets]` 静态资产
  - 通过 service binding `API` 调 `packages/api`
  - `/api/auth/*` 与 `/api/me` 自己处理
- `packages/api`（Hono.basePath("/api")）
  - 业务 facade，负责入参校验、auth header 透传
  - 通过 HTTP + `WORKER_SECRET` 调 `packages/worker`
- `packages/worker`（D1/R2 数据面）
  - 仅接受 `WORKER_SECRET` + `X-User-Id`（CF Access 上游已校验）
  - 不再有 `/auth/me` / `/auth/cli-key` / `pk_*` 校验分支（P6.3 已删）

## Deployment

- 三个独立 wrangler 项目（`packages/web-worker`、`packages/api`、`packages/worker`）
- web-worker 绑公网域名（`pika.hexly.ai`），api 仅 service binding 不绑路由，worker 独立
- dev：`bun run dev:all` 启动 vite（7024）+ web-worker（7025，wrangler dev --local）+ api（7023）；Caddy 反代 `pika.dev.hexly.ai → :7025`，`isLocalhost` 旁路 CF Access
- 关键 env：`WORKER_SECRET`、`WORKER_URL`、CF Access 配置（仅 web-worker）

## 附录：Next.js 历史形态（归档）

> 以下内容描述 docs/17 之前的形态，仅作历史参考；包代码已在 P6.2 删除（`packages/web_legacy`）。

- 框架：Next.js 16（App Router，standalone output），React 19
- 部署：Railway Docker（Bun build → Node 22 runtime），同源 Caddy 反代
- 认证：NextAuth v5（Google OAuth + JWT cookie），D1AuthAdapter 直连 D1（users/accounts 表）
- API：所有 `/api/*` 是 Next.js route handler 中的 thin forwarder，通过 `createForwardHandler` 转发到 `packages/api`（docs/16）
- D1 直连：仅 NextAuth 的 D1AuthAdapter 通过 `lib/d1.ts` + `CF_D1_*` env vars 写 users/accounts；其它读写均经 worker
- 端口：web dev 7022 / E2E 17022；api dev 7023 / E2E 17023
- env：`GOOGLE_CLIENT_ID/SECRET`、`NEXTAUTH_SECRET`、`CF_ACCOUNT_ID`、`CF_D1_DATABASE_ID`、`CF_D1_API_TOKEN`、`API_INTERNAL_URL`、`WORKER_SECRET`、`WORKER_URL`
- token 颁发：browser → `/api/auth/cli`（NextAuth cookie 校验）→ packages/worker `/auth/cli-key`（mint pk_，hash 入 `users.api_key`）；CLI bearer 用 `pk_*` 直连 worker

迁移到 SPA + CF Access 的动机：去 NextAuth + Railway 双依赖、把 auth 单点收敛到 CF Access、把数据面统一在 Cloudflare 边缘。详见 docs/17。
