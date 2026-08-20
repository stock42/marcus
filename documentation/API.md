# REST and WebSocket API

`marcus-api` is an S42-Core adapter over MNP/1. It has no direct Kernel or SQLite
access. Source mode discovers 31 capability modules dynamically; standalone
executables use a generated static registry with the same 126 explicit HTTP
controllers.

The default local origin is `http://127.0.0.1:5724`. From the monorepo, run
`bun run api`; use `PORT=<port> bun run api` for an explicit override.

## Endpoints

- `GET /health/live`: API process liveness.
- `GET /health/ready`: daemon-backed readiness.
- `GET /api/v1/auth/session`: public browser session status without probing a
  protected resource.
- `POST /api/v1/auth/login` and `/logout`: browser session lifecycle.
- Authenticated session status includes only the caller's user ID, username and
  system roles when available; no credential or provider secret crosses this
  boundary.
- `GET /api/v1/openapi.json`: generated OpenAPI document.
- `GET /api/v1/docs`: API reference response.
- `POST /mcp`: stateless Streamable HTTP MCP endpoint. It accepts only a
  dedicated global MCP administrator bearer token; see [MCP](./MCP.md).
- `GET|POST /api/v1/mcp/tokens` and
  `DELETE /api/v1/mcp/tokens/:token`: list, create and revoke dedicated global
  MCP credentials. The plaintext value is returned only on creation.
- `GET /api/v1/system/overview`: visible installation metrics, 14-day Run
  trend, recent Runs, Runtime load and pending approvals.
- `GET /api/v1/system/logs`: bounded, filterable tail of the shared redacted
  JSONL log. This requires global administration.
- `GET /api/v1/system/search`: search visible Projects, agents, Runs, Project
  files and official documentation.
- `GET /api/v1/documentation`, `/api/v1/documentation/search` and
  `/api/v1/documentation/:name`: browse the same maintained documentation
  corpus used by Marcus AI and MCP.
- `/api/v1/projects/*`: Projects, files, agents, validators, Runs, processes,
  conversations, artifacts, events, messages, schedules, approvals, members,
  audit, secrets, and uploads.
- `/api/v1/providers`, `/model-roles`, `/users`, `/tokens`, and `/backups`:
  system administration.
- `POST /api/v1/users` and `PATCH /api/v1/users/me/password`: create a global
  administrator and change the signed-in administrator password after current
  password verification.
- `GET /api/v1/projects/:project/members`,
  `POST /api/v1/projects/:project/members/users`, and
  `PUT|DELETE /api/v1/projects/:project/members/:user`: list, create, update and
  remove Project access. Deletion removes that Project membership; unrelated
  memberships remain intact. The Project member list excludes global
  administrators because their authorization is system-wide.
- `GET /api/v1/projects/:project/dashboard`: exact Project file/agent totals
  and 30 daily Run-consumption buckets.
- `GET /api/v1/projects/:project/tools`: returns the official catalog when no
  query is supplied. `?agent=<id|slug>` returns the active AgentVersion
  allowlist; `?agentVersionId=<av_...>` inspects an immutable historical
  version. Every entry includes schemas, version, risk, timeout, cancellation,
  side-effects and idempotency policy.
- `GET|POST /api/v1/projects/:project/tokens` and
  `DELETE /api/v1/projects/:project/tokens/:token`: list, create and revoke
  Project-scoped API credentials. Creation requires at least one active Agent
  API entrypoint and returns the plaintext token only once.
- `PATCH /api/v1/projects/:project/agents/:agent/api-access`: update
  `api-enabled` for a Markdown source, validate it, create an immutable version
  and activate the result.
- `POST /api/v1/projects/:project/agents/:agent/input-example`: ask the
  configured `agent.default` LLM for a synthetic request body constrained by
  the active Agent input schema. The response contains only the example and
  provider/model identity; Project credentials are never part of the prompt.
  If the provider is unavailable, marcusd returns a deterministic schema-based
  example instead.
- `GET /api/v1/projects/:project/agents/:agent/versions/:version/compiled`:
  inspect a registered Markdown version through the normal `agents.read`
  policy. The response contains its immutable manifest JSON, the generated
  TypeScript intermediate and the exact JavaScript artifact loaded by Runtime
  Host. The internal artifact URI is not returned.
- `GET /api/v1/providers/catalog`: first-party OpenAI and DeepSeek profiles,
  including canonical endpoints, model examples and capabilities.
- `POST /api/v1/projects/:project/agents/:agent/invoke`: agent entrypoint. By
  default Marcus waits up to 30 seconds and returns the Agent output directly
  with HTTP 200. Send `Prefer: respond-async` or configure an asynchronous
  entrypoint to receive HTTP 202 immediately. If a synchronous execution is
  still running after the wait window, HTTP 202 contains a self-describing
  tracking contract instead of an opaque Run handle:

  ```json
  {
    "ok": true,
    "data": {
      "runId": "run_...",
      "state": "running",
      "status": "processing",
      "resultAvailable": false,
      "statusUrl": "/api/v1/projects/prj_.../runs/run_...",
      "pollAfterMs": 1000,
      "message": "The Run was accepted and is still processing. Read statusUrl until state is completed or failed."
    }
  }
  ```

  The same URL is returned through `Location`, with `Retry-After: 1`. Read it
  until the Run reaches `completed`, `failed`, `cancelled`, `timed_out` or
  `killed`; completed Runs expose their Agent output in `output`.
- `DELETE /api/v1/projects/:project`: permanently deletes the Project and its
  dependent Marcus state. Managed Project Homes are removed from disk; linked
  external directories are preserved. Active Runs must be cancelled first.
- `GET|PUT /api/v1/config/default-llm`: inspect or configure the global
  `agent.default` provider. PUT receives catalog ID, provider name, base URL,
  API key and model; marcusd encrypts the key and verifies `/models` before
  committing the role assignment.
- `POST /api/v1/projects/:project/agents/generate`: converts a natural-language
  description into deterministic Marcus Markdown, compiles it and activates the
  resulting agent. It returns HTTP 202 with an opaque `activityId`; progress,
  failure details and the final result are delivered through the authenticated
  WebSocket subscription `agentActivities.get`. It uses `markdown.compiler`,
  falling back to `agent.default` when that specialized role is not assigned.
- `POST /api/v1/projects/:project/agents/plan`: accepts a non-mutating Markdown
  or TypeScript SDK planning activity and returns HTTP 202 plus `activityId`.
  The WebSocket activity result contains contracts, tools, files, steps, tests
  and operational risks.
- `GET /api/v1/projects/:project/agents/generations/:progressId`: returns the
  current safe operational phase for an in-flight natural-language generation.
  It remains a compatibility/read endpoint for non-Backoffice clients; the
  Backoffice never polls it. Progress is restricted to the requesting principal
  and Project and contains stages, provider/model identity and status messages,
  never provider chain of thought.
- `POST /api/v1/assistant/chat`: accepts a Marcus AI activity with bounded
  conversation history and typed tools over the caller's existing RBAC context,
  then returns HTTP 202 plus `activityId`. WebSocket completion includes an
  opaque `conversationId`; sending that ID on the next turn lets marcusd
  preserve the provider-native private tool transcript. Provider reasoning is
  never returned by either channel.
  Passing `mode: "agent-file-edit"` with an exact `project:/*.agent.md` path
  restricts the provider tool catalog and daemon execution to reading and
  writing that single file. Before the write, marcusd validates the complete
  Markdown and the caller's file/create/activate capabilities. A successful
  write automatically registers and activates its immutable AgentVersion.
- `GET /api/v1/ws`: authenticated WebSocket control channel.

The HTTP command boundary does not remain open for LLM execution. Generation,
planning and assistant work continue as daemon-owned activities after the 202
response; disconnecting or navigating the Backoffice does not cancel them.

There is no catch-all API controller. Each route owns its method, path, MNP
operation, payload mapping, and Project scope.

## Authentication and browser writes

Control-plane requests use either a Marcus bearer token or an HttpOnly browser
session. The Backoffice checks `/api/v1/auth/session` before loading protected
data, so an anonymous initial load does not emit an expected `401`. Login
returns a CSRF value; unsafe browser-session requests must send it in
`x-marcus-csrf`. Cookies use `SameSite=Strict` and are secure by default.

Agent invocation applies the authentication policy from the active agent
contract. Supported policies include Marcus token, bearer, API key, HMAC, and a
custom AuthValidator. Authorization remains daemon-enforced.

Project API tokens use the normal `Authorization: Bearer <token>` header. They
contain only `runs.invoke` and `runs.read` scopes plus a server-owned Project
claim. marcusd checks that claim before scope and system-role shortcuts, so the
credential cannot address another Project or any global operation.

## WebSocket protocol

After session-authenticated upgrade, clients can send only `ping`, `subscribe`
and `unsubscribe`; commands and mutations remain explicit HTTP requests.
Subscriptions target an allowlisted read operation and return one `snapshot`,
then `update` messages only after a relevant authorized MNP event. There is no
timer polling. Durable Kernel events, Run transitions, Agent activity phases and
local API log writes trigger refreshes. Project and principal scope is checked
before delivery.

The Backoffice multiplexes all active screen subscriptions over one WebSocket
per browser document. Agent progress events contain timestamped operational
summaries, the selected provider/model, compiler phases, safe tool names and
real error codes/messages. Private provider chain of thought, credentials and
raw secret-bearing tool arguments never cross the socket.

## Deployment controls

Same-origin browser requests are accepted automatically; configure an
explicit origin allowlist only for additional browser origins. Request bodies
default to 1 MiB. Security headers are applied to JSON, static assets, and
errors. The daemon manages the API service-account token in its data directory;
explicit token configuration remains available for custom deployments. The API
does not bundle or serve the separately distributed Backoffice.

The HTTP/WebSocket listener is fixed to `127.0.0.1`. Marcus intentionally has
no public bind option. External access, TLS termination, public host policy and
network rate limiting belong to an operator-managed reverse proxy such as
Nginx.
