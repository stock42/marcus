import { expect, test } from "bun:test";
import { STUDIO_OUTPUT_EXAMPLE } from "./prompt";
import { validateStudioOutput } from "./validation";

test("validates generated Markdown with the real Marcus compiler", async () => {
  const output = await validateStudioOutput(STUDIO_OUTPUT_EXAMPLE, "markdown");
  expect(output.valid).toBe(true);
  expect(output.filename).toBe("movie-recommender.agent.md");
  expect(output.validationLabel).toContain("Compilación determinística");
});

test("statically validates TypeScript without executing it", async () => {
  const output = await validateStudioOutput({
    format: "typescript",
    filename: "support.ts",
    name: "Support",
    summary: "Resume una consulta.",
    source: `import { definePromptTask, m } from "@marcus/sdk";

export default definePromptTask({
  id: "support",
  name: "Support",
  input: m.object({ message: m.string() }),
  output: m.object({ summary: m.string() }),
  system: "Respondé en español.",
  prompt: ({ input }) => input.message,
});`,
    assumptions: [],
    warnings: [],
  }, "typescript");
  expect(output.valid).toBe(true);
  expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: "STUDIO_TS_NOT_EXECUTED" }));
});

test("rejects public TypeScript capabilities outside the SDK", async () => {
  const output = await validateStudioOutput({
    format: "typescript",
    filename: "unsafe.ts",
    name: "Unsafe",
    summary: "No debe pasar.",
    source: `import { definePromptTask } from "@marcus/sdk";
export default definePromptTask({ id: "unsafe", run: () => fetch("https://example.com") });`,
    assumptions: [],
    warnings: [],
  }, "typescript");
  expect(output.valid).toBe(false);
  expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: "STUDIO_TS_CAPABILITY_FORBIDDEN" }));
});

test("typechecks generated TypeScript against the virtual Marcus SDK", async () => {
  const output = await validateStudioOutput({
    format: "typescript",
    filename: "typed.ts",
    name: "Typed",
    summary: "Debe detectar el campo inexistente.",
    source: `import { definePromptTask, m } from "@marcus/sdk";
export default definePromptTask({
  id: "typed",
  name: "Typed",
  input: m.object({ message: m.string() }),
  output: m.object({ answer: m.string() }),
  system: "Respondé en español.",
  prompt: ({ input }) => input.missing,
});`,
    assumptions: [],
    warnings: [],
  }, "typescript");
  expect(output.valid).toBe(false);
  expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: "STUDIO_TS_2339", line: 8 }));
});
