# Marcus Agentic OS

Marcus is a Bun-first agentic operating system for registering, versioning,
running, supervising, and exposing agents across multiple projects.

Maintained user and operator documentation is in
[`documentation/`](./documentation/README.md). Marcus uses a strict
client/service architecture:

```text
marcus CLI ── MNP/1 ──┐
                      ├── marcusd ── Marcus Kernel ── Runtime Hosts
marcus-api ── MNP/1 ──┘
     │
     ├── REST/WebSocket
     └── Backoffice Next.js independiente
```

## Development

Requirements:

- Bun 1.3.14 or newer in the 1.x compatibility line
- Linux for the normative server/runtime behavior

```bash
bun install
bun run check
bun run build
```

The implementation is organized as Bun workspaces and orchestrated by
Turborepo. Core packages intentionally avoid third-party runtime dependencies;
S42-Core is confined to `apps/marcus-api`.
Server, CLI and internal package entrypoints run as TypeScript directly in Bun;
only browser assets, the native Next.js `.next/` runtime and standalone release
executables are built. The workspace does not maintain per-package `dist/`
output.

## TypeScript SDK

Once an authorized maintainer has published a release to npm, install the
Bun-native public SDK with:

```bash
bun add @marcus/sdk
```

Making this repository public does not publish npm packages. Maintainers can
validate the exact self-contained tarball with `bun run publish:sdk:dry-run`;
`bun run publish:sdk` additionally requires npm authentication, a clean
`main` synchronized with `origin/main`, and publish access to the public
`@marcus` scope. No generated `dist/` is part of the SDK contract.

## What is included

- MNP/1 TCP/TLS control protocol, authentication, project RBAC and audit trail.
- Durable SQLite Kernel state for agents, immutable versions, Runs, processes,
  schedules, messages, conversations, approvals, artifacts and checkpoints.
- Supervised Worker and process runtimes, including resident instance recovery.
- TypeScript SDK and declarative Markdown compiler with contract parity tests.
- Reusable, immutable and supervised `AuthValidator` versions for Markdown and
  shared external entrypoint authentication.
- Project filesystem, resumable uploads, source reconciliation, watchable local
  directory sync and atomic backup/restore.
- Standalone CLI, daemon, internal runtime/compiler helpers, REST/WebSocket API,
  and an independent Bun-first Next.js Backoffice.
- Spanish public website for `projectmarcus.com`, including the enterprise
  product narrative, an interactive first-agent console journey and a public
  Agent Studio that generates validated source without execution or deploy.
- Linux systemd examples, checksum-verifying installer and safe-by-default
  uninstaller; standalone Windows CLI cross-build support.

## Local bootstrap

Start the complete development stack:

```bash
bun run dev
```

This starts `marcusd` and `marcus-api`. Start the Backoffice separately with
`bun run dev:backoffice`. On first start Marcus creates its unified user home at `~/.marcus`,
including the internal `api.token`, and writes a one-time bootstrap token to
`~/.marcus/bootstrap.token`; both files have restricted permissions. In another
shell:

```bash
bun apps/marcus-cli/src/index.ts 127.0.0.1:4242 \
  --bootstrap-token-file ~/.marcus/bootstrap.token \
  --command 'bootstrap setup --username admin'
```

The command pauses and displays:

```text
Enter a password for administrator "admin" (press Enter to confirm):
```

Type the new administrator password and press **Enter**. Nothing is displayed
while you type; this is intentional. You do not need to press `Ctrl+D`.

After bootstrap, start the CLI with no arguments:

```bash
bun apps/marcus-cli/src/index.ts
```

Marcus connects to `127.0.0.1:4242` as `admin` by default and displays
`Password for "admin" (press Enter to connect):`. Type the password, then press
**Enter**. Use at least six characters, one uppercase letter and one of `$`,
`%`, `#`, `!`, `&` or `*`. Use `--help` to see every connection and authentication option. For
automation, Marcus accepts `--password-stdin`. The one-time bootstrap token is
deleted after successful setup.

On every interactive login, Marcus immediately checks whether the
`agent.default` model role has an LLM assigned. The console displays the result
before accepting commands. If it is missing, run `config default`; Marcus lists
its OpenAI and DeepSeek presets, asks for API key and model, verifies the
provider and assigns the global role. DeepSeek automatically uses Thinking
`high`, provider-native multi-round tool continuity and JSON Output for both
Marcus AI and agents executed by the Kernel.

Production configuration and integrated service installation live in
[`distribution/`](./distribution/README.md). Marcus does not require an LLM to
boot; providers and model roles are configured independently.

## API and Backoffice

`bun run dev` starts `marcusd` and Marcus API. The API listens on
`http://127.0.0.1:5724`. If `marcusd` is already running, start only the API
with:

```bash
bun run api
```

Override its port explicitly when needed:

```bash
PORT=6724 bun run api
```

Start the canonical Backoffice in a second shell with:

```bash
bun run dev:backoffice
```

`marcusd` provisions `~/.marcus/api.token`; `marcus-api` reads it automatically.
No token copying or local origin variables are required. Leave both processes
running and open
[http://127.0.0.1:6636](http://127.0.0.1:6636) in a browser. Sign in as
`admin` with the password created during bootstrap. API liveness and daemon
connectivity are available at `/health/live` and `/health/ready` respectively.
Press `Ctrl+C` to stop the foreground stack or API.

If `agent.default` is still missing, the Backoffice requires that initial LLM
configuration before exposing the control plane. Its Proveedores section
manages provider health and model roles; Runs aggregates executions across
Projects and exposes their result, trace and cancellation state.

Daemon, API and Backoffice append redacted JSONL records to
`~/.marcus/logs/all.log`. Follow the complete local stream with
`tail -f ~/.marcus/logs/all.log`.

The API and Backoffice always listen on `127.0.0.1`; Marcus does not expose a
public bind option. Put an operator-managed reverse proxy such as Nginx in front
when remote HTTPS access is required.

The Bun-first Next.js application is the canonical Backoffice. With Marcus API
running on port 5724, start it in development mode with:

```bash
bun run dev:backoffice
```

Open [http://127.0.0.1:6636](http://127.0.0.1:6636). For a production build and
server use `bun run backoffice`. Set `MARCUS_API_URL` when the API does not
use `http://127.0.0.1:5724`, and `MARCUS_BACKOFFICE_PORT` to change the Next
listener port. The listener remains fixed to `127.0.0.1`. See the
[Backoffice guide](./documentation/BACKOFFICE.md) for the BFF and migration
boundaries.

## Public website

Run the `projectmarcus.com` landing locally with:

```bash
bun run web
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321). Set
`MARCUS_WEB_PORT` to use another development port. The public site is an
independent `@marcus/web` workspace and does not start or expose the daemon,
API, or Backoffice. It is a Bun-first Next.js App Router application; production
uses `bun run web:production`. Its framework output is the ignored `.next/`
directory and it creates neither a repository `build/` nor `dist/`.

The console journey is data-driven from
`apps/marcus-web/src/data/cli-journey.json`. Tests parse every displayed Marcus
command with the production CLI parser and Playwright verifies the rendered
login, missing-LLM diagnosis, Project flow, agent flow, and `/install` script.
The public site includes a Spanish documentation hub at `/documentacion` with
complete Markdown and MCP examples for Codex and Claude, plus the detailed
`/documentacion/sdk`, `/documentacion/markdown`, and `/documentacion/tools`
references. `/casos-de-uso` maps real operational patterns and `/empresas`
documents local/AWS deployment, governance, the current single-authority
boundary, and Marcus' no-per-agent cost model. LLM clients can discover the
canonical public corpus through `/llms.txt`.

### Public Agent Studio

Agent Studio uses a dedicated loopback Bun gateway; it is not connected to the
daemon or Marcus API. Copy the gateway environment template, set the DeepSeek
key in its private `.env`, and start it beside the website:

```bash
cp apps/marcus-studio-gateway/.env.example apps/marcus-studio-gateway/.env
# Edit apps/marcus-studio-gateway/.env and set MARCUS_STUDIO_DEEPSEEK_API_KEY.
bun run dev:studio
bun run web
```

Open [http://127.0.0.1:4321/studio](http://127.0.0.1:4321/studio). Production
uses `bun run studio` and an operator-managed reverse proxy for
`/api/studio/`. The complete transport, quota, privacy and deployment contract
is in [documentation/AGENT-STUDIO.md](./documentation/AGENT-STUDIO.md).

## Agents

The canonical authoring examples are in [`fixtures/agents/`](./fixtures/agents).
An SDK agent imports `defineAgent` and schemas from `@marcus/sdk`; a Markdown
agent compiles to the same `marcus.agent/v1` manifest. A typical control flow is:

```text
use project <slug>
put local:./agent.ts project:/agents/agent.ts
agent create project:/agents/agent.ts
agent run <agent-id> --input '{"text":"hello"}'
```

Every build registers a new immutable AgentVersion. `agent diff` compares the
active version with its Project source and `agent apply` validates, builds,
registers and activates a new version.

Reusable validators follow the same source-to-version flow:

```text
put local:./validator.ts project:/validators/project-token/index.ts
validator build project:/validators/project-token/index.ts
validator test project/project-token
```

## Distribution

Install the stable public release in the current user's home:

```bash
curl -fsSL https://projectmarcus.com/install | sh
```

On Linux, install and enable the daemon plus API services with:

```bash
curl -fsSL https://projectmarcus.com/install | sudo sh -s -- --system
```

`projectmarcus.com` is the canonical landing and release host. The public
installer selects the correct stable manifest for the current platform and
architecture. Personal installations keep executables, internal Runtime Host
components, configuration and state together below `~/.marcus/`. Add
`~/.marcus/bin` to `PATH` before invoking the installed commands. During a
large release download the installer reports every stage and part, shows an
interactive transfer progress bar and ends with the exact commands for
`marcusd`, bootstrap, `marcus-api`, the CLI and the separately installed
Backoffice.

Build Linux and macOS releases for x64 and arm64 directly into the website's
stable public paths, and execute its installer end to end:

```bash
bun run build:artifact
```

This command does not rebuild the landing: it only replaces the files below
`public/releases/`, whose URLs remain stable. The generated release tree is
disposable and Git-ignored. `bun run package:release` remains an alias for
compatibility. After deployment, verify the real public URLs with
`bun run verify:public-installer --full`. Build and smoke-test the independently
runnable Backoffice archive with `bun run package:backoffice`. Contributors use
`bun run package:changed` before committing so every affected distributable
surface is rebuilt and tested, then repeat it with `--base HEAD^` before pushing
so manifests identify the final commit.

Build the mandatory standalone Windows client from a supported Bun host:

```bash
bun tooling/build-executables.ts --target bun-windows-x64 --client-only
```

Release directories contain `release-manifest.json` and `SHA256SUMS`. The
installer checks platform, protocol versions, byte sizes and SHA-256 before
atomic replacement. A user install leaves configuration and data untouched;
`--system` creates missing configuration, installs the systemd units, and
enables both the daemon and API services without overwriting existing
configuration.

## Operations

Use `doctor` for database, storage, runtime, provider and backup diagnostics.
Online backups are created through `backup create`; restore is deliberately an
offline `marcusd --restore <backup-directory>` operation. The master encryption
key is not copied into normal data backups and must be protected separately.

The REST API exposes OpenAPI at `/api/v1/openapi.json`, browser sessions use
HttpOnly cookies plus CSRF tokens, and live snapshots are available through
`/api/v1/ws` subscriptions.

## Security model

SDK agents are trusted project-owner code. Worker and process profiles provide
supervision and fault containment, not a hostile-code sandbox. Markdown agents
run through first-party managed capabilities. HMAC entrypoints persist hashed
replay fingerprints in SQLite until the signed replay window expires, so daemon
restarts do not reopen an accepted request. See the
[security guide](./documentation/SECURITY.md) for the operational trust model.

Project changes are recorded in [`CHANGELOG.md`](./CHANGELOG.md).

## License

Copyright 2026 Marcus contributors.

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).
