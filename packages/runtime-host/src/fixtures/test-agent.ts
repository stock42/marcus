import { defineAgent, defineTool, m } from "@marcus/sdk";

const uppercase = defineTool({
  id: "uppercase",
  description: "Uppercase one value",
  input: m.object({ value: m.string() }),
  output: m.object({ value: m.string() }),
  async execute(_context, input) { return { value: input.value.toUpperCase() }; },
});

export default defineAgent({
  id: "runtime-test",
  name: "Runtime Test",
  input: m.object({ mode: m.enum(["echo", "tool", "hang"]), value: m.string() }),
  output: m.object({ value: m.string() }),
  tools: [uppercase],
  async onRun(context, input) {
    context.logger.info("run-started", { mode: input.mode });
    context.progress.report({ stage: input.mode, current: 1, total: 1 });
    if (input.mode === "tool") {
      return context.tools.call<{ value: string }>("uppercase", { value: input.value });
    }
    if (input.mode === "hang") await new Promise<never>(() => undefined);
    return { value: input.value };
  },
});
