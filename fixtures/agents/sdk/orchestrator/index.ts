import { defineAgent, m } from "@marcus/sdk";

export default defineAgent({
  id: "orchestrator",
  name: "Orchestrator",
  input: m.object({ request: m.string() }),
  output: m.object({ result: m.unknown() }),
  async onRun(context, input) {
    const result = await context.agents.run({ agent: "prompt-task", input: { request: input.request }, parentClose: "request-cancel" });
    return { result };
  },
});
