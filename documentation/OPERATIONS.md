# Operations

## Health and diagnostics

- API liveness: `GET /health/live`.
- End-to-end readiness: `GET /health/ready`.
- CLI diagnostics: `doctor`.

`doctor` reports database integrity, important paths, model-role readiness, and
latest backup status. Provider/model readiness is independent from basic daemon
control-plane readiness.

## State and logs

Personal defaults place the database, Projects, builds, logs, runtime files,
bootstrap token, internal API token, secrets key and CLI profiles under the
single `~/.marcus/` directory. System examples place state in
`/var/lib/marcus`, logs in `/var/log/marcus`, runtime files in `/run/marcus`,
and configuration in `/etc/marcus`.

In a personal installation, `marcusd`, Marcus API, the Backoffice and the
optional public Agent Studio gateway append
redacted JSON Lines records to the same file:

```text
~/.marcus/logs/all.log
```

Inspect the complete local control-plane stream with:

```bash
tail -f ~/.marcus/logs/all.log
```

Records include their `source` (`marcusd`, `marcus-api`,
`marcus-backoffice` or `marcus-studio-gateway`), timestamp, level, event message and safe operational
attributes. Passwords, tokens, API keys, cookies and authorization data are
redacted or never included. Custom daemon/API JSON configuration can select a
different `logsDir`; the Backoffice accepts the matching `MARCUS_LOGS_DIR`
process variable for system deployments.

SQLite uses WAL. Treat the database, `-wal`, and `-shm` files as one live state
set; use the Marcus backup operation rather than copying live files manually.

## Backup

Create and inspect backups through the CLI:

```text
backup create --destination /safe/backups/marcus
backup list
backup verify /safe/backups/marcus/<backup-id>
```

Restore is deliberately offline:

```bash
marcusd --config /etc/marcus/marcusd.json --restore /safe/backups/marcus/<backup-id>
```

The restore path is verified and staged before replacement. Back up the secrets
master key separately; without it, encrypted provider/agent secrets cannot be
recovered.

## Shutdown and recovery

SIGINT and SIGTERM trigger daemon/API cleanup. The daemon owns an authority lock
and refuses unsafe concurrent ownership. Investigate the recorded process before
using `--force-recover`. Resident restart policy can recover explicitly
restartable instances; terminal Runs and arbitrary code are not replayed.

The Linux `--system` installer installs and enables both `marcusd.service` and
`marcus-api.service`. Systemd restarts failed processes and applies filesystem
hardening. Existing configuration remains under operator control and is not
overwritten during upgrades. The optional Backoffice is managed separately.

The API socket is always bound to `127.0.0.1`. Public exposure and
TLS termination are outside Marcus and must be provided by an operator-managed
reverse proxy such as Nginx.

The public Studio gateway is a separate loopback process on `127.0.0.1:7447`.
It does not connect to `marcusd`. Its health endpoint is `GET /health/live` and
its SQLite, signing key and encrypted replay key default to
`~/.marcus/studio/`. See [Agent Studio](./AGENT-STUDIO.md) for its reverse proxy,
quota and provider operations.
