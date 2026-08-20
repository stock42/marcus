# Markdown agents

Markdown agents provide a declarative authoring path that compiles to the same
`marcus.agent/v1` contract as SDK agents.

## Source shape

A source starts with YAML frontmatter delimited by `---`, followed by canonical
top-level sections such as `Objective`, `System`, `Prompt`, `Input`, `Output`,
`Rules`, `Tools`, `Execution`, and `Examples`.

The frontmatter declares identity, runtime, entrypoints, authentication,
conversation, rate-limit, and concurrency settings. IDs use kebab-case. Input
and output typed schema blocks can be compiled deterministically.

Official tools are an explicit frontmatter allowlist:

```yaml
tools:
  - marcus/files.list
  - marcus/files.read
  - marcus/events.publish
```

Unknown identifiers fail compilation. Markdown agents cannot embed custom
`defineTool` implementations; use the TypeScript SDK for those. The complete
catalog and runtime policy are documented in [TOOLS.md](./TOOLS.md).

The first frontmatter field for every source is:

```yaml
schema: marcus.agent/v1
```

Other values are not aliases and fail compilation with
`schema must be marcus.agent/v1`.

Schema blocks accept the canonical object form:

```yaml
object:
  ingredients:
    type: array
    items:
      type: string
required: [ingredients]
additional-properties: false
```

For concise generated sources, the same properties may appear directly at the
top level; Marcus compiles both forms to identical `properties` in the active
contract:

```yaml
ingredients:
  type: array
  items:
    type: string
required: [ingredients]
additional-properties: false
```

## Compilation

1. Parse the restricted YAML and Markdown structure.
2. Produce diagnostics with line/section context.
3. Compile deterministic schemas and manifest fields when sufficient.
4. If semantic interpretation is required, use the configured
   `markdown.compiler` model role.
5. Stop for unresolved questions or non-informational assumptions unless they
   were explicitly accepted.
6. Validate the resulting manifest and emit a Bun runtime artifact.

Generated JavaScript is a runtime artifact in the managed builds area, not
source documentation and not a package-level `dist/` contract.

## CLI workflow

```text
agent scaffold ./hello --kind markdown
put local:./hello.agent.md project:/agents/hello.agent.md
agent create project:/agents/hello.agent.md
agent diff hello
agent apply hello
```

Saving the same registered `.agent.md` from the Backoffice editor keeps the
change as a `Dirty` draft so a manual edit cannot silently replace the active
version. Open the Agent detail and choose `Usar esta edición`: Marcus validates
and compiles the complete source, registers a new immutable version and only
then activates it. If validation fails, the previous version remains active.
The Agent version history also exposes the immutable compilation result: its
manifest JSON, the generated TypeScript intermediate and the JavaScript loaded
by Runtime Host.

## Natural-language workflow

The Backoffice Project detail screen accepts a plain-language description of
the desired Agent. Marcus sends it through `markdown.compiler` (or the
`agent.default` fallback), requires a complete declarative source, compiles it
with the same deterministic Markdown compiler, stores it as
`project:/agents/<slug>.agent.md`, and activates the first immutable version.
The generated source can then be reviewed and edited in the Project editor.

Generation is not a second execution format: the LLM produces authoring input,
while Marcus' compiler and manifest validation remain authoritative.
Generated sources receive the canonical schema header before compilation. If a
different Markdown diagnostic remains, Marcus gives the configured compiler
role one bounded correction attempt and validates the complete source again.
Backoffice progress reports these operational phases without returning private
provider reasoning.

Use Markdown when a declarative contract is sufficient. Use the TypeScript SDK
for custom lifecycle code or direct Bun-compatible library access.
