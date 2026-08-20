# ADR-001: Official MCP TypeScript SDK in Marcus API

- Status: accepted
- Date: 2026-08-14
- Scope: `@marcus/api`

## Context

Marcus must expose a standards-compatible Streamable HTTP MCP server for Codex,
Claude Code and other MCP clients. The protocol includes initialization,
capability negotiation, JSON-RPC errors, tool/resource/prompt schemas, transport
headers and version evolution. A local implementation would duplicate protocol
state and create a compatibility surface unrelated to Marcus' core domain.

## Decision

`@marcus/api` uses `@modelcontextprotocol/sdk` as its MCP transport and server
implementation. `zod` is used only at that boundary to define the tool and
prompt input schemas required by the SDK.

Both dependencies remain confined to `apps/marcus-api/src/mcp/`. They do not
enter contracts, daemon, Kernel, Runtime Host, SDK agents, CLI or Backoffice.
MCP handlers delegate every operation to the existing authenticated MNP client;
the third-party SDK receives no direct SQLite, filesystem or Kernel authority.

## Consequences

- Marcus follows the protocol implementation maintained alongside the MCP
  specification instead of maintaining a private transport fork.
- Upgrading the dependency requires the normal API protocol tests: initialize,
  stateless tool discovery/call, resources, prompts, bearer rejection and
  production Backoffice MCP connectivity.
- Zod schemas are an API-adapter detail. Marcus' serialized contracts and daemon
  validation remain authoritative and dependency-free.
- The accepted runtime exceptions are exactly
  `@modelcontextprotocol/sdk` and `zod` inside `@marcus/api`; no other workspace
  or third-party dependency is approved by this decision.
