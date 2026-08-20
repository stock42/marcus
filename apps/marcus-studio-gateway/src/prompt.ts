import type { SerializedSchema } from "@marcus/contracts";
import type { ModelMessage } from "@marcus/provider-contracts";
import type { StudioFormat, StudioGenerationRequest } from "@marcus/studio-contracts";

export type ProviderStudioOutput = {
  format: StudioFormat;
  filename: string;
  name: string;
  summary: string;
  source: string;
  assumptions: string[];
  warnings: string[];
};

export const STUDIO_OUTPUT_SCHEMA: SerializedSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["markdown", "typescript"] },
    filename: { type: "string", minLength: 1, maxLength: 120 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    source: { type: "string", minLength: 1, maxLength: 65_536 },
    assumptions: { type: "array", items: { type: "string" }, maxItems: 10 },
    warnings: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["format", "filename", "name", "summary", "source", "assumptions", "warnings"],
  additionalProperties: false,
};

export const STUDIO_OUTPUT_EXAMPLE: ProviderStudioOutput = {
  format: "markdown",
  filename: "movie-recommender.agent.md",
  name: "Movie Recommender",
  summary: "Recomienda películas desde preferencias explícitas.",
  source: [
    "---",
    "schema: marcus.agent/v1",
    "id: movie-recommender",
    "name: Movie Recommender",
    "kind: prompt-task",
    "cli-enabled: true",
    "---",
    "",
    "# Objective",
    "",
    "Recomendar películas explicando su relación con las preferencias recibidas.",
    "",
    "# System",
    "",
    "No inventes preferencias. Respondé en español.",
    "",
    "# Prompt",
    "",
    "Analizá las preferencias y generá recomendaciones justificadas.",
    "",
    "# Input",
    "",
    "```yaml schema",
    "object:",
    "  preferences:",
    "    type: array",
    "    items:",
    "      type: string",
    "required: [preferences]",
    "additional-properties: false",
    "```",
    "",
    "# Output",
    "",
    "```yaml schema",
    "object:",
    "  recommendations:",
    "    type: array",
    "    items:",
    "      type: object",
    "      properties:",
    "        title:",
    "          type: string",
    "        reason:",
    "          type: string",
    "      required: [title, reason]",
    "      additional-properties: false",
    "required: [recommendations]",
    "additional-properties: false",
    "```",
  ].join("\n"),
  assumptions: ["Las preferencias llegan como una lista de textos."],
  warnings: [],
};

const TYPESCRIPT_EXAMPLE = [
  'import { definePromptTask, m } from "@marcus/sdk";',
  "",
  "export default definePromptTask({",
  '  id: "movie-recommender",',
  '  name: "Movie Recommender",',
  '  description: "Recomienda películas desde preferencias explícitas.",',
  "  input: m.object({",
  "    preferences: m.array(m.string({ minLength: 1 }), { minItems: 1 }),",
  "  }),",
  "  output: m.object({",
  "    recommendations: m.array(m.object({",
  "      title: m.string(),",
  "      reason: m.string(),",
  "    })),",
  "  }),",
  '  system: "Respondé en español. No inventes preferencias ausentes.",',
  '  prompt: ({ input }) => `Recomendá películas para: ${input.preferences.join(", ")}`,',
  "});",
].join("\n");

export function studioMessages(request: StudioGenerationRequest): ModelMessage[] {
  const system = `Sos Marcus Agent Studio, un arquitecto experto en agentes Marcus.
Tu única tarea es devolver un objeto JSON con un archivo de fuente portable y didáctico.
Nunca ejecutes, despliegues ni simules el agente. No uses tools, red, filesystem, secrets ni imports externos.
El resultado debe ser sencillo, completo, coherente con el brief y apto para copiar o descargar.
No incluyas Markdown fences alrededor del objeto JSON ni alrededor del campo source.

Para format=markdown:
- filename termina en .agent.md;
- frontmatter empieza exactamente con --- y schema: marcus.agent/v1;
- id kebab-case, kind prompt-task y cli-enabled true;
- incluye Objective, System, Prompt, Input y Output;
- Input y Output usan bloques yaml schema deterministas con required y additional-properties.

Para format=typescript:
- filename termina en .ts;
- único import permitido: @marcus/sdk;
- export default de definePromptTask, defineAssistant o defineAgent;
- preferí definePromptTask para tareas resueltas por un modelo;
- contratos construidos con m; sin eval, import dinámico, process, Bun ni APIs globales con efectos.

Ejemplo TypeScript válido:
${TYPESCRIPT_EXAMPLE}`;
  const task = request.baseVersion === undefined
    ? `Creá un agente format=${request.format} para este brief:\n${request.prompt}`
    : `Refiná el siguiente agente format=${request.format} sin cambiar de formato.\n\nFuente vigente (${request.baseVersion.filename}, v${request.baseVersion.number}):\n${request.baseVersion.source}\n\nAjuste solicitado:\n${request.prompt}`;
  return [{ role: "system", content: system }, { role: "user", content: task }];
}
