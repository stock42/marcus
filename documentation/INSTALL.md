# Installation

## Requirements

- Bun 1.3.14 or a newer compatible Bun 1.x release.
- Linux for the normative daemon and service deployment.
- Git for source development.
- `curl` and Python 3 when using the release installer.

## Run from source

```bash
git clone <repository-url> marcus
cd marcus
bun install --frozen-lockfile
bun run check
```

Start the daemon and API development stack from the repository root:

```bash
bun run dev
```

This starts the daemon and API. The default
personal Marcus home is `~/.marcus/`. The daemon stores its database, Projects,
builds, logs, runtime files, secrets key and internal API token together there.
On first start it creates `~/.marcus/bootstrap.token` and
`~/.marcus/api.token` with restricted permissions. Complete bootstrap in a
second shell:

```bash
bun apps/marcus-cli/src/index.ts 127.0.0.1:4242 \
  --bootstrap-token-file ~/.marcus/bootstrap.token \
  --command 'bootstrap setup --username admin'
```

The command then shows:

```text
Enter a password for administrator "admin" (press Enter to confirm):
```

Type the password you want for `admin` and press **Enter**. Password characters
are hidden, so the terminal appears not to react while you type. This is normal;
do not press `Ctrl+D`. The password must contain at least six characters, one
uppercase letter and one of `$`, `%`, `#`, `!`, `&` or `*`.

When bootstrap reports success, the one-time token file is deleted. You can now
connect with:

```bash
bun apps/marcus-cli/src/index.ts
```

Without arguments, Marcus connects to `127.0.0.1:4242` as `admin` and shows:

```text
Password for "admin" (press Enter to connect):
```

Type the administrator password and press **Enter**. Run
`bun apps/marcus-cli/src/index.ts --help` to see all available connection and
authentication options.

If Marcus reports `LLM: not configured`, enter:

```text
config default
```

The CLI then lists the OpenAI and DeepSeek presets and asks interactively for
provider, API key and model name. The API key is hidden while typing. Marcus
verifies the provider and configures the global `agent.default` role before AI
features are used. The Backoffice enforces the same catalog-driven onboarding
after its first login.

For non-interactive bootstrap, pipe the new password so stdin closes
automatically:

```bash
printf '%s\n' "$MARCUS_ADMIN_PASSWORD" | \
  bun apps/marcus-cli/src/index.ts 127.0.0.1:4242 \
    --bootstrap-token-file ~/.marcus/bootstrap.token \
    --command 'bootstrap setup --username admin'
```

For later non-interactive username/password connections, use
`--password-stdin`. Do not put credentials in command history or `.env.local`.

Legacy `.marcus-data/` directories are not moved automatically. Stop `marcusd`
before copying an existing directory to `~/.marcus`; keep `kernel.db`, its WAL
files and `secrets.key` together.

## Start the API and Backoffice

`bun run dev` starts `marcusd` and Marcus API. Start the canonical Backoffice in
a second shell with:

```bash
bun run dev:backoffice
```

For production, with Marcus API already running, build and start the Backoffice
with `bun run backoffice`. There is no token to copy: the browser talks to the
Backoffice BFF and the Next server contacts the API at its configured local
origin. Leave both processes running and open
[http://127.0.0.1:6636](http://127.0.0.1:6636). Sign in as `admin` with the
password created during bootstrap. Check `/health/live` for the API process and
`/health/ready` for its connection to `marcusd`. Press `Ctrl+C` to stop it.

All three local processes write redacted JSONL operational records to
`~/.marcus/logs/all.log`; use `tail -f ~/.marcus/logs/all.log` while developing
or diagnosing the stack.

For file-based API production configuration, use the examples under
`distribution/config/`. Explicit token and origin settings remain available as
overrides.

## Install a standalone release

`projectmarcus.com` is the canonical public host for the landing, installer and
stable release artifacts. Install Marcus for the current user with:

```bash
curl -fsSL https://projectmarcus.com/install | sh
```

The public bootstrap selects the stable manifest for the current platform and
architecture. The complete personal installation lives below `$HOME/.marcus`:
public commands are in `$HOME/.marcus/bin`, internal Runtime Host components
are in `$HOME/.marcus/lib/marcus`, and configuration plus state remain in the
same portable root. The installer validates target, protocol versions, sizes,
and SHA-256 checksums before atomically replacing binaries. It reports the
detected target, release size, current bundle part, verification, extraction
and installation stage. When stderr is a terminal, each network transfer also
shows curl's progress bar; a multi-minute release download therefore never
looks idle.

Make the installed commands available to the current shell:

```bash
export PATH="$HOME/.marcus/bin:$PATH"
```

The installer prints these next steps when it finishes. Use separate terminals
for the long-running processes.

Terminal 1 — start the daemon and leave it running:

```bash
~/.marcus/bin/marcusd
```

Terminal 2 — complete the administrator bootstrap once:

```bash
~/.marcus/bin/marcus 127.0.0.1:4242 \
  --bootstrap-token-file ~/.marcus/bootstrap.token \
  --command 'bootstrap setup --username admin'
```

After bootstrap returns, use the same terminal to start Marcus API and leave it
running. No extra API configuration is required:

```bash
~/.marcus/bin/marcus-api
```

Terminal 3 — open the interactive CLI:

```bash
~/.marcus/bin/marcus 127.0.0.1:4242 --username admin --password
```

The optional Backoffice is not part of the public CLI/server installer. From a
Marcus source checkout, run it in production mode from the monorepo root:

```bash
bun run backoffice
```

Leave it running and open
[http://127.0.0.1:6636](http://127.0.0.1:6636). A separately distributed
standalone Backoffice archive starts with `package/run.sh`. Add the PATH export
to the appropriate shell profile only if you want it to persist.

On Linux, a root `--system` install also creates the `marcus` service user,
installs missing configuration, installs the systemd units, and enables
`marcusd` plus the API. Existing configuration and data are never
overwritten:

```bash
curl -fsSL https://projectmarcus.com/install | sudo sh -s -- --system
```

Complete the one-time administrator setup after the services start:

```bash
sudo /usr/local/bin/marcus 127.0.0.1:4242 \
  --bootstrap-token-file /var/lib/marcus/bootstrap.token \
  --command 'bootstrap setup --username admin'
```

Both services start automatically on subsequent boots. The API remains bound
to `127.0.0.1`; configure Nginx or another reverse proxy separately if remote
HTTPS access is required. The optional Backoffice is not included in this
installer and has its own installation lifecycle. Release maintainers create
its independently runnable archive with `bun run package:backoffice`; after
extracting it, `package/run.sh` starts the standalone Next server through Bun on
`127.0.0.1`.

For custom mirrors or release testing, the lower-level repository script keeps
the explicit manifest contract:

```bash
sh distribution/install.sh \
  --manifest-url https://projectmarcus.com/releases/stable/linux-x64/release-manifest.json
```

See [Distribution](./DISTRIBUTION.md) and [Operations](./OPERATIONS.md) before a
system deployment.
