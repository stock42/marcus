# TypeScript SDK

`@marcus/sdk` authors Bun-native TypeScript agents. It exports source TypeScript
and requires Bun; consumers do not need a generated `dist/` directory.

## Installation

In any Bun TypeScript project, install the public package from npm:

```bash
bun add @marcus/sdk
```

The repository being public does not publish npm packages automatically. The
command above becomes available for a version only after an authorized
maintainer publishes that version in the public `@marcus` scope. Contributors
can validate the exact tarball without publishing it with
`bun run publish:sdk:dry-run` from the monorepo root.

## Minimal agent

```ts
import { defineAgent, m } from "@marcus/sdk";

export default defineAgent({
  id: "hello",
  name: "Hello",
  input: m.object({ name: m.string() }),
  output: m.object({ message: m.string() }),
  entrypoints: { cli: { enabled: true } },
  async onRun(_context, input) {
    return { message: `Hello ${input.name}` };
  },
});
```

Agent and tool IDs use kebab-case. Inputs and outputs use the serializable `m`
schema DSL. Definitions become immutable `marcus.agent/v1` manifests when
built.

## First agent workflow

Inside the Marcus console, create and select a Project, scaffold a local source,
upload it, then build and invoke it:

```text
project create first-agent --name "First Agent"
use project first-agent
agent scaffold ./hello --kind sdk
```

In a regular shell, install the generated SDK dependency:

```bash
cd hello
bun install
cd ..
```

Back in the Marcus console:

```text
put local:./hello/index.ts project:/agents/hello/index.ts
agent create project:/agents/hello/index.ts
agent run hello --input '{"name":"Ada"}'
```

The public Spanish guide at `/documentacion/sdk` explains each command, the
generated source, schemas, Runtime Context, model and tool calls, entrypoints,
security and the Bun test harness. `/documentacion/markdown` documents the
declarative authoring path to the same manifest contract.

## Definition kinds

- `defineAgent`: explicit lifecycle handlers and optional first-party loop.
- `definePromptTask`: deterministic single model task.
- `defineAssistant`: conversational assistant loop.
- `defineTool`: typed managed capability with timeout and risk metadata.
- `defineAuthValidator`: reusable external credential validator.

## Runtime context

`AgentContext` exposes managed logging, progress, model calls, tools, subagents,
messages, events, conversations, checkpoints, artifacts, Project files,
secrets, approvals, cancellation, principal, trace, Run, Project, and instance
identity. Use these managed APIs when the behavior must be observable or
durable.

Definitions may configure runtime profile/residency, CLI/API/schedule/event/
message entrypoints, conversations, rate limits, concurrency, model settings,
tools, skills, assets, recovery, authorization, and lifecycle hooks.

The complete official catalog, declaration syntax, schemas, risk levels,
idempotency, cancellation, approvals, discovery and custom `defineTool`
contract are maintained in [TOOLS.md](./TOOLS.md). A tool is executable only
when the current immutable AgentVersion allowlists its exact descriptor.

## Model generation

`context.model.generate` routes through the configured Marcus model role. It
accepts messages, an optional output schema, temperature, output-token limit and
explicit Thinking controls:

```ts
const result = await context.model.generate({
  messages: [{ role: "user", content: "Return the current status as JSON." }],
  output: m.object({ status: m.string() }),
  maxOutputTokens: 2_048,
  thinking: true,
  reasoningEffort: "high",
});
```

When the role uses the first-party DeepSeek profile, Thinking `high` and JSON
Output are automatic; explicit request fields can override the role defaults.
Marcus validates structured output before returning it to the agent. Provider
reasoning is private control-plane context and is deliberately absent from the
SDK response and Run output.

## API authentication

Supported entrypoint policies are Marcus token, bearer secret, API key, HMAC,
and custom AuthValidator. HMAC policies may set header names and a replay
window. Never hardcode secret values; reference a Marcus secret.

## Testing

```ts
import { createAgentTestHarness } from "@marcus/sdk/testing";
import agent from "./index.ts";

const harness = createAgentTestHarness(agent);
const result = await harness.run({ name: "Ada" });
```

Run package tests with Bun. `bun run pack` stages a self-contained TypeScript
package under a temporary directory, installs it in an external temporary Bun
project, typechecks and executes both public exports, then writes checksummed
artifacts to `artifacts/packages/`. The standalone Marcus compiler embeds the
same public SDK surface, so server-side builds of uploaded agent source do not
depend on this repository's `node_modules`.
