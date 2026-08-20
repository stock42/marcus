import type { JsonValue, SerializedSchema } from "./index";

export type ToolRisk = "low" | "medium" | "high" | "critical";
export type ToolSource = "marcus" | "agent";

export type ToolIdempotencyManifest =
  | { strategy: "none" }
  | { strategy: "input-hash" | "caller-key"; scope: "run" | "agent-version" };

export interface ToolManifest {
  id: string;
  version: string;
  source: ToolSource;
  description: string;
  inputSchema: SerializedSchema;
  outputSchema: SerializedSchema;
  timeoutMs: number;
  cancellable: boolean;
  sideEffects: boolean;
  risk: ToolRisk;
  idempotency: ToolIdempotencyManifest;
}

export interface ToolCallOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
}

const stringSchema = (options: Omit<SerializedSchema, "type"> = {}): SerializedSchema => ({ type: "string", ...options });
const integerSchema = (options: Omit<SerializedSchema, "type"> = {}): SerializedSchema => ({ type: "integer", ...options });
const booleanSchema = (): SerializedSchema => ({ type: "boolean" });
const objectSchema = (
  properties: Readonly<Record<string, SerializedSchema>>,
  required: readonly string[] = [],
  additionalProperties: boolean | SerializedSchema = false,
): SerializedSchema => ({ type: "object", properties, required, additionalProperties });
const arraySchema = (items: SerializedSchema): SerializedSchema => ({ type: "array", items });
const unknownSchema = (): SerializedSchema => ({});
const enumSchema = (...values: readonly string[]): SerializedSchema => ({ type: "string", enum: values });

const projectPath = stringSchema({ pattern: "^project:/" });
const fileMetadata = objectSchema({
  path: projectPath,
  kind: enumSchema("file", "directory", "symlink"),
  size: integerSchema({ minimum: 0 }),
  revision: integerSchema({ minimum: 0 }),
  sha256: stringSchema(),
  mediaType: stringSchema(),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["path", "kind", "size", "revision", "updatedAt"]);

const officialTool = (definition: Omit<ToolManifest, "source" | "version">): ToolManifest => ({
  ...definition,
  source: "marcus",
  version: "1.0.0",
});

export const MARCUS_OFFICIAL_TOOL_CATALOG: readonly ToolManifest[] = [
  officialTool({
    id: "marcus/files.read",
    description: "Read one file from the current Project and return its bytes as Base64.",
    inputSchema: objectSchema({ path: projectPath }, ["path"]),
    outputSchema: objectSchema({ data: stringSchema(), encoding: enumSchema("base64") }, ["data", "encoding"]),
    timeoutMs: 10_000,
    cancellable: false,
    sideEffects: false,
    risk: "low",
    idempotency: { strategy: "none" },
  }),
  officialTool({
    id: "marcus/files.search",
    description: "Search text inside files owned by the current Project.",
    inputSchema: objectSchema({ query: stringSchema({ minLength: 1 }), path: projectPath }, ["query"]),
    outputSchema: arraySchema(objectSchema({ path: projectPath, line: integerSchema({ minimum: 1 }), text: stringSchema() }, ["path", "line", "text"])),
    timeoutMs: 15_000,
    cancellable: false,
    sideEffects: false,
    risk: "low",
    idempotency: { strategy: "none" },
  }),
  officialTool({
    id: "marcus/files.list",
    description: "List the immediate children of a Project directory.",
    inputSchema: objectSchema({ path: projectPath }),
    outputSchema: arraySchema(fileMetadata),
    timeoutMs: 10_000,
    cancellable: false,
    sideEffects: false,
    risk: "low",
    idempotency: { strategy: "none" },
  }),
  officialTool({
    id: "marcus/files.stat",
    description: "Return metadata for one Project file or directory.",
    inputSchema: objectSchema({ path: projectPath }, ["path"]),
    outputSchema: fileMetadata,
    timeoutMs: 10_000,
    cancellable: false,
    sideEffects: false,
    risk: "low",
    idempotency: { strategy: "none" },
  }),
  officialTool({
    id: "marcus/files.write",
    description: "Atomically write UTF-8 or Base64 content inside the current Project.",
    inputSchema: objectSchema({
      path: projectPath,
      content: stringSchema(),
      encoding: enumSchema("utf8", "base64"),
      expectedRevision: integerSchema({ minimum: 0 }),
      mediaType: stringSchema(),
    }, ["path", "content"]),
    outputSchema: fileMetadata,
    timeoutMs: 15_000,
    cancellable: false,
    sideEffects: true,
    risk: "high",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/files.move",
    description: "Move a Project file or directory to another Project path.",
    inputSchema: objectSchema({ from: projectPath, to: projectPath }, ["from", "to"]),
    outputSchema: objectSchema({ from: projectPath, to: projectPath, moved: booleanSchema() }, ["from", "to", "moved"]),
    timeoutMs: 15_000,
    cancellable: false,
    sideEffects: true,
    risk: "high",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/files.delete",
    description: "Permanently delete a Project file or directory after explicit human approval.",
    inputSchema: objectSchema({ path: projectPath }, ["path"]),
    outputSchema: objectSchema({ path: projectPath, deleted: booleanSchema() }, ["path", "deleted"]),
    timeoutMs: 15_000,
    cancellable: false,
    sideEffects: true,
    risk: "critical",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/http.request",
    description: "Execute a bounded HTTP or HTTPS request without following redirects.",
    inputSchema: objectSchema({
      url: stringSchema({ format: "uri" }),
      method: enumSchema("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"),
      headers: objectSchema({}, [], stringSchema()),
      body: stringSchema(),
      bodyEncoding: enumSchema("utf8", "base64"),
      timeoutMs: integerSchema({ minimum: 1, maximum: 120_000 }),
      maxResponseBytes: integerSchema({ minimum: 1, maximum: 4_194_304 }),
    }, ["url"]),
    outputSchema: objectSchema({
      status: integerSchema({ minimum: 100, maximum: 599 }),
      statusText: stringSchema(),
      headers: objectSchema({}, [], stringSchema()),
      body: stringSchema(),
      encoding: enumSchema("utf8", "base64"),
      truncated: booleanSchema(),
    }, ["status", "statusText", "headers", "body", "encoding", "truncated"]),
    timeoutMs: 30_000,
    cancellable: true,
    sideEffects: true,
    risk: "high",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/artifacts.create",
    description: "Create an immutable Run artifact from inline content or a Project file.",
    inputSchema: objectSchema({
      name: stringSchema({ minLength: 1 }),
      mediaType: stringSchema({ minLength: 1 }),
      content: stringSchema(),
      encoding: enumSchema("utf8", "base64"),
      projectPath,
      visibility: enumSchema("private", "public", "signed"),
    }, ["name", "mediaType"]),
    outputSchema: objectSchema({ artifactId: stringSchema() }, ["artifactId"]),
    timeoutMs: 20_000,
    cancellable: false,
    sideEffects: true,
    risk: "medium",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/agents.invoke",
    description: "Invoke another active agent in the current Project as a child Run.",
    inputSchema: objectSchema({
      agent: stringSchema({ minLength: 1 }),
      input: unknownSchema(),
      wait: booleanSchema(),
      parentClose: enumSchema("terminate", "request-cancel", "detach"),
    }, ["agent", "input"]),
    outputSchema: unknownSchema(),
    timeoutMs: 86_400_000,
    cancellable: true,
    sideEffects: true,
    risk: "high",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/runs.get",
    description: "Read one Run from the current Project.",
    inputSchema: objectSchema({ runId: stringSchema({ minLength: 1 }) }, ["runId"]),
    outputSchema: objectSchema({}, [], true),
    timeoutMs: 10_000,
    cancellable: false,
    sideEffects: false,
    risk: "low",
    idempotency: { strategy: "none" },
  }),
  officialTool({
    id: "marcus/events.publish",
    description: "Publish a Project event and trigger matching agent entrypoints.",
    inputSchema: objectSchema({ topic: stringSchema({ minLength: 1 }), payload: unknownSchema() }, ["topic", "payload"]),
    outputSchema: objectSchema({ eventId: stringSchema(), eventSeq: integerSchema({ minimum: 1 }), triggeredRuns: arraySchema(stringSchema()) }, ["eventId", "eventSeq", "triggeredRuns"]),
    timeoutMs: 30_000,
    cancellable: false,
    sideEffects: true,
    risk: "high",
    idempotency: { strategy: "caller-key", scope: "agent-version" },
  }),
  officialTool({
    id: "marcus/approvals.request",
    description: "Pause the Run and request an explicit human decision.",
    inputSchema: objectSchema({ action: stringSchema({ minLength: 1 }), prompt: stringSchema({ minLength: 1 }), data: unknownSchema() }, ["action", "prompt"]),
    outputSchema: unknownSchema(),
    timeoutMs: 86_400_000,
    cancellable: true,
    sideEffects: true,
    risk: "medium",
    idempotency: { strategy: "none" },
  }),
] as const;

export function officialToolManifest(id: string): ToolManifest | undefined {
  return MARCUS_OFFICIAL_TOOL_CATALOG.find((tool) => tool.id === id);
}

export function isToolManifest(value: unknown): value is ToolManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<ToolManifest>;
  const idempotency = candidate.idempotency as Partial<ToolIdempotencyManifest> | undefined;
  const validIdempotency = idempotency?.strategy === "none"
    || ((idempotency?.strategy === "input-hash" || idempotency?.strategy === "caller-key")
      && (idempotency.scope === "run" || idempotency.scope === "agent-version"));
  return typeof candidate.id === "string"
    && candidate.id.length > 0
    && typeof candidate.version === "string"
    && candidate.version.length > 0
    && (candidate.source === "marcus" || candidate.source === "agent")
    && typeof candidate.description === "string"
    && typeof candidate.timeoutMs === "number"
    && typeof candidate.cancellable === "boolean"
    && typeof candidate.sideEffects === "boolean"
    && (candidate.risk === "low" || candidate.risk === "medium" || candidate.risk === "high" || candidate.risk === "critical")
    && typeof candidate.inputSchema === "object"
    && candidate.inputSchema !== null
    && typeof candidate.outputSchema === "object"
    && candidate.outputSchema !== null
    && validIdempotency;
}

export function toolManifestJson(tool: ToolManifest): JsonValue {
  return tool as unknown as JsonValue;
}
