<p align="center"><img src="logo.png" width="128" height="128"/></p>

<h1 align="center">Pika</h1>

<p align="center"><strong>回放与搜索 AI 编程助手对话记录的 SaaS 平台</strong><br>多源解析 · 全文搜索 · 会话回放 · 增量同步</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"/>
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/web-Vite%20+%20React-646cff?logo=vite" alt="Vite + React"/>
  <img src="https://img.shields.io/badge/edge-Cloudflare%20Workers-f38020?logo=cloudflare" alt="Cloudflare Workers"/>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"/>
</p>

---

## 这是什么

Pika 是一套自托管 SaaS，用于收集、搜索和回放你与 AI 编程助手的对话记录。CLI 工具自动解析本地 5 种 AI 工具的会话文件，增量同步到云端；Web 仪表盘提供全文搜索（FTS5）和逐条消息回放。

```
┌──────────┐     ┌────────────────────────────────┐
│  CLI     │────▶│  pika.hexly.ai                 │
│  pika    │     │  ┌─────────────┐  ┌─────────┐  │
└──────────┘     │  │  Web SPA    │  │ /api/*  │  │
                 │  │  (assets)   │  │  Hono   │  │
                 │  └─────────────┘  └────┬────┘  │
                 │   Cloudflare Worker    │       │
                 └────────────────────────┼───────┘
                                          ▼
                                ┌──────────────────┐
                                │  D1 + R2         │
                                │  metadata + FTS5 │
                                │  + gzip blobs    │
                                └──────────────────┘
```

整个站点是 **一个 Cloudflare Worker**：静态 SPA 资源 + `/api/*` Hono 子应用同进程同源。鉴权前置 Cloudflare Access（人）+ `pk_*` API token（CLI）。

## 功能

### CLI (`@nocoo/pika`)

- **增量同步** — 基于文件指纹（inode/mtime/size）跟踪变更，仅解析和上传新增内容
- **5 种数据源** — Claude Code、Codex CLI、Gemini CLI、OpenCode（JSON + SQLite）、VSCode Copilot（CRDT JSONL）
- **浏览器认证** — 通过 dashboard `/dashboard/settings/cli` 创建 `pk_*` token，写入 `~/.config/pika/`
- **并行上传** — metadata 批量 POST + content gzip PUT（presign 直传 R2 或 worker proxy 兜底），并发控制 + 失败回滚

### Web 仪表盘

- **全文搜索** — D1 FTS5 索引，结果高亮（`<mark>`，XSS 安全），`⌘K` 全局搜索
- **会话回放** — 逐条浏览完整对话，包含代码块、工具调用等结构化内容
- **收藏与标签** — 为重要会话加星标或自定义标签分类
- **软删除回收站** — 误删可恢复
- **Token 管理** — 创建、命名、撤销 CLI API token

### 安全

- **Cloudflare Access JWT** — 浏览器端通过 `nocoo.cloudflareaccess.com` SSO，worker `accessAuth` 中间件验签
- **API token 哈希存储** — SHA-256；`pk_*` 明文仅创建时显示一次
- **Gzip 解压上限** — Worker 端流式追踪解压大小，超过 256 MB 自动截断
- **Ingest 体积限制** — 内容上传 50 MB，metadata 2 MB，无 Content-Length 直接拒绝（411）
- **本地配置权限** — `~/.config/pika/` 文件权限 0600

## 安装

```bash
bun install -g @nocoo/pika
pika login          # 打开 dashboard 创建 token，粘贴回 CLI
pika sync           # 解析本地会话并上传
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `pika login` | 打开浏览器到 token 管理页，引导粘贴 `pk_*` |
| `pika sync` | 解析本地会话并上传到云端 |
| `pika sync --source claude-code,codex` | 仅同步指定来源 |
| `pika sync --no-upload` | 仅本地解析，不上传 |
| `pika status` | 查看同步状态和各来源文件数 |

## 项目结构

```
pika/
├── packages/
│   ├── core/                # 共享类型、常量、校验器
│   ├── cli/                 # @nocoo/pika
│   ├── web/                 # Vite + React SPA（构建到 ../web-worker/dist）
│   └── web-worker/          # 单 Worker：[assets] SPA + /api/* Hono
│       └── src/
│           ├── api/         #   sessions / projects / tags / search / stats / ingest
│           ├── routes/      #   me / auth-cli / auth-tokens
│           ├── middleware/  #   accessAuth → apiKeyAuth → resolveUser
│           └── lib/         #   env、resolve-user、R2Client
├── scripts/
│   ├── migrations/          # D1 schema migrations (001–006)
│   └── dev-all.ts           # 并发启动 web (vite :7022) + worker (wrangler :8787)
├── docs/
│   └── 00-architecture.md   # 当前架构与部署
└── .github/workflows/
    └── ci.yml               # quality (base-ci) + CD (wrangler deploy)
```

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | [Bun](https://bun.sh) |
| 语言 | [TypeScript](https://www.typescriptlang.org) (strict) |
| CLI | [citty](https://github.com/unjs/citty) + [consola](https://github.com/unjs/consola) |
| Web | [Vite](https://vite.dev) + [React 19](https://react.dev) + [React Router](https://reactrouter.com) |
| UI | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) + [Recharts](https://recharts.org) |
| 边缘 | [Cloudflare Workers](https://workers.cloudflare.com) + [Hono](https://hono.dev) |
| 认证 | [Cloudflare Access](https://www.cloudflare.com/zero-trust/) (人) · `pk_*` API token (CLI) |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite + FTS5) |
| 存储 | [Cloudflare R2](https://developers.cloudflare.com/r2/) (gzip blobs，canonical + raw) |
| 测试 | [Vitest](https://vitest.dev) + [Bun test](https://bun.sh/docs/cli/test) |
| CI/CD | GitHub Actions ([nocoo/base-ci](https://github.com/nocoo/base-ci)) + `wrangler deploy` |

## 开发

```bash
git clone https://github.com/nocoo/pika.git
cd pika
bun install
bun run dev:all     # vite :7022 + wrangler dev :8787
```

| 命令 | 说明 |
|------|------|
| `bun install` | 安装依赖（自动配 husky） |
| `bun run dev:all` | 启动 web (Vite :7022) + web-worker (wrangler :8787) |
| `bun run build` | 构建 SPA 到 `packages/web-worker/dist` |
| `bun run lint` | tsc --noEmit (root + web + web-worker) |
| `bunx vitest run --coverage` | 测试 + 覆盖率 |

## 部署

单 Worker 拓扑：构建产物即部署产物。`bun run build` 把 SPA 打到 `packages/web-worker/dist/`，`wrangler deploy` 上传 worker + assets。

| 环境 | Worker 名 | 域名 |
|------|----------|------|
| prod | `pika` | `pika.hexly.ai` · `pika-ingest.worker.hexly.ai`（旧 CLI 兼容） |
| test | `pika-test` | `pika-test.hexly.ai` |

CI/CD（`.github/workflows/ci.yml`）在 push to `main` 时自动跑 quality gate（typecheck + L1 + biome + gitleaks + osv）然后 `wrangler deploy --env=""`。需要 repo secret `CLOUDFLARE_API_TOKEN`。

详细见 [docs/00-architecture.md](./docs/00-architecture.md)。

## 文档

| # | 文档 | 说明 |
|---|------|------|
| 00 | [Architecture](./docs/00-architecture.md) | 拓扑、鉴权链路、数据模型、部署、运维 |

## License

[MIT](LICENSE) © 2026 Zheng Li
