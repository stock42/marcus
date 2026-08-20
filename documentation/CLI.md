# Marcus CLI

`marcus` is a persistent MNP/1 client. It supports an interactive REPL and a
one-shot `--command` mode.

## Connect

```bash
bun apps/marcus-cli/src/index.ts
```

With no arguments, Marcus connects to `127.0.0.1:4242` as `admin` and asks:

```text
Password for "admin" (press Enter to connect):
```

Type the password even though no characters appear, then press **Enter**. When
using an installed executable, the equivalent command is simply `marcus`.
Display every CLI option without connecting or authenticating with:

```bash
marcus --help
```

After authentication, the first daemon request is `system.doctor`. Marcus checks
whether `agent.default` has an LLM assigned and displays either
`LLM: configured (agent.default)` or an actionable configuration warning before
accepting commands. A missing LLM does not close the console because the same
session is needed to add the provider and assign the model role.

When no default LLM is configured, run the interactive assistant shown by the
console:

```text
config default
```

It lists Marcus' OpenAI and DeepSeek presets, asks which provider to use, reads
the API key with hidden input and requests the exact model name. The catalog
supplies the canonical endpoint and, for DeepSeek, the documented default model.
Marcus stores the key in its encrypted global SecretStore, verifies the provider
through `/models`, and only then assigns `agent.default`. The individual
`secret`, `provider` and `role` commands remain available for custom compatible
endpoints or specialized role configuration.

Override the defaults or use a non-interactive password when needed:

```bash
marcus 192.0.2.10:4242 --username operator
printf '%s\n' "$MARCUS_PASSWORD" | \
  marcus 127.0.0.1:4242 --username admin --password-stdin --command doctor
```

Other safe authentication channels are `--token-stdin`,
`--bootstrap-token-file`, profile `tokenFile`, and a profile-selected token
environment variable. Inline token/password flags should not be used in
automation because process arguments and shell history may expose them.

## First administrator

When `bootstrap setup --username <name>` runs in a terminal, Marcus explicitly
asks for the new administrator password. Type it even though no characters are
shown, then press **Enter** to confirm. The command no longer requires
`Ctrl+D`; EOF-based input is reserved for non-interactive pipes. New passwords
must contain at least six characters, one uppercase letter and one of `$`, `%`,
`#`, `!`, `&` or `*`; marcusd applies the same rule to administrators and
Project users created later.

## Project context and files

```text
project list
project create demo --name "Demo"
use project demo
pwd
ls
put local:./agent.ts project:/agents/agent.ts
get project:/artifacts/result.json local:./result.json
sync push ./agents project:/agents --watch
```

Logical Project paths are normalized and cannot escape the Project Home.
Destructive-looking file commands use Marcus trash by default and can be
restored with `file restore <trash-id>`.

## Agents and Runs

```text
agent scaffold ./hello --kind sdk
agent create project:/agents/hello/index.ts
agent list
agent contract hello
agent run hello --input '{"name":"Ada"}' --idempotency-key request-1
run list
run show <run-id>
run attach <run-id>
run cancel <run-id>
```

Building from Project source registers a new immutable AgentVersion and
activates it unless `--no-activate` is specified.

## Administration

The command language also covers users and tokens, Project members, providers
and model roles, secrets, validators, schedules, processes, messages, events,
approvals, artifacts, audit, backups, and `doctor`. Authorization is enforced by
the daemon for every operation; seeing a command in `help` does not grant access.

Use `--json` for machine-readable output. One-shot mode maps typed Marcus errors
to stable non-zero exit codes for connection, authentication, RBAC, validation,
not-found, conflict, and timeout failures.
