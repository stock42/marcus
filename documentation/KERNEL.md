# Kernel and persistence

The Marcus Kernel is the authoritative lifecycle engine behind `marcusd`. It
accepts typed operations only after daemon authentication and authorization.

## Core model

- Projects own agents, files, members, Runs, conversations, and policy state.
- AgentDefinition identifies an agent; each build creates an immutable
  AgentVersion.
- An AgentInstance binds a version to a supervised runtime.
- A Run is pinned to an AgentVersion and advances through validated state
  transitions.
- Processes have Marcus process IDs, heartbeat/progress health, and parentage.
- Tasks, steps, execution graphs, mailboxes, messages, checkpoints, artifacts,
  tool calls, approvals, and events provide durable execution context.

## Admission

Before a Run is created, the Kernel validates the active version, entrypoint,
input schema, authorization, idempotency, rate limits, concurrency, and budget
constraints. Conversation-scoped concurrency can queue work fairly rather than
running conflicting requests in parallel.

## SQLite

`@marcus/storage-sqlite` uses `bun:sqlite`, strict tables, foreign keys, busy
timeout, WAL for persistent databases, and ordered transactional migrations.
SQLite persists Kernel entities, auth/RBAC state, Project file metadata,
providers/model roles, audit/events, and HMAC replay fingerprints.

Migrations are append-only. Never edit an applied migration; add the next
version and test both fresh creation and upgrade behavior.

## Scheduling and recovery

The scheduler evaluates five-field cron expressions in their declared IANA time
zone. Firings, idempotency, state changes, and events are durable. Explicitly
restartable resident instances can be reconstructed after daemon recovery;
arbitrary code execution is not replayed deterministically.

The daemon authority lock prevents two local authorities from writing the same
state directory. `--force-recover` is an operator action, not a normal startup
flag.
