# Changelog

Todos los cambios relevantes de Marcus se registran en este archivo raíz.
El directorio `private/` conserva únicamente las especificaciones históricas de
partida y no funciona como changelog vigente.

## Unreleased — 2026-08-20

### Public repository and SDK release readiness

- Added a public-repository gate that rejects tracked secrets, private/runtime
  material, escaping symlinks, publishable internal workspaces and incomplete
  SDK release metadata; added public security, contribution and CI policies.
- Marked every internal app and package as private while keeping only
  `@marcus/sdk` publishable, with Apache license/notice, repository metadata,
  Bun runtime types and an explicit public npm publication workflow.
- Made the Bun-native SDK tarball self-contained and verified it by installing,
  typechecking and executing `@marcus/sdk` plus `@marcus/sdk/testing` from a
  temporary external project.
- Embedded the public SDK contracts in the standalone Marcus compiler so an
  uploaded TypeScript agent can import `@marcus/sdk` without resolving the
  monorepo or installing dependencies on the server.
- Moved private product specs and the internal Agent Studio implementation plan
  below the ignored `private/` boundary. Public documentation remains solely
  under `documentation/`.
- Kept vendored agent-development skills and their provenance lock under the
  same private boundary instead of redistributing third-party guidance as
  product source.
- Prepared `main` to be recreated as one public root commit. npm publication
  and repository visibility remain explicit, separate release operations.

## 0.1.0 — 2026-08-17

### Downloadable Spanish user manual

- Published the official 44-page Marcus 0.1.0 revision 3 Spanish user manual as
  a stable PDF download in the website documentation hub, with visible version,
  format and size metadata plus production Playwright coverage of the asset.

### Public Agent Studio

- Rebuilt `/studio` as a fullscreen developer workspace instead of a marketing
  page: two-pane brief/source editing, integrated local history and comparison,
  a bottom terminal for real WebSocket activity, and a compact operational
  status bar, with responsive stacking and no document scroll on desktop.
- Added a gateway-owned, Git-ignored `apps/marcus-studio-gateway/.env` loaded
  automatically by Bun, plus a safe `.env.example`, so DeepSeek configuration
  no longer requires environment prefixes on every Studio command.
- Implemented the public Spanish `/studio` experience with real Markdown and
  TypeScript briefs, four starting examples, HTTP initiation, WebSocket-only
  progress/results, responsive three-surface UX, syntax highlighting,
  diagnostics, local immutable versions, comparison, restore, copy and download.
- Added the dedicated loopback Bun Studio gateway, signed anonymous sessions,
  exact Origin validation, request idempotency, encrypted SQLite replay,
  reconnect/resume, one in-flight generation per session and safe redacted
  operation logs under `~/.marcus/logs/all.log`.
- Enforced ten real DeepSeek calls per rolling minute across both session and
  HMAC IP subjects, plus global concurrency and daily-call circuit breakers;
  cancellation before provider dispatch releases its reservation.
- Extended the OpenAI-compatible provider with cancellable SSE streaming that
  separates private `reasoning_content` from structured output, enables
  `deepseek-v4-flash` Thinking Mode at `high` effort and forbids hidden fallback
  calls in the public Studio path.
- Added deterministic Markdown compilation and non-executing TypeScript
  validation with allowlisted imports, forbidden capabilities and a virtual
  Marcus SDK typecheck. Generated source is never imported or deployed.
- Published complete operator documentation, configuration, Nginx routing,
  SEO/JSON-LD/sitemap/llms.txt discovery, landing and authoring-guide CTAs, plus
  unit/integration and production Playwright coverage for generation,
  iteration, comparison, restore, download and mobile overflow.
- Retained the launch-grade product and rollout plan outside the public tree. The
  authenticated real-DeepSeek smoke remains a production gate because no
  Studio provider credential is available in the local validation environment.

### Stable landing terminal viewport

- Kept the CLI simulator at a stable responsive height while long transcripts
  render, with an internal keyboard-focusable scroll viewport instead of
  extending the entire experience section.
- Added a Marcus-styled scrollbar and automatic follow-to-latest behavior while
  commands are typed, plus production Playwright coverage for height stability
  and real overflow.

### Observable public installation

- Made the `curl | sh` bootstrap report target detection immediately and the
  delegated installer report manifest resolution, release size, every bundle
  part, checksum verification, extraction and installation instead of staying
  silent during multi-minute downloads.
- Added interactive curl progress bars while retaining concise stage messages
  for redirected and automated installs.
- Made a successful personal or system installation print exact next steps for
  the daemon, one-time administrator bootstrap, Marcus API, interactive CLI and
  the separately installed Backoffice, including its loopback URL.
- Extended unit and end-to-end installer gates to require progress reporting
  and the complete post-install operator guidance.

### Public documentation, use cases and enterprise paths

- Moved the SDK, Markdown and Tool Runtime gateway out of the home page into a
  dedicated `/documentacion` hub with three compiler-valid Markdown agents and
  explicit plan, create, build and verification recipes for the administrator
  MCP.
- Documented the complete local Codex and Claude Code connection flow without
  embedding bearer secrets, including the official documentation bundle and
  the approval boundary before MCP writes.
- Added `/casos-de-uso` with six concrete operational agent patterns and a
  concise home preview, plus `/empresas` for PyME and enterprise deployment on
  a local Linux server or AWS.
- Made the enterprise cost claim explicit: Marcus has no per-agent meter while
  compute, storage, network and LLM-provider usage remain variable operator
  costs; documented the current one-authority-per-installation boundary.
- Published root `/llms.txt`, new canonical metadata, sitemap entries and
  visible-content-backed CollectionPage, ItemList, Service and FAQPage
  structured data for machine and search discovery.
- Expanded production Playwright coverage across the new routes, MCP examples,
  canonical URLs, root LLM index and mobile horizontal-overflow checks.

### MCP management for Agent API tokens

- Added Project-scoped MCP tools to list, inspect, create, edit and revoke the
  access tokens used by Agent API entrypoints.
- Added authoritative MNP read/update operations for token metadata while
  keeping bearer values and scopes immutable; plaintext remains available only
  in the one-time creation response.
- Documented safe creation, expiry editing, rotation and deletion semantics,
  with destructive MCP annotations and durable revocation for audit.

### Governed Tool Runtime and official tool catalog

- Completed the versioned `defineTool` contract and immutable per-AgentVersion
  allowlist, including runtime, CLI, REST and MCP discovery with exact input and
  output schemas.
- Added durable governance for every tool call: SQLite records, Kernel events,
  audit correlation, schema validation, effective timeouts, cooperative
  cancellation, risk classification and persisted idempotent replay.
- Added mandatory human approval for critical operations and made permanent
  Project file deletion the first critical official capability.
- Published the 13-tool first-party catalog for Project files, bounded HTTP,
  immutable artifacts, child agents, Runs, events and approvals, alongside
  custom SDK tools executed inside the isolated Runtime Host.
- Added the maintained `documentation/TOOLS.md` reference and a complete public
  `/documentacion/tools` landing section generated from the shared catalog so
  schemas, versions and policy cannot drift between product and documentation.

### Dedicated Agent API test cases

- Replaced the Agent API Test case modal with a full Project/Agent route that
  keeps editable input, active contracts, endpoint, Run state and final output
  in one browser-scroll surface.
- Made the JSON editor wait for a synthetic example generated from the active
  contract by `agent.default`, with deterministic schema fallback and explicit
  retry instead of initializing to an empty object.
- Added support for concise top-level property declarations in Markdown schema
  blocks so generated agents preserve their complete input/output contracts.
- Added the MCP `documentation_bundle` tool with curated Markdown, TypeScript
  SDK and operations corpora plus an `all` option, while retaining granular
  documentation list/read/search tools and resources.

### Event-driven Backoffice realtime

- Added authenticated MNP `EVENT` publication from persisted Kernel events and
  daemon-owned Agent activities, with Project/principal authorization before
  delivery and observable active/published/delivered channel counters.
- Replaced Backoffice generation, planning, Marcus AI, Agent editing and API
  test-case polling with accepted HTTP commands plus asynchronous WebSocket
  progress, errors and final results. The compatibility generation-progress
  REST read remains available to non-Backoffice clients.
- Added one shared, lazy, reconnecting WebSocket per browser document. It
  multiplexes allowlisted read subscriptions, replays their initial snapshots
  after reconnect and never carries mutations or credentials in its URL.
- Made the system overview, Project dashboard, Runs, Run detail, Runtime and
  unified Logs update from relevant events, with explicit live/connecting/offline
  state, last-event timestamps and recovery actions instead of refresh timers.
- Expanded Agent activity consoles with timestamped operational reasoning
  summaries, provider/model identity, compiler phases, safe tool names and real
  error details. Private provider chain of thought, secrets and raw sensitive
  tool arguments remain server-side.
- Added route-aware contextual help throughout the control plane and preserved
  synchronous MCP tool results by awaiting the new daemon activity contract
  inside the MCP adapter.
- Extended API, daemon, storage, protocol integration and production Playwright
  coverage to reject WebSocket mutations, verify event-driven refresh, ensure
  Agent workflows issue no browser polling requests and enforce one concurrent
  WebSocket per document.

## Unreleased — 2026-08-15

### Enterprise Backoffice design system

- Reworked the complete Backoffice visual foundation around a sober graphite
  enterprise control plane. Removed the decorative grid, neon glow and oversized
  display typography; standardized shared color, spacing, radius, elevation,
  focus and interaction tokens across login, navigation, pages and Marcus AI.
- Redesigned the shared shadcn buttons, inputs, textareas, selects, cards,
  badges, tables, tabs, dialogs, sheets and drawers for predictable density,
  clearer hierarchy and stronger administrative readability.
- Split `General` into Administrators, password and MCP tabs, and split
  `Proveedores` into catalog, default-LLM and model-role tabs so unrelated
  configuration tasks no longer compete in one long screen.
- Replaced the bounded Logs feed with a literal semantic table in normal
  document flow and removed the Run payload height cap. Production Playwright
  now rejects overflowing vertical containers on these ordinary pages, leaving
  the browser as their only vertical scrollbar.
- Added a shared generation activity console to Agent Studio and the Project
  agent-creation dialog. Daemon progress now retains timestamped analysis,
  provider/model, compiler, file-write, build and activation events; failures
  expose their real Marcus error code and message instead of a generic banner.

### Backoffice navigation hierarchy

- Removed contextual `Archivos` and `Agentes` entries from the global sidebar;
  their navigation remains inside each owning Project. `Proyectos` now stays
  active throughout Project detail, file, editor and Agent routes.
- Moved global search from the sidebar to an action in the persistent
  header beside Marcus AI, keeping the sidebar limited to actual global
  destinations.

### Agent API execution feedback

- Increased the default Agent API completion wait from 5 to 30 seconds so
  ordinary LLM-backed invocations return their output instead of exposing an
  internal queue handle prematurely.
- Replaced opaque HTTP 202 responses with a Project-scoped `statusUrl`, current
  Run state, processing status, polling interval, explanatory message and
  matching `Location`/`Retry-After` headers.
- Made the Backoffice API test case explicitly asynchronous and follow the Run
  to completion while explaining queued, startup, execution and waiting states.
  Long-running work remains available through a direct Run-detail link instead
  of being presented as a successful JSON response.

## Unreleased — 2026-08-14

### Agentic control plane and MCP

- Reframed the Backoffice as an operational control plane. Administrators now
  land on a global health and activity overview with exact Project, file,
  agent, Run, failure, process and approval metrics, a 14-day execution chart
  and recent Runs.
- Added Runtime control for active processes, pending human approvals and
  schedules across visible Projects, including confirmed kill, decision and
  manual-trigger actions through semantic BFF routes and normal daemon RBAC.
- Added an administrator-only unified log explorer over the bounded redacted
  tail of `~/.marcus/logs/all.log`, plus cross-Project search for Projects,
  agents, Runs, Project files and maintained documentation.
- Added Agent Studio, which turns a natural-language requirement into a
  non-mutating structured architecture plan with contracts, tools, files,
  implementation steps, tests and risks. Approved Markdown plans enter the
  existing generation pipeline; TypeScript SDK plans hand off a precise MCP
  prompt to Codex or Claude.
- Added a complete stateless Streamable HTTP MCP server at `/mcp` using the
  official TypeScript SDK. Its 52 explicit tools, two resource families and
  three authoring prompts cover system discovery, documentation, Projects,
  files, Markdown/SDK agent planning and builds, Runs, processes, approvals,
  schedules, logs, audit and provider/model inspection without introducing a
  generic privileged proxy.
- Added dedicated global MCP administrator tokens under Backoffice `General`.
  Secrets are shown once and stored only as hashes; expiry, revocation and
  owning-user status are revalidated through a transient MNP session on every
  request. Ordinary administrator PATs are rejected by `/mcp`.
- Added explicit system overview/log/search, documentation, Agent planning and
  MCP token controllers, bringing the S42-Core registry to 30 modules and 125
  routes. Added protocol and daemon regression coverage for authentication,
  initialize, tool discovery/call, case-insensitive file search and immediate
  token revocation.

- Added a per-version compiled-artifact viewer to Agent detail. Authorized
  operators can inspect the immutable manifest JSON, generated Markdown
  TypeScript and exact JavaScript loaded by Runtime Host without receiving a
  stored artifact URI. Marcus API exposes the same data through an explicit
  `agents.read` controller, bringing the S42-Core registry to 112 routes.
- Added an explicit contextual return button to the Backoffice editor. Agent
  sources return to their owning Agent detail, while ordinary Project files
  return to the file catalog; production Playwright covers the Agent path.
- Made manually saved Agent Markdown explicit and deployable from Agent detail:
  a `Dirty` source now appears as a pending draft with a review action and an
  `Usar esta edición` flow that validates, compiles, versions and activates it.
  Failed validation preserves the current active version, and production
  Playwright covers the complete save-to-activation transition.
- Made successful `Agente AI` Markdown edits validate, register and activate an
  immutable AgentVersion instead of leaving the source dirty and absent from
  version history. Agent history now shows the local time together with the
  creation date.

### Identity and Project access

- Added the Backoffice General settings screen for global administrators. It
  lists administrator identities, creates additional administrators and lets
  the signed-in administrator change their password after verifying the
  current credential.
- Enforced one daemon-authoritative password policy for bootstrap,
  administrators and Project users: at least six characters, one uppercase
  letter and one of `$`, `%`, `#`, `!`, `&` or `*`. BFF validation mirrors the
  rule for immediate feedback while `Bun.password` remains the hashing
  authority.
- Added complete Project membership management to Project detail: create a
  scoped user, list access, edit username/password/role and delete the
  membership. Project membership listings now exclude global administrators,
  whose access is already system-wide and managed separately under `General`.
- Made authenticated session status expose only the caller's safe identity and
  roles, hid global settings from Project users, and filtered Project listing
  server-side so non-administrators see only their memberships. Membership
  actions are visible only to global administrators and Project owners.
- Expanded the S42-Core registry to 105 explicit controllers and extended the
  production Playwright flow through administrator creation, password change,
  Project-user CRUD, restricted Project login and global-navigation isolation.
- Added synchronized Markdown source highlighting to the Backoffice editor for
  frontmatter, headings, prose, lists, quotes, fenced blocks and code without
  replacing its native editable textarea or optimistic-save contract.
- Fixed nested Project file editing so the initial optimistic revision comes
  from the authoritative file `stat` operation instead of a root-directory
  listing. Agent files below `project:/agents/` no longer open as revision zero
  or fail their first save with a stale metadata conflict.
- Added a restricted `Agente AI` editor dialog for `.agent.md` files. Marcus AI
  receives only `files_read` and `files_write`, is bound to the exact Project
  and logical path, reloads the committed source/revision after the write, and
  cannot run, rename or delete resources from this mode. marcusd validates the
  result and performs the version registration/activation itself without
  exposing additional provider tools.
- Rebuilt Project detail around `Dashboard`, `Agentes`, `Usuarios` and `Tokens`
  tabs. Dashboard uses daemon-authoritative file/agent totals and a real 30-day
  Run chart; the agent catalog identifies API availability.
- Added one-click Markdown Agent API activation. The daemon updates
  `api-enabled`, validates the complete source, builds an immutable version and
  activates it before the detail screen exposes the exact invocation endpoint
  and `curl` example.
- Replaced the empty Agent API body with a complete example generated by the
  configured LLM under the active input schema, with deterministic fallback
  and `$MARCUS_TOKEN` kept as a non-secret shell placeholder. Added a `Test
  case` dialog that displays both active contracts, lets operators edit the
  JSON body and invokes the real API endpoint through the existing session and
  CSRF boundary without exposing a Project token.
- Added revocable Project API tokens, stored only as hashes and shown in
  plaintext once. Tokens carry only Run invoke/read scopes and a durable
  Project claim enforced before normal scope or administrator authorization, so
  they cannot cross into another Project or global operations. Marcus API now
  reauthenticates bearer credentials per HTTP request so revocation takes effect
  immediately instead of leaving a cached MNP session usable.
- Expanded the S42-Core registry to 112 explicit controllers and extended the
  production Playwright scenario through Project tabs/metrics, nested revision
  loading, restricted AI editing, API activation, LLM-backed curl rendering,
  contract-aware API testing, token creation and cross-Project denial.

### Operations and first LLM onboarding

- Made natural-language Agent generation resilient to provider-authored schema
  drift: Marcus requires and canonicalizes `schema: marcus.agent/v1`, validates
  the full Markdown source and allows one bounded LLM repair for remaining
  compiler diagnostics before creating any version.
- Added principal- and Project-scoped generation progress across marcusd,
  Marcus API, the semantic Backoffice BFF and the creation dialog. The UI now
  replaces its status with real requirements, provider/model, normalization,
  validation, repair and activation phases without exposing chain of thought.
- Added Marcus' first-party provider catalog with OpenAI and DeepSeek profiles,
  canonical endpoints, capabilities and model examples. CLI `config default`,
  Marcus API and the mandatory Backoffice setup now use the same catalog while
  preserving an advanced endpoint override for compatible private gateways.
- Implemented DeepSeek Thinking Mode with `high` reasoning effort across Marcus
  AI, Markdown generation and Runtime Host model calls. Tool-call reasoning is
  retained only in daemon-owned private conversation state and round-tripped on
  every later provider request; it is never exposed through API/browser
  responses, logs, audit events, SDK results or Run output.
- Implemented provider-aware structured-output negotiation: OpenAI uses JSON
  Schema first, DeepSeek uses JSON Object directly, unsupported formats fall
  back narrowly, empty DeepSeek JSON receives one bounded retry, and every
  parsed response is validated locally against the requested Marcus schema.
- Added `GET /api/v1/providers/catalog`, opaque Marcus AI conversation handles,
  SDK controls for output tokens/Thinking effort and regression coverage for
  multi-round reasoning continuity plus DeepSeek-backed internal agent Runs.
- Added an OpenAI-compatible structured-output fallback for providers that
  explicitly reject `response_format: json_schema` as unavailable. Marcus
  retries without that extension, injects the same JSON Schema into the system
  instruction and keeps strict JSON/agent compilation validation; unrelated
  provider 400 responses are never retried or hidden.
- Unified daemon, Marcus API and Backoffice operational logging as redacted
  JSON Lines in `~/.marcus/logs/all.log`, with component source, lifecycle,
  request and mutation context suitable for live diagnosis without persisting
  credentials.
- Added the interactive CLI command `config default`. It presents the provider
  catalog, asks for the selected provider, hidden API key and model, persists the key in the
  encrypted global SecretStore, verifies `/models` and only then assigns
  `agent.default`. Failed replacement probes preserve the working provider and
  credentials.
- Added the authenticated global LLM configuration API and mandatory
  Backoffice onboarding gate when `agent.default` is absent.
- Completed the Backoffice Proveedores surface with provider health tests,
  global LLM replacement and model-role visibility, and the Runs surface with
  cross-Project listing, Agent identity, result/error/trace detail and
  cancellation for non-terminal executions.
- Expanded the S42-Core registry to 27 modules and 102 explicit controllers;
  production Playwright now proves first-LLM onboarding, Providers and real Run
  detail in addition to the existing Project/Agent/File/AI workflows.

### Release circuit

- Unified the default personal release layout below `~/.marcus`: public
  commands now install to `~/.marcus/bin`, internal runtime executables to
  `~/.marcus/lib/marcus`, and the end-to-end installer smoke test proves this
  default without relying on `~/.local`. The installer prints the required
  `PATH` export without modifying the user's shell profile.
- Kept the release and landing build boundaries explicit: `build:artifact`
  still never builds Next, while `package:changed` builds the landing when its
  own source changed in the same commit as server or installer files.
- Decoupled `build:artifact` from the Next production build: refreshing stable
  release files now compiles and smoke-tests only Marcus artifacts, without
  rebuilding the unchanged landing or emitting an expected server SIGTERM as an
  error. The website build is once again an independent `next build`, with a
  regression test enforcing the boundary.
- Fixed clean-checkout artifact builds by anchoring the generated `/artifacts/`
  ignore rule to the monorepo root and versioning the legitimate Marcus API
  `artifacts` module that the standalone controller registry imports.
- Added the canonical `bun run build:artifact` pipeline: it cross-compiles the
  complete Marcus server/CLI release for Linux and macOS on x64 and arm64,
  places every target inside the website and proves the advertised installer
  against a disposable static server.
- Added the complete release matrix beneath the website's stable public paths,
  closing the gap between `/install` and its previously absent manifests. Large
  platform bundles are published as verified 24 MiB parts and reassembled with
  full archive and per-executable checksum validation.
- Kept `bun run package:release` as a compatibility alias and updated packaging
  rules and user documentation around the single website artifact circuit.
- Made packaging a mandatory pre-commit rule in `AGENTS.md`, with an explicit
  change-to-artifact matrix for the server/CLI release, Backoffice, SDK and
  website.
- Added `bun run package:changed` to derive and execute every required packaging
  job from the current Git diff, with a post-commit pass that stamps final
  manifests before push.
- Added `bun run package:release`, which assembles the exact public `/install`
  and stable target tree and proves the advertised `curl | sh` flow against a
  disposable HTTP server through all six installed executables.
- Added `bun run verify:public-installer --full` as the post-deployment gate for
  the bootstrap, manifest and complete installation served by
  `projectmarcus.com`.
- Made the Backoffice produce a platform-specific Next standalone archive with
  traced runtime dependencies, static assets, checksums and a loopback-only Bun
  launcher; packaging now extracts and boots the archive before succeeding.
- Corrected the Turborepo build-output contract to cache and restore native
  `.next/` artifacts at each Next workspace instead of the forbidden, unused
  `build/` path, while keeping Bun-native package builds output-free.
- Switched the Backoffice production start command to the generated standalone
  Bun server so source operation and the distributed archive use the same
  supported Next runtime.
- Added the required post-build static-asset preparation to that standalone
  tree, preventing production and Playwright chunk requests from returning 404.

### Next.js Backoffice migration

- Corrected Project deletion to be genuinely destructive instead of archival:
  Marcus now removes the Project and all dependent authoritative rows,
  deletes managed Project Home files, preserves externally linked directories,
  blocks deletion while Runs are active, and allows the deleted slug to be
  recreated. The Backoffice warning, Marcus AI tool and production Playwright
  scenario now reflect and prove this behavior.
- Completed the missing Project and Agent migration slices: Project detail now
  exposes agents and files, Agent detail exposes source and immutable versions,
  text files have a revision-safe editor with Markdown preview, local uploads
  use the native chunked protocol, and Project deletion is exposed from the
  Project detail.
- Added natural-language Agent creation backed by the configured LLM: Marcus
  generates deterministic Markdown, validates and compiles it, writes the
  authoritative source below `project:/agents/`, and activates the result.
- Added the full-screen Marcus AI drawer to the navbar. Its knowledge is built
  directly from `documentation/*.md`, and its typed tools re-enter the MNP
  router so session RBAC, Project scope and mutation auditing remain enforced;
  destructive and overwrite actions require exact user confirmation phrases.
- Expanded the S42-Core registry to 26 modules and 98 explicit controllers for
  Project deletion, natural-language Agent generation and Marcus AI chat, with
  explicit long-running MNP deadlines and no catch-all proxy.
- Extended production Playwright coverage through real daemon/API/provider
  fixtures to prove detail navigation, editing, chunked uploads, Markdown agent
  generation/compilation, tool-calling chat and permanent Project deletion
  followed by same-slug recreation without page or browser-console errors.

- Changed the canonical Backoffice default listener from port `3001` to `6636`
  in development, production and the independently packaged launcher.
- Added the single `@marcus/backoffice` application on Next.js 16 App Router,
  executed exclusively through Bun for development, build and
  production, with `.next/` as its only framework output and no `dist/`.
- Installed the complete current shadcn component catalog as owned source code
  and introduced a responsive Marcus control-plane design using accessible
  Sidebar, Dialog, Field, Card, Table, Badge, Alert, Tooltip and Toast patterns.
- Implemented the first migration slice for login/session, authenticated shell,
  Project listing and creation, and Project file listing and creation.
- Added explicit semantic BFF Route Handlers for session, Projects and Files;
  request forwarding is header-allowlisted, preserves Marcus cookies and CSRF,
  exposes no service credential and deliberately has no REST catch-all.
- Kept Server Component reads direct to Marcus API, avoiding an internal BFF
  round trip, while retaining Marcus API/marcusd as the only authentication,
  authorization and persistence authority.
- Made the Next.js application the only Backoffice exposed by
  `bun run dev:backoffice`, `bun run backoffice` and
  `bun run build:backoffice`; implementation details no longer leak into the
  public commands.
- Removed the Web Components Backoffice, its browser tests and API static-file
  integration. Marcus API no longer discovers, embeds or serves frontend
  assets.
- Separated distribution lifecycles: the public shell installer contains only
  the CLI and server executables, while the optional Backoffice is prepared as
  an independently installed tool.
- Made standalone target builds recreate their output directory before writing,
  preventing removed legacy Backoffice files or other stale artifacts from
  surviving into a later release directory.
- Added unit coverage for BFF validation/header boundaries and Playwright
  production coverage for anonymous session state, login, Project creation,
  file listing, file writing, favicon delivery and browser-console stability.

### Backoffice browser reliability

- Preserved Bun native route parameters through the API security wrapper, so
  all Project-scoped S42-Core controllers receive their `projectId` and file
  listing no longer fails with `PROJECT_REQUIRED`.
- Added a public browser-session status endpoint so anonymous Backoffice loads
  render login without generating a protected-resource `401` probe.
- Replaced the provisional Backoffice SVG favicon with the same transparent
  Marcus ICO used by the public website.
- Added Playwright coverage against the production Backoffice and a
  disposable real daemon/API stack for anonymous login and authenticated
  Project file listing, including hard failures on unsuccessful responses,
  unhandled page errors, and console errors.
- Added the browser test to the root `bun run check` gate with an isolated
  temporary data directory and ephemeral test credentials.

### Public website

- Added a dedicated authoring section and complete static Spanish guides at
  `/documentacion/sdk` and `/documentacion/markdown`, covering the first working
  upload/build/Run flow, SDK contracts and Runtime Context, Markdown
  `marcus.agent/v1` authoring, editing, AI generation and diagnostics.
- Added responsive editorial documentation navigation, accessible copyable
  code blocks, guide-specific canonical metadata, sitemap entries and
  production Playwright coverage at desktop and 375 px widths.
- Added the supplied 1731×909 Marcus Agentic OS Open Graph artwork, complete
  Open Graph and X card metadata, canonical and Spanish language signals,
  indexable robots rules, a root sitemap, enriched web manifest, and
  Organization, WebSite, and SoftwareApplication structured data.
- Added a visible “Powered by Stock42 LLC” footer credit linking to
  `https://stock42.com`.
- Migrated `@marcus/web` from its custom static bundler/server to a Bun-first
  Next.js 16 App Router application, with `.next/` as its only framework output
  and no repository `build/` or `dist/` directory.
- Moved the interactive console journey into `src/data/cli-journey.json`, made
  the initial transcript server-rendered, and validated every displayed Marcus
  command against the production `@marcus/cli` parser.
- Added production Playwright coverage for the public installer response, real
  login and missing-LLM transcript, Project commands and JSON output, first
  agent commands, queued Run response, console errors and mobile overflow.
- Fixed paused-motion and reduced-animation rendering so terminal lines remain
  visibly rendered instead of freezing at their pre-animation opacity.
- Added a real extensionless `/install` POSIX shell asset that selects the
  platform release and delegates to its checksum-validating installer instead
  of returning landing HTML.
- Corrected the interactive website journey to reproduce the real first Marcus
  CLI session, including password prompt, MNP/1 banner, missing-LLM diagnosis,
  provider setup commands, model-role assignment, and `marcus>` prompt.
- Replaced shell-style Project examples and invented summaries with the real
  `project create`/`use project` JSON responses and contextual Project prompt.
- Replaced the provisional letter mark with the supplied Marcus identity,
  preserving its original artwork in a tightly cropped transparent asset: the
  navigation uses the mascot and the footer presents the complete wordmark.
- Replaced the temporary SVG favicon with the supplied transparent Marcus brand
  set for browsers, Android, Apple touch icons, legacy ICO clients, and the web
  app manifest; both development serving and production builds include every
  original asset unchanged.
- Added the Spanish `@marcus/web` landing for `projectmarcus.com`, positioned
  around enterprise adoption of self-hosted agentic infrastructure in Latin
  America and Spain.
- Added an accessible animated product narrative, live infrastructure topology,
  architecture and governance sections, adoption path, copyable installer
  commands, and a keyboard-operated console journey from installation through
  the first supervised agent Run.
- Kept `bun run web` as the loopback-only development command, added
  `bun run web:production`, and included the website's native Next output and
  public brand assets in root artifact verification.
- Documented the website development, experience, build, accessibility, and
  deployment contracts under `documentation/WEBSITE.md`.

### Project workflow

- Added the root `AGENTS.md` with the current monorepo architecture, security
  boundaries, Bun-first conventions, validation commands and mandatory Git
  workflow.
- Established `CHANGELOG.md` at the monorepo root as the only active changelog.
- Excluded the private specs and plans directory from Git and removed it
  from repository validation gates.
- Added maintained user and operator documentation under `documentation/`,
  covering installation, configuration, CLI, SDK, Markdown agents, Kernel,
  runtimes, API, Backoffice, security, operations, distribution and development.
- Updated the root README to point to maintained documentation and the root
  changelog.
- Documented the project-local skills inventory and its lockfile without
  changing the vendored skill content.
- Ignored the local `.marcus-data/` runtime state directory.
- Made direct work on local `main` with an obligatory push to `origin/main` part
  of the repository workflow after every committed change.

### Bun-first runtime and packaging

- Kept server, CLI and package entrypoints as native TypeScript executed by Bun,
  without per-package `dist/` output.
- Limited the regular build to the native `.next/` output of the Backoffice and
  website, retaining `bun build --compile` only for standalone release
  executables.
- Changed package exports and verification to consume TypeScript source.
- Added self-contained TypeScript staging for the publishable `@marcus/sdk`
  package.
- Used `Bun.file` for complete file reads while retaining Node filesystem APIs
  for filesystem operations without a direct Bun equivalent.
- Made the no-`dist/` rule absolute for every workspace, including both Next
  applications, and removed the website's former `build/` artifact contract.
- Added `verify:no-dist` to the root gate to reject `dist/` directories and
  package or TypeScript output configuration targeting `dist`.

### API and S42-Core

- Moved the default loopback API listener from port 3000 to 5724, updated the
  Backoffice and system configuration defaults, and added `bun run api` with a
  working `PORT=<port>` override for starting only the API.
- Reworked `marcus-api` around S42-Core modules, explicit controllers,
  `Dependencies`, `RouteControllers` and native WebSocket controllers.
- Added 25 capability modules and 94 explicit HTTP controllers, removing the
  wildcard API dispatcher.
- Added a static controller registry to preserve module parity inside standalone
  Bun executables.
- Moved each HTTP operation and payload mapping into its owning controller.
- Corrected optional query payload typing so route-local mappings remain valid
  under the strict `JsonValue` contract.
- Documented the complete local API and independent Backoffice startup flow,
  including the managed service credential, login URL and health endpoints.
- Made same-origin browser requests work without a manual CORS allowlist.
- Added `bun run backoffice` as the production-style source entrypoint and kept
  `bun run dev` focused on the daemon and API.
- Fixed the API and Backoffice listeners to `127.0.0.1`; remote publication is left
  to an operator-managed reverse proxy instead of a Marcus public-bind option.

### CLI experience

- Added an interactive startup check for the `agent.default` LLM model role,
  with a visible configured state or actionable provider setup instructions.
- Kept the REPL available when the LLM is missing or its configuration cannot
  be inspected, so administrators can repair it from the same session.
- Made `marcus` with no arguments connect to `127.0.0.1:4242` as `admin` and
  prompt for the password with explicit Enter confirmation.
- Added `-h`/`--help`, available without authentication, profile loading, or a
  network connection.
- Made one-shot bootstrap detect an interactive terminal, display an explicit
  administrator password prompt, and accept Enter without requiring `Ctrl+D`.
- Restored stdin's previous flow state after hidden terminal input so one-shot
  bootstrap and authenticated commands exit immediately after completing.
- Clarified hidden password entry and interactive/non-interactive bootstrap in
  the README and maintained user documentation.

### Security and persistence

- Unified personal daemon state, secrets, Projects, runtime files and CLI
  profiles under `~/.marcus`, independent of the process working directory.
- Kept legacy `.marcus-data/` installations untouched so their SQLite database
  and secrets key can be migrated deliberately while the daemon is stopped.
- Persisted HMAC antireplay fingerprints in SQLite per Project until their
  replay window expires, preventing daemon restarts from accepting a reused
  signature.
- Added migration, repository and integration coverage for durable antireplay
  behavior.
- Made `marcusd` provision and validate a stable, least-privilege API service
  token under the active data directory with mode `0600`; personal installs use
  `~/.marcus/api.token` and system services use `/var/lib/marcus/api.token`.

### Distribution

- Established `projectmarcus.com` as the canonical landing, installer and
  stable release host, with documented one-line user and system installation
  commands.
- Included verified configuration and systemd units in release manifests.
- Added the minimal S42-Core server patch required to pass the fixed loopback
  hostname through to `Bun.serve`.
- Made installed daemons discover Runtime Host, Agent Process and Manifest
  Loader automatically from a release directory or installation prefix.
- Made Linux `--system` installation create the service user, preserve existing
  configuration, install missing defaults, and enable daemon plus API services
  automatically.

### Verification

- Added or updated checks for package boundaries, Bun-native source exports,
  Backoffice `.next/` output, S42 controller parity and end-to-end HMAC replay
  persistence.
