# Model Context Protocol

Marcus exposes an administrator MCP server so a development agent such as
Codex or Claude Code can inspect the operating system, read the official
documentation, plan an agent, write its source, compile it and verify it against
the real Runtime.

The local endpoint is:

```text
http://127.0.0.1:5724/mcp
```

It implements stateless Streamable HTTP. Each request carries a dedicated
global MCP bearer token and is reauthenticated by `marcusd`; the API does not
cache the administrator authority between requests.

## Create an access token

1. Start `marcusd`, Marcus API and the Backoffice.
2. Open `General` in the Backoffice.
3. Under `Model Context Protocol`, select `Crear token MCP`.
4. Give the integration a recognizable name and optionally an expiration.
5. Copy the secret immediately. Marcus stores only its hash and cannot display
   it again.

This credential has global administrator authority. Use one token per machine
or integration, do not place it in a repository and revoke it as soon as it is
no longer required. The Backoffice shows status, creation, last use, optional
expiry and immediate revocation.

## Connect Codex

Keep the value outside the configuration file:

```bash
export MARCUS_MCP_TOKEN='the-one-time-value'
```

Add this server to `~/.codex/config.toml`:

```toml
[mcp_servers.marcus]
url = "http://127.0.0.1:5724/mcp"
bearer_token_env_var = "MARCUS_MCP_TOKEN"
```

Restart the Codex client after changing its MCP configuration. Ask it to list
Marcus resources or Projects before starting an authoring task.

## Connect Claude Code

Export the same environment variable, then register the HTTP server:

```bash
export MARCUS_MCP_TOKEN='the-one-time-value'
claude mcp add --transport http marcus http://127.0.0.1:5724/mcp \
  --header "Authorization: Bearer $MARCUS_MCP_TOKEN"
```

## Recommended workflows

### Markdown agent

1. Select the `create-markdown-agent` MCP prompt.
2. Provide the exact Project ID and the complete business brief.
3. The client calls `documentation_bundle` with `bundle: "markdown"` and then
   calls `agents_plan` without modifying the Project.
4. Review the proposed contract, tools, files, tests and risks.
5. After explicit approval, the client calls `agents_generate_markdown`.
6. Verify the result with `agents_get`, `agents_versions` and `agents_diff`.
7. Invoke only safe test cases through `runs_invoke` and inspect the resulting
   Run.

### TypeScript SDK agent

1. Select the `create-typescript-agent` MCP prompt.
2. The client calls `documentation_bundle` with `bundle: "sdk"` to receive
   `SDK.md`, `RUNTIME.md`, `SECURITY.md` and `DEVELOPMENT.md`, then calls
   `agents_plan` with `sourceKind: "sdk"`.
3. Review the plan before allowing writes.
4. The client writes Bun-native TypeScript below
   `project:/agents/<slug>/index.ts` with `files_write`.
5. `agents_build` compiles, versions and activates the source as an SDK agent.
6. `agents_get` and `agents_versions` verify the active immutable version.
7. `runs_invoke`, `runs_get` and `logs_list` close the test loop.

Use `expectedRevision` when replacing an existing file. Read the current source
first and never assume that a prior MCP response still represents the active
revision.

### Project API tokens for agents

The administrator MCP can manage the Project tokens accepted by Agent API
entrypoints. At least one active agent in the Project must have API access
enabled before creating the first token.

| MCP tool | Purpose | Secret handling |
| --- | --- | --- |
| `project_tokens_list` | List token IDs, labels, scopes, status and timestamps. | Never returns a bearer. |
| `project_tokens_get` | Read the metadata for one token ID. | Never returns a bearer. |
| `project_tokens_create` | Create a `runs.invoke`/`runs.read` token with label and optional expiry. | Returns the bearer exactly once. |
| `project_tokens_update` | Change the label, expiry, or clear expiry with `expiresAt: null`. | Cannot change or reveal the bearer or scopes. |
| `project_tokens_delete` | Immediately revoke the token. | The bearer stops authenticating; metadata remains for audit. |

Creation example:

```json
{
  "projectId": "prj_...",
  "label": "CRM production",
  "expiresAt": "2027-01-31T23:59:59.000Z"
}
```

Copy the returned bearer directly to its authorized secret store. Do not paste
it into prompts, source files or a later MCP call. Marcus persists only its
hash, so neither `project_tokens_get` nor `project_tokens_list` can recover it.

Metadata update example:

```json
{
  "projectId": "prj_...",
  "tokenId": "tok_...",
  "label": "CRM production rotated",
  "expiresAt": null
}
```

The bearer value and scopes are immutable. Rotation is an explicit two-step
operation: create a replacement, install it in the client, then call
`project_tokens_delete` for the old token after confirmation. “Delete” means
irreversible revocation rather than erasing the audit record.

## Capabilities

The server publishes 59 explicit tools rather than a generic API proxy:

- system and discovery: health, doctor, global overview, unified redacted logs,
  global search and official documentation list/read/search/bundle. The
  `markdown`, `sdk`, `operations` and `all` bundles return the complete official
  source documents needed for that task in one call;
- Projects: list, detail, metrics, creation, permanent deletion, membership
  inspection and complete Agent API token lifecycle;
- Project files: list, case-insensitive content search, read, revision-aware
  write, directory creation, move, copy and recoverable trash;
- agents: catalog, detail, immutable versions, compiled artifacts, source diff,
  AgentVersion tool discovery with complete schemas and policies,
  planning, Markdown generation, SDK/Markdown build, apply, API access and
  resident start/stop;
- execution: Run list/detail/invoke/cancel, process list/kill, approvals,
  schedules, structured Project logs and audit;
- configuration: provider catalog/configuration/model discovery/probe, model
  roles and backups.

It also publishes the `marcus://projects` resource, a dynamic
`marcus://documentation/{name}` resource and three prompts:
`plan-agent`, `create-markdown-agent` and `create-typescript-agent`.

## Authorization and audit

The token endpoint and the MCP endpoint have different boundaries:

- an authenticated system administrator creates, lists and revokes MCP tokens;
- only a dedicated active MCP token can authenticate `/mcp`; an ordinary
  personal access token is rejected even if its user is an administrator;
- token values are hashed in SQLite and their owning user must remain active;
- expiration and revocation are checked on every HTTP request;
- every tool delegates to the existing MNP operation and therefore retains
  capability checks, Project scope, validation, immutable AgentVersion rules
  and mutation audit;
- tool annotations mark read-only, mutating and destructive operations so the
  client can require explicit approval. Project deletion, process termination,
  Run cancellation and file trash remain destructive regardless of the MCP
  client's UI.

Provider keys, browser cookies and persisted plaintext secrets are never
returned through MCP. A newly created Project token is the sole exception: its
bearer is returned once by `project_tokens_create`, then only its hash and
metadata remain. `system_logs` reads a bounded tail of
`~/.marcus/logs/all.log`, which is already redacted by the shared logging layer.

Marcus API binds only to `127.0.0.1`. If an operator deliberately makes MCP
remote, TLS, origin validation, network access control and rate limiting belong
to the operator-managed reverse proxy. Never publish the local endpoint
directly to the Internet.
