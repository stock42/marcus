# Marcus distribution

The release directory contains separate `marcus`, `marcusd`, `marcus-api`,
`marcus-runtime-host`, and `marcus-agent-process` executables, the internal
`marcus-manifest-loader`, `release-manifest.json`, and
`SHA256SUMS`.

`projectmarcus.com` is the canonical landing and public release host. The stable
user installation contract is:

```bash
curl -fsSL https://projectmarcus.com/install | sh
```

The public bootstrap resolves release manifests below
`https://projectmarcus.com/releases/stable/<platform>-<architecture>/` and uses
this directory's `install.sh` as its lower-level installer. `install.sh` keeps
an explicit `--manifest-url` option for mirrors and release validation. It
verifies each published bundle part, the reconstructed archive, and every
selected artifact before an atomic replacement. A user-prefix install never
changes configuration or data. A Linux `--system` install creates only missing
configuration and never overwrites existing configuration or data.
The default personal prefix is `~/.marcus`, so public commands live in
`~/.marcus/bin` and internal runtime executables in `~/.marcus/lib/marcus`
beside the user's Marcus configuration and state. The installer prints the
`PATH` export needed by the current shell and never edits shell profiles.
`uninstall.sh` removes binaries and services while preserving configuration and
data by default. Purging requires the exact confirmation documented by its
`--purge --confirm` options.

For a complete Linux service installation, run the installer as root with
`--system`:

```bash
curl -fsSL https://projectmarcus.com/install | sudo sh -s -- --system
```

It:

1. Creates the dedicated `marcus` user when it does not exist.
2. Installs missing configuration under `/etc/marcus`.
3. Installs and enables `marcusd.service` and `marcus-api.service`.
4. Starts the daemon and API.

Read `/var/lib/marcus/bootstrap.token` locally for the one-time
`bootstrap setup` operation. The daemon removes it after setup and manages the
API credential at `/var/lib/marcus/api.token` without operator copying.

```bash
sudo /usr/local/bin/marcus 127.0.0.1:4242 \
  --bootstrap-token-file /var/lib/marcus/bootstrap.token \
  --command 'bootstrap setup --username admin'
```

Both services remain enabled for subsequent boots. The API always binds to
`127.0.0.1`; configure a separate reverse proxy such as Nginx if remote HTTPS
access is required.

The Backoffice is not part of this release or installer. It has an independent
version and installation lifecycle, connects to the local API, and binds its
own listener only to `127.0.0.1`. `bun run package:backoffice` creates and smoke
tests its independently runnable Next standalone archive under
`artifacts/backoffice/`. Publishing that archive remains a distinct release
operation documented in `documentation/BACKOFFICE.md`.

The secret master key at `/var/lib/marcus/secrets.key` is generated with mode
`0600`. Back it up separately from normal data backups. Losing it makes stored
provider and agent secrets unrecoverable.
