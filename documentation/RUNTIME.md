# Runtime Hosts

Marcus executes agent artifacts through supervised Runtime Hosts. Runtime
profiles improve fault containment and lifecycle control; they are not a
security sandbox for hostile owner code.

## Profiles

- `worker`: loads the artifact in a Bun Worker and communicates through the
  internal runtime envelope protocol.
- `process`: starts a dedicated OS process through `Bun.spawn` and uses IPC for
  lifecycle requests and managed capabilities.

Agents may be on-demand or resident. A resident instance is keyed to its
Project, agent, and version and can be started, stopped, restarted, monitored,
or recovered according to its declared policy.

## Lifecycle

The daemon loads an immutable artifact, starts the instance, invokes Runs,
forwards cancellation, reports events, and performs bounded shutdown. Startup,
request, heartbeat, and shutdown timeouts are explicit. A Worker that ignores
cooperative cancellation is terminated; a process receives bounded graceful
shutdown before forced termination.

## Managed capabilities

File access, secrets, model calls, tools, messages, events, checkpoints,
artifacts, approvals, and subagents cross the runtime boundary through typed
messages handled by the daemon. Runtime code does not receive direct database
authority.

Managed tool calls are validated against the exact AgentVersion allowlist and
schemas. `marcusd` persists each call, applies timeout/idempotency/risk policy,
requires a human Approval for critical operations and records Kernel plus audit
events. Custom `defineTool` code executes inside the artifact with a cooperative
`AbortSignal`; official tools execute in the daemon. See
[Tool Runtime and official catalog](./TOOLS.md).

Standalone releases include separate internal executables for the Runtime Host,
Agent Process, and Manifest Loader. Their paths are configured in `marcusd` and
must remain private implementation commands.
