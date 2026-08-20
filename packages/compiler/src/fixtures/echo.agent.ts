import { defineAgent, m } from "@marcus/sdk";

export default defineAgent({
  id: "compiled-echo",
  name: "Compiled Echo",
  input: m.object({ text: m.string() }),
  output: m.object({ text: m.string() }),
  async onRun(_context, input) {
    return { text: input.text };
  },
});
