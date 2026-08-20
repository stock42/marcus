import { definePromptTask, m } from "@marcus/sdk";

export default definePromptTask({
  id: "prompt-task",
  name: "Prompt Task",
  input: m.object({ request: m.string({ minLength: 1 }) }),
  output: m.object({ answer: m.string() }),
  system: "Answer the request accurately.",
  prompt: ({ input }) => input.request,
});
