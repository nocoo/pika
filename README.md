<p align="center"><img src="logo.png" width="128" height="128"/></p>

<h1 align="center">Pika</h1>

<p align="center"><strong>回放与搜索 AI 编程助手对话记录的 SaaS 平台</strong><br>多源解析 · 全文搜索 · 会话回放 · 增量同步</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"/>
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/web-Next.js%2015-000?logo=nextdotjs" alt="Next.js"/>
  <img src="https://img.shields.io/badge/worker-Cloudflare-f38020?logo=cloudflare" alt="Cloudflare"/>
  <img src="https://img.shields.io/badge/tests-911-brightgreen" alt="Tests"/>
  <img src="https://img.shields.io/badge/coverage-98%25+-brightgreen" alt="Coverage"/>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"/>
</p>

---

## 这是什么

Pika 是一套自托管 SaaS，用于收集、搜索和回放你与 AI 编程助手的对话记录。CLI 工具自动解析本地 5 种 AI 工具的会话文件，增量同步到云端；Web 仪表盘提供全文搜索（FTS5）和逐条消息回放。

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐
│  CLI     │────▶│  Worker      │────▶│  D1 + R2        │
│  pika    │     │  (Cloudflare)│     │  (metadata+FTS) │
└──────────┘     └──────────────┘     └────────┬────────┘
                                               │
                                      ┌────────▼────────┐
                                      │  Dashboard      │
                                      │  (Next.js)      │
                                      └─────────────────┘
```

## 功能

### CLI (`@nocoo/pika`)

- **增量同步** — 基于文件指纹（inode/mtime/size）跟踪变更，仅解析和上传新增内容
- **5 种数据源** — Claude Code、Codex CLI、Gemini CLI、OpenCode（JSON + SQLite）、VSCode Copilot（CRDT JSONL）
- **浏览器 OAuth 登录** — 本地启动临时 HTTP server，一键完成 Google OAuth 认证
- **并行上传** — metadata 批量 POST + content gzip PUT，带并发控制和失败回滚

### Web 仪表盘

- **全文搜索** — 基于 D1 FTS5 索引，搜索结果高亮显示（`<mark>` 标签，XSS 安全）
- **会话回放** — 逐条浏览完整对话，包含代码块、工具调用等结构化内容
- **收藏与标签** — 为重要会话加星标或自定义标签分类
- **软删除回收站** — 误删可恢复

### 安全

- **API key 哈希存储** — SHA-256 哈希，每次登录生成新 key
- **Gzip 解压上限** — Worker 端流式追踪解压大小，超过 256 MB 自动截断
- **Ingest 体积限制** — 内容上传 50 MB，metadata 2 MB，无 Content-Length 直接拒绝（411）
- **本地配置权限** — `~/.config/pika/` 文件权限 0600，仅所有者可读

## 安装

```bash
# 全局安装 CLI
bun install -g @nocoo/pika

# 登录
pika login

# 同步本地会话到云端
pika sync
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `pika login` | 通过浏览器 OAuth 认证，获取 API key |
| `pika login --force` | 强制重新认证 |
| `pika sync` | 解析本地会话并上传到云端 |
| `pika sync --source claude-code,codex` | 仅同步指定来源 |
| `pika sync --no-upload` | 仅本地解析，不上传 |
| `pika status` | 查看同步状态和各来源文件数 |

## 项目结构

```
pika/
├── packages/
│   ├── core/               # 共享类型、常量、校验器
│   ├── cli/                # CLI 工具 (@nocoo/pika)
│   │   ├── commands/       #   命令实现 + 业务逻辑
│   │   ├── drivers/        #   数据源驱动（文件 / SQLite）
│   │   ├── parsers/        #   各 AI 工具解析器
│   │   ├── upload/         #   上传引擎
│   │   └── storage/        #   cursor 持久化
│   ├── web/                # Next.js 15 仪表盘
│   │   ├── app/            #   App Router 路由
│   │   ├── components/     #   UI 组件 (shadcn/ui)
│   │   └── lib/            #   D1 客户端、认证
│   └── worker/             # Cloudflare Worker
│       └── src/            #   D1/R2 写入、FTS5 索引
├── scripts/                # 数据库迁移、版本同步
├── docs/                   # 设计文档
└── vitest.config.ts        # 测试配置（90% 覆盖率门槛）
```

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | [Bun](https://bun.sh) |
| 语言 | [TypeScript](https://www.typescriptlang.org) (strict) |
| CLI 框架 | [citty](https://github.com/unjs/citty) + [consola](https://github.com/unjs/consola) |
| Web 框架 | [Next.js 15](https://nextjs.org) (App Router) |
| UI | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) + [Recharts](https://recharts.org) |
| 认证 | [NextAuth v5](https://authjs.dev) (Google OAuth, JWT) |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite + FTS5) |
| 存储 | [Cloudflare R2](https://developers.cloudflare.com/r2/) (gzip 压缩对话内容) |
| Worker | [Cloudflare Workers](https://workers.cloudflare.com) |
| 部署 | [Railway](https://railway.com) (Web) + Cloudflare (Worker) |
| 测试 | [Vitest](https://vitest.dev) (98%+ 覆盖率) + [Husky](https://typicode.github.io/husky/) |

## 开发

### 环境要求

- [Bun](https://bun.sh) >= 1.2
- Node.js >= 20（Vitest 运行需要）

### 快速开始

```bash
git clone https://github.com/nocoo/pika.git
cd pika
bun install        # 安装依赖 + 自动配置 git hooks
bun run dev        # 启动 Next.js 开发服务器 (port 7040)
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun install` | 安装依赖 |
| `bun run dev` | 启动开发服务器 (port 7040) |
| `bun run build` | 构建所有 packages |
| `bun run lint` | 全量类型检查 |
| `bun test` | 运行全部单元测试 (Bun native, 911 tests) |
| `bunx vitest run --coverage` | 运行测试 + 覆盖率报告 |

## 测试

Pika 采用四层测试架构，由 git hooks 强制执行：

| 层 | 内容 | 触发时机 | 门槛 |
|----|------|----------|------|
| L1: 单元测试 | 业务逻辑、解析器、校验器 | pre-commit | 90% 覆盖率 |
| L2: 类型检查 | `tsc --noEmit`（全 packages） | pre-commit | 零错误 |
| L3: API E2E | 全部 REST API 端点 | pre-push | 100% 端点 |
| L4: BDD E2E | 核心用户流程 (Playwright) | 按需 | 核心流程 |

### 双测试运行器

由于运行时差异，Pika 使用两个测试运行器：

- **`bun test`** — Bun 原生运行器，包含 `bun:sqlite` 迁移测试，用于 git hooks
- **`bunx vitest run`** — Vitest (Node)，排除 `bun:sqlite` 测试，用于覆盖率报告

## 文档

| # | 文档 | 说明 |
|---|------|------|
| 01 | [Architecture](./docs/01-architecture.md) | 系统架构、技术栈、数据流 |
| 02 | [Database](./docs/02-database.md) | D1 schema、FTS5 索引、R2 存储 |
| 03 | [CLI](./docs/03-cli.md) | CLI 命令、认证流程、上传引擎 |
| 04 | [Parsers](./docs/04-parsers.md) | 各来源解析器、驱动架构 |
| 05 | [Dashboard](./docs/05-dashboard.md) | Web UI、搜索、会话回放 |
| 06 | [Implementation Plan](./docs/06-implementation-plan.md) | 原子 commit、四层测试、分阶段交付 |
| 07 | [E2E Test Plan](./docs/07-e2e-test-plan.md) | 手动逐源上传验证 |
| 08 | [OpenCode SQLite Bug](./docs/08-opencode-sqlite-driver-bug.md) | SQLite 驱动未接入导致 4,383 会话缺失 |

## License

[MIT](LICENSE) © 2026 Zheng Li
