# Contributing to Marcus

Marcus is Bun-first, ESM-only and TypeScript-native. Read `AGENTS.md` before
changing the repository; it contains the authoritative workflow and
architecture boundaries.

## Setup

Requirements: Bun 1.3.14 or a compatible newer 1.x release, Git and Linux for
the normative daemon/runtime behavior.

```bash
bun install --frozen-lockfile
bun run verify:public
bun run check
```

Use a focused branch in a fork for external contributions and open a pull
request against `main`. Explain the behavior change, security impact and exact
validation executed. Do not include generated `.next/`, artifacts, runtime
state, credentials or anything below the ignored `private/` directory.

## Code and documentation

- Keep Bun-native TypeScript source; do not add `dist/` or a parallel package
  manager.
- Preserve the daemon/API/CLI boundaries and server-side authorization.
- Add or update focused tests with every behavior change.
- Update the affected file under `documentation/` and root `CHANGELOG.md`.
- Run `bun run package:changed` when a distributable surface changes.

Only `@marcus/sdk` is designed for npm publication. Publishing, tagging,
deployment and repository visibility changes remain maintainer operations.
