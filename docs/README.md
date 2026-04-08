# Pika Documentation

## Architecture

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture](./01-architecture.md) | System architecture, tech stack, data flow |
| 02 | [Database](./02-database.md) | D1 schema, FTS5 indexing, R2 storage |
| 03 | [CLI](./03-cli.md) | CLI commands, auth flow, upload engine |
| 04 | [Parsers](./04-parsers.md) | Per-source session parsers, driver architecture |
| 05 | [Dashboard](./05-dashboard.md) | Web UI, search, session replay |
| 06 | [Implementation Plan](./06-implementation-plan.md) | Atomic commits, four-layer testing, phased rollout |
| 07 | [E2E Test Plan](./07-e2e-test-plan.md) | Manual per-source upload validation, D1/R2/dashboard checks |
| 08 | [OpenCode SQLite Driver Bug](./08-opencode-sqlite-driver-bug.md) | SQLite driver never wired in sync command — 4,383 sessions missing |
| 09 | [Quality Upgrade: 6D Framework](./09-quality-upgrade-6d.md) | Six-dimension quality framework upgrade — G1/G2 gates, D1 isolation, L2 API E2E |
| 10 | [Stream Pipeline Memory](./10-stream-pipeline-memory.md) | Sync pipeline memory optimization — stream-based batching to reduce 14 GB RSS to ~1-2 GB |
| 11 | [Unified Worker API](./11-unified-worker-api.md) | Consolidate all D1/R2 operations through Worker — eliminate D1 HTTP API, add API key auth |
| 12 | [CLI Base Abstraction](./12-cli-base-abstraction.md) | @nocoo/cli-base enhancements — ApiClient, OutputFormatter, pagination helpers |
| 13 | [Pika CLI CRUD](./13-pika-cli-crud.md) | CLI read/update/delete operations — sessions, projects, search, tags commands |
