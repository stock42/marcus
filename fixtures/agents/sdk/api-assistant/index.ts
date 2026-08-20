import { defineAssistant, m } from "@marcus/sdk";

export default defineAssistant({
  id: "api-assistant",
  name: "API Assistant",
  input: m.object({ message: m.string({ minLength: 1 }) }),
  output: m.object({ text: m.string() }),
  entrypoints: {
    cli: { enabled: true },
    api: { enabled: true, authentication: { type: "marcus-token" } },
  },
  system: "Answer without inventing facts.",
  prompt: ({ input }) => input.message,
});
