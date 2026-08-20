# Development

## Repository layout

- `apps/`: daemon, API, CLI, Next.js Backoffice, public website, and
  integration tests.
- `packages/`: reusable contracts, Kernel, storage, service, runtimes, SDK, and
  supporting libraries.
- `tooling/`: dependency-boundary, source-export, fixture-parity, and standalone
  build checks.
- `distribution/`: installer, uninstaller, config, and systemd examples.
- `fixtures/`: canonical SDK and Markdown agent inputs used by tests.
- `documentation/`: maintained product documentation.
- `private/`: local, Git-ignored specs, plans and non-public material; never
  ship it or use it as end-user documentation.

## Toolchain

Marcus is Bun-first and ESM-only. Workspaces export TypeScript source. TypeScript
runs with strict settings and `noEmit`. `dist/` is forbidden everywhere,
including browser applications. Browsers still need framework transforms
because they do not execute TypeScript source. Both browser applications use
only Next.js' native ignored `.next/` output.

```bash
bun install --frozen-lockfile
bun run verify:public
bun run verify:no-dist
bun run verify:boundaries
bun run typecheck
bun run test
bunx playwright install chromium
bun run test:browser
bun run build
bun run verify:build
bun run check
```

Run only the public website development server with `bun run web`; it listens
on `127.0.0.1:4321` unless `MARCUS_WEB_PORT` is set. This task is independent
from the daemon/API development stack. Use `bun run web:production` to build and
run the same website through `next start` under Bun.

Run only Marcus API with `bun run api`; it listens on `127.0.0.1:5724` by
default. `PORT=6724 bun run api` changes the port for that process. The daemon
must already be running so the API can use the managed token and MNP upstream.

Browser changes must run `bun run test:browser`. The Backoffice scenario tests
the production Next server. A disposable daemon/API stack on loopback verifies
anonymous login, browser sessions,
Project creation, Project file listing, and revision-aware writes through the
semantic BFF. Each stack uses an isolated temporary data directory and
ephemeral test credentials, then removes it on shutdown. The test fails on
unsuccessful flow responses, unhandled page exceptions, or browser console
errors. Install the managed browser once with
`bunx playwright install chromium`; no running application service or user
credential is required.

The website scenario starts its production Next server, verifies that
`/install` is a POSIX shell script rather than landing HTML, walks every visible
CLI stage, and checks desktop console stability plus narrow-viewport overflow.
Its transcript data is also validated with the real `@marcus/cli` parser during
unit tests.

Use `bun test ./path/to/file.test.ts` for a focused test. The root test command
runs workspace tests and tooling fixtures. Integration tests exercise real
temporary daemon, MNP, Runtime Host, and SQLite paths.

## Architecture rules

Apps do not import other apps. Shared code lives in packages. Contracts remain
dependency-free; CLI/API cannot bypass the service boundary; S42-Core is API
only; browser code cannot import Bun/Node server APIs; third-party runtime
dependencies require an explicit architectural decision.
The currently accepted third-party API boundary for MCP is recorded in
[ADR-001](./ADR-001-MCP-SDK.md); its dependency exceptions are intentionally
exact and workspace-scoped in `tooling/verify-boundaries.ts`.

## Change workflow

Read `AGENTS.md`. Before editing, inspect status and run `git pull --ff-only`.
Preserve unrelated work, keep scope narrow, update the relevant file in
`documentation/`, update root `CHANGELOG.md`, run proportional validation, and
run `bun run package:changed` before committing the complete change directly on
local `main`. Repeat it as `bun run package:changed --base HEAD^` after the
commit so release manifests contain its definitive SHA. Push every commit to
`origin/main` and verify both refs are synchronized. Publishing packages,
tagging, and deployment still require a separate explicit request.

Never create `.env.local`, expose credentials, weaken tests, or claim a command
passed without running it in the current checkout.

## Public repository gate

Before changing repository visibility, run `bun run verify:public`. It rejects
tracked private/runtime material, likely credential signatures, escaping
symlinks, publishable internal workspaces, incomplete SDK metadata and a
populated Studio key example. Repository visibility and npm publication are
separate operations.
