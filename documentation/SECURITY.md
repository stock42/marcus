# Security

## Trust boundaries

- `marcusd` is the authority for authentication, RBAC, admission, secrets, and
  persistence.
- CLI and API clients have no direct database authority.
- Browser code communicates only with `marcus-api`.
- SDK agents are trusted Project-owner code. Worker/process isolation is for
  supervision and containment, not hostile-code sandboxing.

## Credentials and secrets

Passwords are hashed with `Bun.password`. Access tokens are stored as hashes and
can be scoped and revoked. Provider and agent secrets are encrypted at rest with
AES-256-GCM and associated data binding the ciphertext to its name and Project.

Backoffice-created Project API tokens are personal access tokens with only
`runs.invoke` and `runs.read`. Their durable `project_id` is copied into an
authenticated Principal claim and checked before ordinary scope or system-role
authorization. The plaintext value is returned only at creation; listing shows
only label and opaque token metadata. Marcus API opens a transient authenticated
MNP client for each bearer request, so a revoked or expired token cannot remain
usable through a cached API-side session.

The administrator MCP exposes Project token list/get/create/update/delete
operations through the same MNP authorization boundary. List and get return
metadata only. Update can change label or expiry but never bearer or scopes.
Delete is an immediate revocation that preserves metadata for audit. Only the
create response contains the new bearer, exactly once.

Global MCP tokens are separate personal access tokens with `*` authority and a
server-owned `mcp-admin` purpose claim. Only system administrators can create,
list or revoke them, and `/mcp` rejects ordinary administrator PATs. Marcus API
opens a transient MNP client and reauthenticates the token on every MCP request,
so expiry, revocation or user disablement takes effect immediately. The
plaintext value is returned once; only its hash and metadata are persisted.
All MCP tools re-enter the ordinary MNP router, preserving capability checks,
Project scope and audit. Destructive annotations help clients request approval
but do not replace server-side authorization.

Every new or replaced human password is validated by marcusd: it must contain
at least six characters, one uppercase letter and one of `$`, `%`, `#`, `!`,
`&` or `*`. Backoffice validation is only early feedback; the daemon remains
authoritative. Changing an administrator password requires the current
password. Project-local identity edits are rejected when the identity is shared
with another Project or owns a system role.

The 32-byte master key is external to SQLite. Protect and back it up separately;
normal data backups intentionally do not contain it. Never log plaintext
secrets, tokens, cookies, authorization headers, or credential-bearing URLs.

## API security

Browser sessions use HttpOnly, `SameSite=Strict`, secure-by-default cookies and
CSRF tokens for unsafe methods. CORS returns an allow-origin header only for
configured origins. Responses include restrictive browser security headers.
Request size and WebSocket backpressure are bounded. The API and Backoffice
listeners are independently fixed to `127.0.0.1`; Marcus delegates public exposure, TLS
termination and edge controls to an operator-managed reverse proxy.

## External agent entrypoints

Authentication policy belongs to the immutable active AgentVersion. HMAC
requests validate timestamp, nonce, canonical body signature, and replay window.
Marcus persists a hash of the accepted nonce/signature per Project in SQLite
until expiry. Restarting the daemon therefore does not reopen the replay window.

Custom authentication runs through immutable, separately versioned
AuthValidators in auth-only runtime mode. Authentication produces a Principal;
agent authorization and Project RBAC remain separate checks.

The Backoffice Agent AI editor is a separate restricted assistant mode. The
provider receives only file read/write tools, while marcusd binds both calls to
the selected Project and exact `.agent.md` path. Before persisting provider
output, marcusd validates the complete agent source and requires file-write,
agent-create and agent-activate capabilities. It then registers and activates
the immutable version. The browser's confirmation phrase does not replace
these server-side checks.

## Files and operations

Project paths reject traversal and symlinks escaping the Project Home. Writes
are atomic and support expected revisions. Delete moves to managed trash by
default. Backup restore is offline and stages data before replacement.

Run MNP without TLS only on loopback. Non-loopback deployments must use the
configured TLS mode and protect configuration/token files with restrictive
filesystem permissions.
