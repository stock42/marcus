# Backoffice

Marcus uses a single Bun-first Next.js App Router application:
`@marcus/backoffice`. The current surface covers login/session, global LLM
onboarding, Projects, Agents, Files, Markdown editing, uploads, Runs,
Runtime operations, unified logs, global search, Agent Studio,
Providers/model roles, global administration, Project users and Marcus AI.
There is no legacy browser client.

## Next.js architecture

Next runs exclusively through Bun:

```text
Browser ── semantic HTTP commands ── Next BFF ──┐
Browser ── one authenticated WebSocket ─────────┼── Marcus API ── MNP/1 ── marcusd
Next Server Components ── direct HTTP reads ────┘
```

- Server Components read Marcus API directly. They do not call the local Route
  Handlers and therefore avoid an unnecessary internal HTTP hop. Project,
  agent and file detail pages follow this path.
- Route Handlers form a semantic BFF only for browser session state and UI
  actions. The implemented paths are `/api/session`, `/api/session/login`,
  `/api/session/logout`, `/api/projects`, Project deletion, files, resumable
  uploads, agent generation, Agent API activation, Project metrics/tokens,
  Agent input-example/test-case requests, Runs, provider tests, global LLM
  configuration, MCP token management, Agent planning and `/api/assistant`, plus
  administrator and Project-member mutations.
- There is no catch-all REST proxy. Forwarded request headers are allowlisted to
  the Marcus session cookie, CSRF token, and idempotency key.
- Next has no service-account token or credential capable of bypassing Marcus
  API policy. Authentication, RBAC, CSRF, contracts, and persistence remain
  authoritative in Marcus API and marcusd.
- `/api/v1/ws` must be routed directly from an operator-managed Nginx or
  equivalent reverse proxy to Marcus API. WebSockets do not pass through Next
  Route Handlers.

## Realtime operating contract

The browser opens at most one lazy WebSocket per document and multiplexes every
active screen subscription over it. The same HttpOnly Marcus session cookie
authenticates the upgrade; credentials are not copied into a URL, React state or
browser storage. Reconnect uses bounded exponential backoff, re-subscribes the
current reads and exposes `EN VIVO`, `CONECTANDO` or `SIN CONEXIÓN` in the
persistent header.

HTTP POST/PATCH/DELETE remains the command boundary. Long-running Agent
generation, planning, file editing, test Runs and Marcus AI calls return an
accepted identifier immediately. Their operational phases, safe tool names,
provider/model identity, compiler work, errors and final result arrive only by
WebSocket. Raw provider chain of thought and secret-bearing tool arguments are
never published; the UI shows useful operational reasoning summaries instead.

Subscriptions are event-driven from persisted Kernel events and daemon-owned
Agent activities; no browser interval polls Runs, generation progress, stats or
logs. `Centro de control`, Project dashboard, Runs, Run detail, Runtime and Logs
update in place and show the timestamp of the latest event plus an explicit
reconnect action when delivery is interrupted.

The complete current shadcn catalog is installed as editable source under
`apps/marcus-backoffice/src/components/ui/`. Marcus uses only the
components required by each screen; unused components remain available for the
next migration slices without introducing a black-box UI dependency.

## Enterprise visual system

The Backoffice uses one restrained control-plane design system across login,
navigation, operating screens, configuration and Marcus AI. Neutral graphite
surfaces establish hierarchy; Marcus green is reserved for primary actions,
focus and healthy state instead of decorating every surface. Cards are opaque,
corners and shadows are controlled, headings use an administrative scale and
tables use stable headers, tabular alignment and explicit row separation.

Shared shadcn primitives define the spacing, focus, hover, disabled, overlay and
responsive behavior. This keeps forms, dialogs, tabs, cards and data tables
consistent as new enterprise workflows are added. The browser document owns
vertical page scrolling; ordinary cards, log lists and Run payloads do not
create competing vertical scroll regions. A modal, source editor or full-screen
assistant may retain its own bounded scroll only while it is an isolated
interactive surface.

## Control-plane information architecture

The signed-in administrator lands on `Centro de control`, not a resource list.
It combines installation health, exact Project/file/agent counts, Runs and
failures from the last 24 hours, active processes, pending approvals, a 14-day
activity chart and recent Runs. Signals link directly to the operating surface
where they can be investigated.

The primary navigation is separated by intent:

- `Operación`: overview, Projects and Agent Studio. Files and Agents remain
  inside their owning Project instead of appearing as global destinations;
- `Runtime`: Runs, processes, human approvals, schedules and administrator-only
  unified logs;
- `Configuración`: administrator credentials, MCP access, providers and model
  roles.

Global search is a transversal action in the persistent header beside Marcus
AI. It is available from every control-plane screen without competing with the
sidebar's destination hierarchy.

`Runtime` aggregates every visible active Project. Operators can terminate a
live process, approve or reject a pending decision, and manually trigger a
declared schedule after an explicit confirmation. `Logs` reads the newest
redacted JSONL events from `~/.marcus/logs/all.log` and filters by component,
level or arbitrary operational text. Events render as one semantic table in the
normal document flow, so the browser remains the only vertical scrollbar.
`Buscar` resolves Projects, agents, Runs, Project file matches and official
documentation without indexing credentials.

`Agent Studio` separates architecture from implementation. It asks the
configured model for a non-mutating, structured plan with inputs, outputs,
tools, files, implementation steps, test cases and risks. An approved Markdown
plan can enter the existing generation/validation/compilation flow. While that
work runs, an activity console below the action shows timestamped requirement
analysis, provider/model requests, contract normalization, compiler passes,
managed file writes, immutable builds and activation. It exposes operational
summaries and actual tool names without leaking private model chain-of-thought.
Failures retain the real Marcus error code and message in the same console. A
TypeScript SDK plan produces a ready-to-use Marcus MCP prompt for Codex or
Claude Code, keeping source authorship in the developer agent and compilation
authority in Marcus.

## Project and agent workflow

Every active Project card opens a tabbed detail page. `Dashboard` shows exact
file/agent totals, API-enabled agents, Runs in the last 30 days, a daily
consumption chart and recent root files. `Agentes`, `Usuarios` and `Tokens`
separate the operational catalog, memberships and API credentials.
From that page an operator can:

- inspect an agent, its source path and immutable version history. Every
  Markdown version exposes `Ver compilado`, with the manifest JSON, generated
  TypeScript and exact runtime JavaScript kept together in one read-only view;
- open text source in the editor, with Markdown preview and optimistic revision
  checks on save. Nested files load their revision through the authoritative
  `files/stat` route rather than guessing from the root listing. Markdown
  source editing highlights frontmatter, headings,
  prose, lists, quotes, fenced delimiters and code while preserving the native
  editable textarea and its keyboard behavior. Saving a registered Agent source
  stores a draft and marks it `Dirty`; it does not silently replace the active
  production version. Agent detail then exposes `Usar esta edición`, which
  validates and compiles the draft, creates an immutable AgentVersion and
  activates it. A failed validation leaves the previous version active. The
  editor provides a contextual return action to the owning Agent, or to the
  Project file catalog for ordinary files;
- open `Agente AI` from any `.agent.md`, describe a change in natural language
  and let Marcus read and overwrite only that exact file. This mode receives no
  other tools, preserves unrelated source, validates the resulting Markdown,
  reloads the committed revision, registers an immutable AgentVersion and
  activates it immediately. The Agent detail history therefore reflects every
  successful AI edit and displays both its date and local time;
- enable or disable API access from a Markdown Agent detail without manually
  editing frontmatter. Marcus updates `api-enabled`, validates the source,
  creates and activates an immutable version, then shows the exact Marcus API
  endpoint and authentication mode. The configured `agent.default` LLM builds
  a complete synthetic request body constrained by the active input schema;
  the browser never sends it a Project token and falls back to a deterministic
  schema example when the provider is unavailable. The resulting `curl` is
  copyable and keeps the credential as `$MARCUS_TOKEN`;
- open `Test case` from the same API card, inspect the complete active input
  and output contracts, edit the generated JSON and invoke the real Agent API
  endpoint. Public and `marcus-token` contracts reuse the authenticated
  Backoffice session and CSRF boundary, so no plaintext Project token is read
  or stored by the test UI. The Backoffice translates queued, startup, running
  and waiting states into operational language and follows the Run over the
  shared WebSocket until it can show the final Agent output. A direct link
  always opens the durable Run detail;
- create and revoke Project API tokens once at least one active agent exposes
  an API entrypoint. The plaintext token is displayed only once. Stored token
  rows show label, opaque ID, status, creation/last-use timestamps and optional
  expiry;
- upload a local file up to 100 MiB using the native Marcus
  open/chunk/commit protocol;
- create Project-scoped login identities, inspect their effective role, update
  username/password/role and delete their membership. Passwords are never read
  back, and deleting a membership does not alter unrelated Project access;
- describe an agent in natural language. The API asks the configured
  `markdown.compiler` role (or `agent.default` fallback) for deterministic
  Markdown, canonicalizes the generated frontmatter to
  `schema: marcus.agent/v1`, validates and compiles it, stores it below
  `project:/agents/<slug>.agent.md`, and activates the result;
- permanently delete a Project. Marcus deletes its agents, versions, Runs,
  secrets, indexed files, memberships and audit/event records in one
  authoritative operation. A managed Project Home is deleted from disk; a
  linked external directory is preserved because Marcus does not own it.
  Active Runs must be cancelled before deletion. Historical Project audit and
  event rows are removed; Marcus records only a global audit event for the
  deletion operation itself.

Binary files are listed and uploadable but are not opened in the text editor.

Each API-enabled Agent links to a dedicated `Test case` screen instead of
opening a modal. The page keeps the active input/output schemas visible in the
normal document flow, asks `agent.default` for a synthetic example constrained
by the active input contract and falls back to a deterministic schema-derived
value when the provider is unavailable. The JSON editor is not shown empty: it
appears only after the example is ready, can be edited or regenerated, and
executes the real Agent endpoint. Run state and final output return through the
shared WebSocket. Markdown schema blocks accept both the canonical `object:`
shape and concise top-level property declarations generated by Marcus AI.

While a natural-language request runs, the creation dialog subscribes to its
private activity over the shared WebSocket and appends the daemon's actual
phases: requirements analysis, provider/model generation, contract
normalization, compiler validation, one bounded assisted repair when needed,
immutable version creation and activation. It does not fabricate tool calls or
expose provider reasoning. The daemon keeps the latest 48 timestamped activity
entries for the authenticated owner. Agent Studio, Project generation, the
Markdown editor and Marcus AI render that same structured history, including
internal operation names and the real error code/message when work fails.

## Providers and mandatory onboarding

After every global-administrator load, the control layout asks Marcus API for
`/api/v1/config/default-llm` and `/api/v1/providers/catalog`. When
`agent.default` is absent, a full-screen gate requires choosing the OpenAI or
DeepSeek preset, API key and model before the remaining Backoffice can be used.
An advanced endpoint override supports compatible private gateways. Marcus API
forwards the operation to marcusd, which encrypts the key, probes `/models` and
assigns the global role.

The Proveedores screen separates `Catálogo`, `LLM predeterminado` and `Roles de
modelo` into task-oriented tabs. It lists endpoint, health, capabilities and
model-role assignments without returning secret values. Operators can rerun a
provider probe or replace the verified global default without mixing those
tasks into one long configuration page.

## General settings and Project users

The administrator-only `General` screen separates `Administradores`, `Mi
contraseña` and `Acceso MCP` into tabs. It lists global administrators, creates
a new administrator and changes the signed-in administrator password after
verifying the current value. Bootstrap, administrators and Project users share
one daemon-enforced password policy: six or more characters, at least one
uppercase letter, and at least one of `$`, `%`, `#`, `!`, `&` or `*`.

The same screen manages global MCP administrator tokens. It shows the local
Streamable HTTP endpoint, copyable Codex and Claude Code configuration, active,
expired and revoked token metadata and the last-use timestamp. A token secret
is displayed once, stored only as a hash and can be revoked immediately. See
[Model Context Protocol](./MCP.md) for the complete authoring workflow and tool
catalog.

Project detail owns the separate membership CRUD. Creation makes a non-system
identity and its first membership in one database transaction. Editing can
change username, role and optionally password. Identities shared by another
Project or carrying a system role cannot be rewritten through a Project-local
operation. Removing access deletes only the selected membership. CRUD controls
are shown only to global administrators and the Project owner; every other
Project role receives a read-only membership list, matching daemon RBAC.
Global administrators are excluded from this collection because their access
already applies to every Project and is managed separately under `General`.

Marcus API returns the current caller's safe ID, username and system roles in
session status. The Backoffice uses that result to keep global configuration
out of Project-user navigation. This is only UX: marcusd still enforces every
operation. Project listing is filtered in the daemon, so a Project user sees
only explicit memberships.

## Runs

The Runs screen aggregates the latest Runs from every visible active Project,
resolves their Project and Agent names, and updates state, entrypoint and
admission time over the shared WebSocket. Each Run detail receives state,
output, typed error, trace/correlation IDs, version identity and duration in
place. Non-terminal Runs expose a cancel action through the semantic BFF and
the authoritative daemon policy.

## Marcus AI

The robot button in the navbar opens a full-screen chat drawer. Marcus AI uses
the `agent.default` model role and receives its product knowledge directly from
the versioned Markdown files under `documentation/`; `private/` is never loaded.
It can list and inspect Projects, agents, files, Runs, providers and model roles,
read/write project text files, generate agents, invoke/cancel Runs, delete
Projects and run system health/doctor checks. Every tool invocation is routed
back through MNP/1 with the current session, Project scope, RBAC and audit.

The browser receives a bounded opaque `conversationId` and sends it on the next
turn. marcusd owns the private provider transcript so DeepSeek tool calls can
carry `reasoning_content` across every required round without placing chain of
thought in React state, API responses, audit records or logs. Changing Project
context mounts a fresh chat; inactive server-side threads expire after two
hours.

Sensitive tools require the explicit phrase and target returned by Marcus AI,
for example `CONFIRMAR ELIMINAR PROYECTO <project>`, `CONFIRMAR ELIMINAR <path>`,
`CONFIRMAR SOBRESCRIBIR <path>`, `CONFIRMAR EJECUTAR <agent>` or
`CONFIRMAR CANCELAR <runId>`.

The `.agent.md` editor uses a narrower Marcus AI mode: only `files_read` and
`files_write` are sent to the provider, and marcusd independently verifies both
the selected Project and exact logical path before executing either call.

## Authentication

Anonymous loads check `/api/v1/auth/session` through the direct server path or
the semantic BFF. Login is sent to `/api/session/login`; the BFF validates the
shape and forwards it to `/api/v1/auth/login`. Marcus API stores the MNP client
in its server-side browser session and returns an HttpOnly cookie plus a CSRF
token. The cookie authenticates both HTTP and the direct WebSocket upgrade. The
browser keeps only that CSRF token in session storage and sends it on mutations.
Passwords and service-account credentials are never persisted by Next or the
browser.

## Run from source

Start `marcusd` and Marcus API using the existing development or production
workflow. Marcus API listens on `http://127.0.0.1:5724` by default. In another
shell, run the Next development server:

```bash
bun run dev:backoffice
```

Open [http://127.0.0.1:6636](http://127.0.0.1:6636). For a production build and
server:

```bash
bun run backoffice
```

Both commands bind only to `127.0.0.1`. Change the Next listener port without
changing its host:

```bash
MARCUS_BACKOFFICE_PORT=7636 bun run backoffice
```

If Marcus API uses a different origin, provide it explicitly to the Next
process:

```bash
MARCUS_API_URL=http://127.0.0.1:3100 bun run backoffice
```

No `.env.local` file is needed or supported by the project workflow.

## Build and tests

```bash
bun run build:backoffice
bun run test:browser:backoffice
```

Next writes only its native ignored `.next/` directory; it never creates
`dist/`. The production Playwright scenario starts isolated daemon and API
processes, launches `next start` through Bun, and verifies anonymous session
state, catalog-driven first-LLM onboarding, provider health, Runs and Run detail,
Project tabs/metrics, administrator creation/password rotation, Project-user
CRUD and restricted login, natural-language agent generation and compilation,
agent inspection, nested Project file revisions and highlighted writes,
restricted Agent AI editing, API activation, LLM-backed complete `curl`
rendering, contract inspection and a real API test case followed through
completion, Project-token creation and cross-Project denial,
chunked upload, Marcus AI
Thinking/tool-call continuity, permanent Project deletion plus same-slug recreation,
overview/search/Runtime/log/MCP access surfaces, favicon delivery, and absence
of Agent polling requests, more than one concurrent WebSocket, nested page-level
vertical scrollers, page errors or browser-console errors.

The Backoffice is an operational interface, not an authorization boundary.
Hiding a button never replaces server-side policy. It is not embedded in the
daemon/API release or served by Marcus API; its optional distribution is
versioned and installed independently.

Create the independently runnable, platform-specific archive with:

```bash
bun run package:backoffice
```

The result lives under `artifacts/backoffice/`. It uses Next standalone output,
includes traced runtime dependencies and static assets, and starts through
`package/run.sh` with Bun. No repository checkout or `bun install` is needed
after extraction. The launcher always binds to `127.0.0.1` and reads
`MARCUS_BACKOFFICE_PORT` when a port other than the default `6636` is required.
Packaging itself extracts and boots the archive, then checks the favicon over
HTTP before it can succeed.
