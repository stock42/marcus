# Marcus documentation

Marcus is a Bun-first agentic operating system. It registers and versions
agents, executes them under supervision, persists their state, and exposes the
control plane through a CLI, REST API, WebSocket API, and Backoffice.

This directory is the maintained documentation for users, agent authors,
integrators, operators, and contributors.

## Start here

- [Installation](./INSTALL.md): local source setup and system installation.
- [Configuration](./CONFIGURATION.md): daemon, API, CLI, files, arguments, and
  environment variables.
- [CLI](./CLI.md): connect, bootstrap, manage Projects, and operate agents.
- [SDK](./SDK.md): author and test native TypeScript agents.
- [Tool Runtime](./TOOLS.md): official tools, schemas, allowlists, risk,
  idempotency, approvals, discovery, and custom `defineTool` capabilities.
- [Markdown agents](./MARKDOWN.md): declarative agent authoring.
- [Kernel](./KERNEL.md): Runs, state, scheduling, concurrency, and persistence.
- [Runtime](./RUNTIME.md): Worker/process profiles and resident instances.
- [REST and WebSocket API](./API.md): integration boundary and authentication.
- [Model Context Protocol](./MCP.md): connect Codex or Claude Code and develop
  Markdown or TypeScript agents through the audited control plane.
- [Backoffice](./BACKOFFICE.md): browser control plane.
- [Public website](./WEBSITE.md): run, build, deploy, and maintain the Spanish
  `projectmarcus.com` landing.
- [Public Agent Studio](./AGENT-STUDIO.md): generate, validate, refine and
  download Marcus Markdown or TypeScript source through HTTP plus WebSocket.
- [Security](./SECURITY.md): trust boundaries, credentials, RBAC, and HMAC.
- [Operations](./OPERATIONS.md): health, backups, recovery, and diagnostics.
- [Distribution](./DISTRIBUTION.md): standalone artifacts and installation.
- [Development](./DEVELOPMENT.md): repository layout, commands, and tests.
- [ADR-001](./ADR-001-MCP-SDK.md): confinement of the official MCP SDK and Zod
  to the Marcus API adapter.

## System shape

```text
marcus CLI ── MNP/1 ──┐
                      ├── marcusd ── Kernel ── Runtime Hosts
marcus-api ── MNP/1 ──┘
     │
     └── REST/WebSocket/MCP + Backoffice
```

`marcusd` is the authority. The API and CLI are clients; they do not bypass the
daemon to reach Kernel state or SQLite.

## Versioning

The current source version is `0.1.0`. Public protocol versions are recorded in
release manifests. Repository changes are recorded in
[`CHANGELOG.md`](../CHANGELOG.md).
