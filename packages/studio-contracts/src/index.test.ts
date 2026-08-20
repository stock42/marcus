import { expect, test } from "bun:test";
import {
  STUDIO_LIMITS,
  parseStudioGenerationRequest,
  safeStudioFilename,
} from "./index";

test("accepts a first public Studio generation", () => {
  const result = parseStudioGenerationRequest({
    requestId: "streq_0123456789abcdef",
    idempotencyKey: "idem_0123456789abcdef",
    format: "markdown",
    prompt: "Quiero recomendar películas según preferencias explícitas.",
  });
  expect(result.success).toBe(true);
});

test("rejects invalid formats and oversized source revisions", () => {
  expect(parseStudioGenerationRequest({
    requestId: "streq_0123456789abcdef",
    idempotencyKey: "idem_0123456789abcdef",
    format: "javascript",
    prompt: "Este prompt sí alcanza el mínimo requerido.",
  }).success).toBe(false);

  expect(parseStudioGenerationRequest({
    requestId: "streq_0123456789abcdef",
    idempotencyKey: "idem_0123456789abcdef",
    format: "typescript",
    prompt: "Ajustá el contrato existente con una salida explicada.",
    baseVersion: { number: 1, filename: "agent.ts", source: "x".repeat(STUDIO_LIMITS.sourceBytes + 1) },
  }).success).toBe(false);
});

test("normalizes generated filenames to the selected Marcus source kind", () => {
  expect(safeStudioFilename("Recomendador de películas.md", "markdown")).toBe("recomendador-de-peliculas.agent.md");
  expect(safeStudioFilename("Support Agent.tsx", "typescript")).toBe("support-agent.ts");
});
