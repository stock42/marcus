# Configuration

Marcus uses explicit JSON files, CLI arguments, and documented environment
variables. It does not use `.env.local`.

## Daemon

Start with a JSON file:

```bash
marcusd --config /etc/marcus/marcusd.json
```

Important fields are `nodeId`, `listen`, `dataDir`, `projectsDir`,
`databasePath`, `logsDir`, `runtimeDir`, `buildDir`, runtime executable paths,
`secrets.keyFile`, and `bootstrap.tokenFile`. Source defaults bind MNP to
`127.0.0.1:4242`, disable TLS only for loopback, and place all personal state
under `~/.marcus/`. The daemon also provisions the internal API credential at
`~/.marcus/api.token`; it is stable across restarts and repaired if its managed
file no longer matches an active token.

Supported overrides include:

- `--listen host:port`
- `--bootstrap-token-file <path>`
- `--secrets-key-file <path>`
- `--force-recover`
- `MARCUS_SECRETS_MASTER_KEY`
- `MARCUS_RUNTIME_HOST_EXECUTABLE`
- `MARCUS_AGENT_PROCESS_EXECUTABLE`
- `MARCUS_MANIFEST_LOADER_EXECUTABLE`

Standalone releases discover Runtime Host, Agent Process and Manifest Loader
beside the release or under the installed `lib/marcus` prefix. Explicit JSON or
environment paths still take precedence.

Use either a protected key file or injected master key. Never store the master
key in SQLite or a normal data backup.

## API

Start from the monorepo with `bun run api`, or use
`marcus-api --config <file>` from a standalone release. The loopback listener
defaults to `127.0.0.1:5724`. Main fields are `port`,
`allowedOrigins`, `serviceTokenFile`, request/session
limits, and the upstream daemon host/port. Supported environment overrides are:

- `PORT`
- `MARCUS_ALLOWED_ORIGINS` as a comma-separated list
- `MARCUS_API_SERVICE_TOKEN`
- `MARCUSD_HOST`
- `MARCUSD_PORT`

From source, override the HTTP port without a configuration file:

```bash
PORT=6724 bun run api
```

The API refuses to start without a service-account token. For personal source
and user-prefix installations it defaults to `~/.marcus/api.token`. Same-origin
browser traffic is accepted without configuration. Marcus also permits
`http://127.0.0.1:6636` and `http://localhost:6636` by default so the local
Backoffice can open its authenticated WebSocket directly against the API. Any
custom Backoffice host or port must be listed in `allowedOrigins` or
`MARCUS_ALLOWED_ORIGINS`. Explicit configuration and environment values take
precedence over these loopback defaults.
The listener hostname is not configurable: it is always `127.0.0.1`. Use a
separate reverse proxy when the service must be reachable remotely.

## Global default LLM

On the first interactive CLI login, Marcus reports when `agent.default` is
missing and offers one command:

```text
config default
```

The assistant loads Marcus' provider catalog, asks for `openai` or `deepseek`,
then requests the API key and exact model name. Catalog entries supply the
canonical endpoint and a model default when the provider publishes one. The
daemon persists the key as the encrypted global secret `providers.<name>`,
creates or updates the provider, verifies its `/models` endpoint and assigns
`agent.default` only after a successful probe. A failed replacement attempt
leaves the current working provider and secret unchanged.

The Backoffice performs the same check immediately after login. If no global
default exists, a full-screen configuration gate presents the OpenAI and
DeepSeek presets and prevents access to operational screens until the verified
setup succeeds. Its advanced endpoint field supports an operator-managed
compatible gateway without changing the selected provider profile. The
Proveedores screen can later reconfigure the default, retest providers and
inspect every model-role binding.

### First-party provider catalog

| ID | Canonical endpoint | Structured output | Thinking |
| --- | --- | --- | --- |
| `openai` | `https://api.openai.com/v1` | JSON Schema, JSON Object, prompt fallback | Disabled by default |
| `deepseek` | `https://api.deepseek.com` | JSON Object, prompt fallback | Enabled with `high` effort |

The catalog describes provider-specific behavior; it does not embed API keys.
Custom OpenAI-compatible providers remain supported through the lower-level
`provider add` command.

## Specialized LLM roles

The natural-language Agent creator first resolves the `markdown.compiler`
model role and falls back to `agent.default` when the specialized role is not
configured. Marcus AI always uses `agent.default`. After `config default`, use
the lower-level commands only when a specialized role needs a different model:

```text
role set markdown.compiler --provider <name> --model <model>
```

The provider secret remains in Marcus' encrypted secret store. Next.js and the
browser receive neither that secret nor an internal service-account token.

OpenAI-compatible endpoints do not all implement the same structured-output
extension. OpenAI starts with `response_format: json_schema`, then negotiates
JSON Object and finally a prompt-only fallback only when the provider explicitly
reports the response format as unavailable. DeepSeek starts directly with its
documented `response_format: {"type":"json_object"}` mode. Every JSON request
also contains the word JSON, the requested schema and an example; Marcus retries
one empty structured response with a stronger instruction and validates the
parsed value locally against the schema. Unrelated HTTP 400 responses remain
visible and are not retried.

For DeepSeek, Marcus enables Thinking Mode and `reasoning_effort: high` by
default for `agent.default`. This applies equally to Marcus AI, natural-language
agent generation and model calls made by SDK/Markdown agents in the Runtime
Host. When a tool call occurs, the daemon preserves `reasoning_content` in its
private provider transcript and sends it back on every later request in that
conversation, as required by DeepSeek multi-round tool calling. Raw reasoning
is never included in Marcus API responses, browser state, Run output, audit
events or operational logs. A Marcus AI thread expires after two hours of
inactivity and restarts with visible history after a daemon restart.

## CLI profiles

Profiles are JSON objects with host, port, TLS, CA/server name, username, token
file or token environment name, JSON output, and timeout settings. Use
`--profile <name>`. Override the profile file location with
`MARCUS_CLI_PROFILES`; otherwise Marcus reads `~/.marcus/profiles.json`.

Prefer protected token files or stdin. Do not embed secrets in repository
configuration.

## Public Agent Studio

The independent public gateway defaults to `127.0.0.1:7447` and keeps its
durable anonymous-session state below `~/.marcus/studio`. Start development
with `bun run dev:studio` and production with `bun run studio`. It requires
`MARCUS_STUDIO_DEEPSEEK_API_KEY` in the gateway-owned, Git-ignored
`apps/marcus-studio-gateway/.env`. Bun loads that file automatically from the
workspace. `MARCUS_STUDIO_DEEPSEEK_API_KEY_FILE` remains available for external
secret-file deployments; the gateway never uses `.env.local`.

Origins, session/replay TTLs, provider endpoint/model/timeout, global
concurrency, daily calls and output tokens are configurable through the
`MARCUS_STUDIO_*` variables documented in
[Agent Studio](./AGENT-STUDIO.md#configuración-del-gateway). The hostname is
fixed to loopback. Production HTTPS and WebSocket exposure belong to a reverse
proxy.
