# Distribution

## Build artifacts

```bash
bun run build:artifact
```

This cross-compiles every supported server target, writes the deployable release
tree inside the website, and installs the Linux release through a disposable
HTTP server before it succeeds:

```text
apps/marcus-web/public/
├── install
└── releases/stable/
    ├── linux-x64/
    ├── linux-arm64/
    ├── darwin-x64/
    └── darwin-arm64/
```

Each target contains its manifest, checksums, lower-level installer, and
24 MiB release-bundle parts suitable for Cloudflare static hosting. The installer verifies
each part, reassembles and verifies the complete bundle, then verifies all six
executables before installation. The generated `public/releases/` directory is
ignored by Git because the website deployment recreates it from source.

The command serves only the installer and release tree on a disposable loopback
address and runs the same `curl | sh` bootstrap shown by the landing. It fails
unless all six executables are downloaded, checksum-validated, installed and
executable. It does not compile or restart Next because every release URL is
stable and the static files can be replaced independently.
`bun run package:release` remains a compatibility alias for the same command.
`bun run build:executables` remains available as the lower-level current-target
builder under `artifacts/executables/`.

Every executable is built with `bun build --compile`, minification, and dotenv/
bunfig autoload disabled. This is a release boundary only; packages continue to
execute TypeScript source directly during development.

## Cross-build the Windows client

```bash
bun tooling/build-executables.ts --target bun-windows-x64 --client-only
```

Windows defaults to the CLI-only profile unless server inclusion is explicitly
requested. The client release also produces a zip archive.

## Manifest contract

The release manifest records product version, Git commit, Bun/Turbo versions,
target, artifact byte sizes and SHA-256 hashes, SDK version, and protocol
versions. Set `MARCUS_RELEASE_COMMIT` only in a controlled release pipeline when
the source checkout cannot provide the commit itself.

## Installation and removal

The canonical public distribution contract is:

```bash
curl -fsSL https://projectmarcus.com/install | sh
```

The bootstrap endpoint selects its manifest from
`https://projectmarcus.com/releases/stable/<platform>-<architecture>/`.
`projectmarcus.com` also hosts the project landing page.

`distribution/install.sh` is the lower-level installer used by that public
bootstrap. It downloads only bundle parts enumerated by an explicit manifest,
verifies both the parts and complete archive, and replaces files atomically
after validating every extracted artifact. By default, a personal install puts
public executables in `~/.marcus/bin`, internal executables in
`~/.marcus/lib/marcus`, and keeps them beside the configuration and state
already rooted at `~/.marcus`. A custom `--prefix` remains available for
mirrors and controlled installation tests. The bootstrap and delegated
installer write named progress stages to stderr; interactive terminals also
receive a curl progress bar for the manifest, installer and every release
part. The success output gives exact daemon, bootstrap, API, CLI and separate
Backoffice commands. On Linux, the public `--system` command is:

```bash
curl -fsSL https://projectmarcus.com/install | sudo sh -s -- --system
```

System installation creates the service user, installs missing configuration,
installs the verified systemd units, and enables the daemon plus API services.
It never overwrites existing configuration or data. The API service remains
loopback-only; remote publication requires a
separately managed reverse proxy.

The main release deliberately contains no Backoffice. The optional UI has an
independent version and installation lifecycle. Build its runnable package with:

```bash
bun run package:backoffice
```

The platform-specific archive and checksums are written to
`artifacts/backoffice/`. It contains the traced Next standalone runtime and
static assets, requires Bun but no repository checkout or dependency install,
and always binds to `127.0.0.1`. Packaging extracts the archive and starts that
exact payload as a smoke test before reporting success.

Contributors run `bun run package:changed` before every commit that affects a
distributable surface. The command derives the required release, Backoffice,
SDK and website jobs from the current Git diff. After creating the commit, run
`bun run package:changed --base HEAD^` before pushing so generated manifests
identify the definitive source commit.

After deploying the public tree, verify the actual domain:

```bash
bun run verify:public-installer --full
```

This is intentionally separate from build validation: it proves that
`projectmarcus.com` serves the shell bootstrap and matching release artifacts,
then installs them from the public URLs.
`distribution/uninstall.sh` removes binaries/services while preserving data and
configuration by default. Data purge requires both `--purge` and the exact
confirmation string. Never exercise purge as a smoke test.

`@marcus/web` builds Next independently from the release artifacts. Run
`build:artifact` whenever binaries change, then publish or synchronize the
generated `public/releases/` tree without rebuilding the landing. Building
locally still does not deploy, tag, or publish anything.
