<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" alt="Pika logo" />
</p>
<h1 align="center">Pika</h1>
<p align="center">收集 AI 编程工具的会话，在浏览器中查找、阅读和整理。</p>
<p align="center">
  <a href="https://pika.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Pika 为使用多种 AI 编程工具的人集中保存对话记录。Bun CLI 读取本机会话文件，增量同步到服务端；Web 界面用于搜索消息、阅读代码和工具调用、按项目整理会话。

站点由一个 Cloudflare Worker 提供 React 页面和 Hono API，D1 保存元数据与全文索引，R2 保存压缩后的标准化消息及原始内容。浏览器通过 Cloudflare Access 登录，CLI 的同步接口使用独立 API token。使用现有站点需要获得 Access 访问权限；自行托管需要配置自己的 Cloudflare 资源与认证。

## 功能

- 解析 Claude Code、Codex、Gemini CLI、OpenCode 和 VS Code Copilot 的本地会话；OpenCode 支持 JSON 文件与只读 SQLite 数据库。
- 按文件变化增量同步，批量发送元数据、压缩上传消息内容；内容上传失败时回退相关本地文件游标，供后续重试。
- 搜索对话全文，按来源、项目和标签筛选，在详情页查看消息、代码块与工具调用。
- 编辑会话标题和描述，添加星标与标签，查看项目和使用统计。
- 在设置中创建、命名和撤销 CLI token。会话支持软删除与恢复 API，独立回收站页面仍是占位页面。

同步会上传会话元数据、标准化消息和解析器保留的原始内容。当前默认路径主要按 macOS 布局查找，尤其是 VS Code / Insiders；CLI 没有自定义数据源路径参数。支持的来源 ID 与目录见[开发与使用说明](docs/01-development.md#会话来源)。

## 使用

在安装了 [Bun](https://bun.sh) 的电脑上安装已发布的 CLI：

```bash
bun install -g @nocoo/pika
pika login
pika sync --source claude-code,codex
```

`login` 打开浏览器完成 Access 登录，通过本机回调自动保存 token。随后 `sync` 上传所选来源的会话；省略 `--source` 会扫描所有支持的来源。打开[站点](https://pika.hexly.ai)查看同步结果。

| 命令 | 用途 |
| --- | --- |
| `pika sync` | 同步所有可发现的来源 |
| `pika sync --source claude-code,codex` | 只同步指定来源 |
| `pika status` | 查看本地同步状态与来源文件信息 |
| `pika login --force` | 重新进行浏览器登录 |

`sync --no-upload` 会解析文件并保存同步游标，之后的正常同步可能跳过未变化的文件；不要把它作为首次上传前的无副作用预览。

当前源码中的 `sessions`、`projects`、`search`、`tags` CLI 管理命令访问受 Access 保护的 API，仅有 `pika login` 得到的 Bearer token 还不足以在生产使用这些命令。会话管理可通过 Web 界面完成。CLI 的生产和 `--dev` 地址写在源码中，`--dev` 指向 `https://pika.dev.hexly.ai`；自行托管的 CLI 需要调整地址并重新构建。

## 开发

需要 Bun，以及用于 Vite、Vitest 和 Wrangler 的 Node.js 22.12+。

```bash
git clone https://github.com/nocoo/pika.git
cd pika
bun install --frozen-lockfile
bun run build
```

`build` 构建共享包、CLI 和 SPA，网页产物写入 `packages/web-worker/dist/`。`packages/cli/` 包含解析和同步逻辑，`packages/web/` 是 React 界面，`packages/web-worker/` 是 API 和 Worker 配置。

普通开发配置中的 D1 / R2 均为 `remote = true`，直接启动会访问配置里的远程资源。先按[开发与部署说明](docs/01-development.md#交互开发与配置)准备自己的数据库、存储桶、Access 配置和开发网关，再运行：

```bash
bun run dev:all
```

此命令启动 Vite 7022 和 Worker 8787。本地 API 验证可直接使用下节的隔离测试；仅设置 `DEV_USER_EMAIL` 不能保证普通本地请求通过认证。生产 Release 工作流在 main CI 成功后部署 Worker，D1 迁移需另行应用。

## 测试

先完成依赖安装，并确保 Bun、Node.js 和 `npx` 在 PATH 中。

```bash
bun run test
bun run --cwd packages/web test
bun test packages/core/test/migration.test.ts
bun run test:e2e
```

根 Vitest 命令覆盖共享包、CLI 和 Worker 的 TypeScript 单元测试；React / TSX 测试由 web 包单独运行。迁移测试使用 Bun 的内存 SQLite。

API E2E 自动应用迁移、写入合成测试用户并启动本地 Worker，无需生产凭据。保持 17022 端口空闲，并将 `packages/web-worker` 内的 `.wrangler/e2e` 与 `.dev.vars.e2e` 留给 runner；前者每次重建，后者由 runner 写入并在结束时移除。当前没有浏览器 E2E 命令。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript / Bun workspaces | 共享类型、CLI、依赖管理与脚本 |
| `@nocoo/base-cli` | CLI 命令、输出和浏览器登录 |
| Vite / React / React Router | SPA 构建、界面和路由 |
| Tailwind CSS / Radix UI / Recharts | 样式、界面组件和统计图表 |
| Hono / Cloudflare Workers | 同源 API 与静态资源 |
| Cloudflare Access | 浏览器身份认证 |
| Cloudflare D1 / SQLite FTS5 | 元数据、用户、token 哈希与全文搜索 |
| Cloudflare R2 | gzip 压缩的标准化消息及原始内容 |
| Vitest / Testing Library / Bun SQLite | 单元测试、React 测试与迁移测试 |

## 文档

- [文档索引](docs/README.md)
- [开发、同步行为与部署](docs/01-development.md)：配置、来源目录、认证和迁移前置条件。
- [架构说明](docs/00-architecture.md)：单 Worker 拓扑与数据模型；启动和发布步骤以开发说明为准。

## 许可证

[MIT](LICENSE)
