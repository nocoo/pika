# pika

Coding Agent Session Replay & Search SaaS.

Upload, search, and replay your conversations with AI coding agents (Claude Code, Codex, Gemini, OpenCode, VSCode Copilot).

## Architecture

- **CLI** (`@nocoo/pika`): Parses local agent session files, uploads to cloud
- **Dashboard** (Next.js on Railway): Session browsing, replay, full-text search
- **Worker** (Cloudflare Workers): Ingests data to D1 + R2
- **Storage**: Cloudflare D1 (metadata + FTS5) + R2 (full conversations)

## Documentation

See [docs/README.md](./docs/README.md) for the full design documentation.
