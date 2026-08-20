# `@marcus/sdk`

Author TypeScript agents for Marcus Agentic OS.

## Installation

```bash
bun add @marcus/sdk
```

This command requires the requested version to have been published to npm;
making the source repository public is a separate operation.

The SDK publishes native TypeScript and requires Bun 1.3.14 or newer. It does
not ship a `dist/` directory.

```ts
import { defineAgent, m } from "@marcus/sdk";

export default defineAgent({
  id: "hello",
  name: "Hello",
  input: m.object({ name: m.string() }),
  output: m.object({ message: m.string() }),
  async onRun(_ctx, input) {
    return { message: `Hello ${input.name}` };
  },
});
```

Test an agent without starting Marcus:

```ts
import { createAgentTestHarness } from "@marcus/sdk/testing";
import agent from "./index.ts";

const result = await createAgentTestHarness(agent).run({ name: "Ada" });
console.log(result.output);
```

Full documentation: https://projectmarcus.com/documentacion/sdk

Licensed under Apache-2.0.
