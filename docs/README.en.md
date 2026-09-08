<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" alt="Pika logo" />
</p>
<h1 align="center">Pika</h1>
<p align="center">Collect coding agent sessions to search, read, and organize in a browser.</p>
<p align="center">
  <a href="https://pika.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Pika keeps conversations from multiple coding agents in one place. Its Bun CLI reads local session files and syncs changes to the server. The web interface lets you search messages, read code and tool calls, and organize sessions by project.

A single Cloudflare Worker serves the React interface and Hono API. D1 stores metadata and full-text indexes; R2 stores compressed canonical messages and raw content. Browsers sign in through Cloudflare Access, while CLI ingestion uses a separate API token. The hosted site requires Access permission; hosting your own instance requires your own Cloudflare resources and authentication setup.

## Features

- Parse local sessions from Claude Code, Codex, Gemini CLI, OpenCode, and VS Code Copilot. OpenCode supports both JSON files and a read-only SQLite database.
- Sync changed files, batch metadata, and upload compressed messages. Failed content uploads roll back the affected local file cursors for later retries.
- Search conversation text, filter by source, project, or tag, and inspect messages, code blocks, and tool calls.
- Edit session titles and descriptions, add stars and tags, and view projects and usage statistics.
- Create, name, and revoke CLI tokens in settings. Soft-delete and restore APIs exist; the dedicated trash page is still a placeholder.

Sync uploads session metadata, canonical messages, and raw content retained by the parsers. Default discovery paths mainly follow macOS layouts, particularly for VS Code and Insiders. The CLI has no custom source-path option. See [source IDs and directories](01-development.md#会话来源).

## Usage

Install the published CLI on a computer with [Bun](https://bun.sh):

```bash
bun install -g @nocoo/pika
pika login
pika sync --source claude-code,codex
```

`login` opens your browser for Access sign-in and saves a token automatically through a local callback. `sync` then uploads sessions from the selected sources. Omitting `--source` scans every supported source. Open the [website](https://pika.hexly.ai) to view the results.

| Command | Purpose |
| --- | --- |
| `pika sync` | Sync all discoverable sources |
| `pika sync --source claude-code,codex` | Sync selected sources |
| `pika status` | Inspect local sync state and source file information |
| `pika login --force` | Sign in through the browser again |

`sync --no-upload` parses files and saves sync cursors. A subsequent normal sync may skip unchanged files, so it is not a side-effect-free preview before the first upload.

The current source includes `sessions`, `projects`, `search`, and `tags` CLI management commands that call Access-protected APIs. The Bearer token from `pika login` alone does not authenticate these commands in production; use the web interface for session management. CLI production and `--dev` URLs are fixed in source. `--dev` targets `https://pika.dev.hexly.ai`; a CLI for your own deployment requires changing the URLs and rebuilding.

## Development

Install Bun and Node.js 22.12+ for Vite, Vitest, and Wrangler.

```bash
git clone https://github.com/nocoo/pika.git
cd pika
bun install --frozen-lockfile
bun run build
```

`build` builds the shared package, CLI, and SPA, placing web assets in `packages/web-worker/dist/`. Parsing and sync live in `packages/cli/`, the React interface in `packages/web/`, and the API and Worker configuration in `packages/web-worker/`.

The ordinary development configuration sets both D1 and R2 to `remote = true`, so starting it accesses the configured remote resources. First prepare your own database, bucket, Access settings, and development gateway using the [development guide](01-development.md#交互开发与配置), then run:

```bash
bun run dev:all
```

This starts Vite on 7022 and the Worker on 8787. Use the isolated API tests below for local verification. Setting `DEV_USER_EMAIL` alone does not ensure ordinary local requests pass authentication. The production Release workflow deploys the Worker after successful main-branch CI; D1 migrations must be applied separately.

## Tests

Install dependencies first, with Bun, Node.js, and `npx` available on PATH.

```bash
bun run test
bun run --cwd packages/web test
bun test packages/core/test/migration.test.ts
bun run test:e2e
```

Root Vitest covers TypeScript unit tests in the shared package, CLI, and Worker. Run React / TSX tests through the web package separately. Migration tests use Bun's in-memory SQLite.

API E2E applies migrations, seeds a synthetic test user, and starts a local Worker without production credentials. Keep port 17022 free and reserve `.wrangler/e2e` and `.dev.vars.e2e` inside `packages/web-worker` for the runner. The state directory is rebuilt each time; the variables file is written by the runner and removed on teardown. There is currently no browser E2E command.

## Stack

| Technology | Purpose |
| --- | --- |
| TypeScript / Bun workspaces | Shared types, CLI, dependencies, and scripts |
| `@nocoo/base-cli` | CLI commands, output, and browser login |
| Vite / React / React Router | SPA builds, interface, and routing |
| Tailwind CSS / Radix UI / Recharts | Styling, interface components, and charts |
| Hono / Cloudflare Workers | Same-origin API and static assets |
| Cloudflare Access | Browser authentication |
| Cloudflare D1 / SQLite FTS5 | Metadata, users, token hashes, and full-text search |
| Cloudflare R2 | Gzip-compressed canonical messages and raw content |
| Vitest / Testing Library / Bun SQLite | Unit, React, and migration tests |

## Documentation

- [Documentation index](README.md)
- [Development, sync behavior, and deployment](01-development.md): configuration, source paths, authentication, and migration prerequisites.
- [Architecture](00-architecture.md): single-Worker topology and data model. Use the development guide for current startup and release instructions.

## License

[MIT](../LICENSE)
