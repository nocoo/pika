# 开发、同步与部署

[中文 README](../README.md) · [English README](README.en.md)

本文对应当前 `packages/core`、`packages/cli`、`packages/web`、`packages/web-worker` 四包结构。[架构文档](00-architecture.md)保留拓扑和模型背景；启动、CLI 登录和发布步骤以本文及当前脚本为准。

## 会话来源

CLI 在默认用户目录下自动发现以下来源，没有命令行目录覆盖参数。可用 `--source` 传入一个或多个逗号分隔的 ID。

| ID | 默认位置与格式 |
| --- | --- |
| `claude-code` | `~/.claude/` 下的项目 JSONL 会话 |
| `codex` | `~/.codex/sessions/` 下的 JSONL 会话 |
| `gemini-cli` | `~/.gemini/` 下的临时目录与聊天 JSON |
| `opencode` | `~/.local/share/opencode/` 下的 JSON 存储与 SQLite 数据库 |
| `vscode-copilot` | `~/Library/Application Support/Code/User/` 和 `Code - Insiders/User/` 中的 Copilot 会话，包括 CRDT JSONL |

这些路径主要面向 macOS，VS Code 路径尤其如此。其他平台或自定义数据目录需要适配 `packages/cli/src/drivers/registry.ts`，不能仅凭 Bun 支持某个系统就假定所有来源都能自动发现。

OpenCode SQLite 通过 `bun:sqlite` 只读打开。同步会上传元数据、标准化消息及原始 driver 内容，R2 保存 gzip 数据；当前同步流程没有自动秘密信息脱敏步骤。选择来源时应按实际希望保存的会话范围操作。

## CLI 登录与同步

已发布的 CLI 用 `bun install -g @nocoo/pika` 安装。查看当前源码命令帮助可在安装 workspace 依赖后运行：

```bash
bun packages/cli/src/bin.ts --help
bun packages/cli/src/bin.ts login --help
bun packages/cli/src/bin.ts sync --help
```

`pika login` 使用 `@nocoo/base-cli` 的浏览器登录流程：启动本机回调监听，打开站点的 `/api/auth/cli`，由浏览器完成 Access 登录后创建 token，回调保存到 CLI 配置。它不再要求到 token 页面手动复制粘贴。设置页面仍提供独立的 token 创建与撤销功能。

生产地址固定为 `https://pika.hexly.ai`，`--dev` 固定为 `https://pika.dev.hexly.ai`。后者需要开发域名、HTTPS 代理与对应认证配置，不是 localhost 别名。当前没有 `--api-url` 参数；自行托管的 CLI 需修改 `packages/cli/src/config/manager.ts` 中的地址后构建。

token 和设备配置分别存放在 `~/.config/pika/config.json` 与 `config.dev.json`，生产和开发模式共用同一个 `cursors.json`。切换服务地址不会得到独立的同步进度。

`sync` 根据文件指纹与 driver 游标识别变化。内容上传失败时回退相关文件的本地游标，但服务端已接收的元数据或其他文件不会被整体回滚。

`sync --no-upload` 仍会保存解析后的游标。随后不带该参数运行时，未变化文件可能被跳过，因此不能用它当作首次同步前的安全预览。需要只看命令参数时使用 `--help`。

## 浏览器与 CLI 的认证范围

Worker 的 Access 中间件只对携带 Bearer token 的 `/api/ingest/*` 请求交由 API-key 中间件处理；其他业务路径仍要求有效 Access JWT。Cloudflare 边缘策略也必须允许 ingestion 路径到达 Worker，Bearer header 不会自动绕过边缘 Access 页面。

CLI 中的 `sessions`、`projects`、`search`、`tags` 命令当前只发送 Bearer token，而它们调用的 `/api/sessions`、`/api/projects`、`/api/search`、`/api/tags` 不在上述范围内。因此它们还缺少生产 Access 集成，不能把成功 `pika login` 当作这些命令已经可用。Web 界面通过浏览器身份提供会话与项目管理。

会话有软删除和恢复 API，但 `packages/web/src/App.tsx` 的 `/dashboard/trash` 仍渲染占位组件。不要把 API 的存在等同于已完成回收站页面。

## 交互开发与配置

依赖由 Bun workspace 管理；当前 Vite / Wrangler 组合需要 Node.js 22.12+。仓库没有公共环境变量模板。

```bash
bun install --frozen-lockfile
bun run build
```

`build` 构建共享包、CLI 和 SPA。Vite 将页面输出到 `packages/web-worker/dist/`，Worker 的 assets binding 服务这些静态文件，`/api/*` 优先交给 Hono。CLI 构建产物保留 `@nocoo/base-cli` 外部依赖，运行时仍需要该包和 Bun。

普通 `bun run dev:all` 启动 Vite 7022 和 Wrangler 8787。`packages/web-worker/wrangler.toml` 中 `DB` 与 `BUCKET` 都有 `remote = true`，其现有值指向项目远程资源。使用自己的开发实例前，先替换数据库、存储桶和 Access 配置；单纯运行 `dev:all` 并不会得到空的本地数据库。

| 配置 | 用途 |
| --- | --- |
| `packages/web-worker/wrangler.toml` 的 `DB` / `BUCKET` | D1 数据库与 R2 存储桶 binding |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | 验证浏览器 Access JWT 的团队域与 audience |
| `ENVIRONMENT` | 区分生产与测试行为；不能把测试认证设置用于生产 |
| `packages/web-worker/.dev.vars` | 开发实例的服务端秘密配置，不放入前端变量 |
| `PIKA_WEB_WORKER_URL` | Vite `/api` 开发代理目标，默认 `http://127.0.0.1:8787`；不改变 CLI 地址 |

交互访问需要自己的开发网关完成 Access 登录并转发有效 JWT。源码中的 localhost 快捷路径还要求请求没有 `request.cf`，而本地 workerd 也可能设置该字段；仅设置 `DEV_USER_EMAIL` 不能保证页面 API 可访问。测试身份配置留给下节的隔离 runner。

## 本地测试

根 README 列出全部测试入口。根 Vitest 查找 `packages/*/src` 下的 `.test.ts`，不包含 web 的 TSX 组件测试，也不包含 `packages/core/test/migration.test.ts`。前者使用 web 包的 jsdom 配置；后者由 Bun 运行内存 SQLite。

`bun run test:e2e` 使用 `packages/web-worker/test/e2e/global-setup.ts`：

1. 清空并重建包内 `.wrangler/e2e`，按文件名顺序以 `wrangler d1 execute --local --file` 应用 `scripts/migrations/*.sql`。
2. 插入测试标记与合成用户，写入 runner 专用的 `.dev.vars.e2e`。
3. 用显式 `--local --persist-to` 在 17022 启动 Worker，并注入 `ENVIRONMENT=test`、`E2E_SKIP_AUTH=true` 和测试邮箱。
4. 运行 HTTP API 测试，结束后停止自己的 Worker 进程组并移除变量文件。

保持端口和上述文件位置可供 runner 使用。该入口不需要生产 token，也不需要真实编程工具会话。没有构建产物时，runner 为 assets binding 创建占位文件；API 测试并不验证页面渲染。

## 数据库与发布

新 D1 数据库需要按顺序应用 `scripts/migrations/` 中的 SQL，建立用户、会话、全文索引、标签与 API token 等表。隔离测试会自动初始化本地状态；普通构建与 Worker deploy 均不会自动初始化或迁移远程数据库。已有实例只应用尚未执行的迁移，并先确认目标数据库。

当前发布使用独立的 [.github/workflows/release.yml](../.github/workflows/release.yml)。main 的 CI 成功后，Release 检出对应提交、安装依赖、构建 SPA 和共享包，再部署单个 Worker。仓库需要配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，目标账号内需要准备 D1、R2、自定义域名和 Access 策略。Release 没有 D1 迁移步骤。

手动 `bun run deploy:web-worker` 只调用 Wrangler deploy；构建、数据库迁移和认证配置是另外的前置工作。当前路由包括 `pika.hexly.ai` 和兼容旧 CLI 的 `pika-ingest.worker.hexly.ai`。部署后的 `/api/live` 检查接受 200 或 401，用于确认服务可达，不核对具体版本。
