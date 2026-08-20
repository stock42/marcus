import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MarcusError,
  officialToolManifest,
  type AgentManifest,
  type JsonObject,
  type JsonValue,
  type SerializedSchema,
} from "@marcus/contracts";
import { validateSchema } from "@marcus/schema";
import { parseMarcusYaml } from "./yaml";

export { parseMarcusYaml } from "./yaml";

export interface MarkdownDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  line?: number;
  column?: number;
  section?: string;
  suggestion?: string;
}

export interface ParsedMarkdownAgent {
  frontmatter: Readonly<Record<string, JsonValue>>;
  sections: Readonly<Record<string, string>>;
  diagnostics: readonly MarkdownDiagnostic[];
  source: string;
}

export interface SemanticCompilationResult {
  manifestDraft: AgentManifest;
  assumptions: readonly { id: string; severity: "informational" | "review-required" | "critical"; message: string }[];
  warnings: readonly MarkdownDiagnostic[];
  unresolved: readonly { id: string; question: string }[];
  confidence: number;
}

export interface MarkdownSemanticCompiler {
  compile(parsed: ParsedMarkdownAgent): Promise<SemanticCompilationResult>;
}

export interface MarkdownCompilation {
  parsed: ParsedMarkdownAgent;
  manifest: AgentManifest;
  assumptions: SemanticCompilationResult["assumptions"];
  diagnostics: readonly MarkdownDiagnostic[];
  deterministic: boolean;
}

const canonicalSections = new Set(["objective", "system", "prompt", "input", "output", "rules", "sources", "tools", "skills", "execution", "evaluation", "examples", "notes"]);

export function parseMarkdownAgent(source: string): ParsedMarkdownAgent {
  const lines = source.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") throw markdownError("MD_FRONTMATTER_REQUIRED", "Markdown Agent must start with ---", 1);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw markdownError("MD_FRONTMATTER_UNCLOSED", "Frontmatter closing delimiter is missing", 1);
  const parsedFrontmatter = parseMarcusYaml(lines.slice(1, end).join("\n"), 1);
  if (!isObject(parsedFrontmatter)) throw markdownError("MD_FRONTMATTER_INVALID", "Frontmatter must be an object", 2);
  const body = lines.slice(end + 1);
  const sections: Record<string, string> = {};
  const diagnostics: MarkdownDiagnostic[] = [];
  let section: string | undefined;
  let content: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (section !== undefined) sections[section] = content.join("\n").trim();
    content = [];
  };
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index]!;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u);
    if (fenceMatch !== null) fence = fence === undefined ? fenceMatch[1] : fence === fenceMatch[1] ? undefined : fence;
    const heading = fence === undefined ? line.match(/^#\s+(.+?)\s*$/u) : null;
    if (heading !== null) {
      flush();
      section = heading[1]!.trim().toLowerCase();
      if (!canonicalSections.has(section)) diagnostics.push({ code: "MD_UNKNOWN_SECTION", severity: "warning", message: `Unknown section ${heading[1]}`, line: end + index + 2, section });
    } else if (section !== undefined) content.push(line);
  }
  flush();
  if (fence !== undefined) throw markdownError("MD_CODE_FENCE_UNCLOSED", "A code fence is not closed", lines.length);
  validateIdentity(parsedFrontmatter);
  return { frontmatter: parsedFrontmatter, sections, diagnostics, source };
}

export async function compileMarkdownAgent(
  source: string,
  options: { semanticCompiler?: MarkdownSemanticCompiler; sourceHash?: string; acceptAssumptions?: readonly string[] } = {},
): Promise<MarkdownCompilation> {
  const parsed = parseMarkdownAgent(source);
  const deterministic = tryDeterministicManifest(parsed, options.sourceHash ?? hashText(source));
  if (deterministic !== undefined) {
    validateManifest(deterministic);
    return { parsed, manifest: deterministic, assumptions: [], diagnostics: parsed.diagnostics, deterministic: true };
  }
  if (options.semanticCompiler === undefined) {
    throw new MarcusError({
      code: "MODEL_ROLE_MARKDOWN_COMPILER_MISSING",
      message: "Markdown source requires the markdown.compiler model role; deterministic schemas were not sufficient",
      retryable: false,
    });
  }
  const semantic = await options.semanticCompiler.compile(parsed);
  const accepted = new Set(options.acceptAssumptions ?? []);
  const blocking = semantic.assumptions.filter((item) => item.severity !== "informational" && !accepted.has(item.id));
  if (blocking.length > 0 || semantic.unresolved.length > 0) {
    throw new MarcusError({
      code: "MD_ASSUMPTION_REQUIRES_CONFIRMATION",
      message: "Semantic compilation has unresolved questions or assumptions",
      retryable: false,
      details: { assumptions: blocking.map((item) => item.id), unresolved: semantic.unresolved.map((item) => item.id) },
    });
  }
  validateManifest(semantic.manifestDraft);
  return {
    parsed,
    manifest: semantic.manifestDraft,
    assumptions: semantic.assumptions,
    diagnostics: [...parsed.diagnostics, ...semantic.warnings],
    deterministic: false,
  };
}

export async function emitMarkdownArtifact(
  compilation: MarkdownCompilation,
  outputDirectory: string,
): Promise<{ artifactPath: string; artifactHash: string; manifestHash: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const manifestJson = JSON.stringify(compilation.manifest);
  const system = compilation.parsed.sections.system ?? compilation.parsed.sections.objective ?? "";
  const prompt = compilation.parsed.sections.prompt ?? "Complete the requested task using the provided input.";
  const sourcePath = resolve(outputDirectory, `${compilation.manifest.identity.id}.generated.ts`);
  const artifactPath = resolve(outputDirectory, `${compilation.manifest.identity.id}.js`);
  const schemaModule = fileURLToPath(import.meta.resolve("@marcus/schema"));
  const generated = `import { schemaFromJSON } from ${JSON.stringify(schemaModule)};\nconst manifest=${manifestJson};\nconst inputSchema=schemaFromJSON(manifest.contract.inputSchema);\nconst outputSchema=schemaFromJSON(manifest.contract.outputSchema);\nconst definition={system:${JSON.stringify(system)},prompt:({input})=>${JSON.stringify(prompt)}+"\\n\\nInput:\\n"+JSON.stringify(input)};\nconst agent={ [Symbol.for("marcus.agent.module")]:true, kind:manifest.identity.kind, definition, inputSchema, outputSchema, toManifest:()=>manifest };\nexport default Object.freeze(agent);\n`;
  await Bun.write(sourcePath, generated);
  const build = await Bun.build({ entrypoints: [sourcePath], outdir: outputDirectory, naming: `${compilation.manifest.identity.id}.js`, target: "bun", format: "esm", minify: false });
  if (!build.success) throw new MarcusError({ code: "MD_ARTIFACT_BUILD_FAILED", message: build.logs.map((log) => log.message).join("\n"), retryable: false });
  const artifactHash = hashBytes(new Uint8Array(await Bun.file(artifactPath).arrayBuffer()));
  return { artifactPath, artifactHash, manifestHash: hashText(stableJson(compilation.manifest)) };
}

function tryDeterministicManifest(parsed: ParsedMarkdownAgent, sourceHash: string): AgentManifest | undefined {
  const inputBlock = extractTypedBlock(parsed.sections.input, "schema");
  const outputBlock = extractTypedBlock(parsed.sections.output, "schema");
  if (inputBlock === undefined || outputBlock === undefined) return undefined;
  const inputSchema = compileSchema(parseMarcusYaml(inputBlock));
  const outputSchema = compileSchema(parseMarcusYaml(outputBlock));
  const front = parsed.frontmatter;
  const kind = stringValue(front.kind, "agent") as AgentManifest["identity"]["kind"];
  const runtime = objectValue(front.runtime);
  const api = objectValue(front.api);
  const authentication = objectValue(api.authentication);
  const apiEnabled = booleanValue(front["api-enabled"], false);
  const cliEnabled = booleanValue(front["cli-enabled"], true);
  const internalOnly = booleanValue(front["internal-only"], false);
  const profile = stringValue(runtime.profile, "worker") as AgentManifest["runtime"]["profile"];
  const residency = stringValue(runtime.residency, "on-demand") as AgentManifest["runtime"]["residency"];
  const manifest: AgentManifest = {
    schemaVersion: "marcus.agent/v1",
    identity: {
      id: String(front.id),
      name: String(front.name),
      kind,
      ...(typeof front.description !== "string" ? {} : { description: front.description }),
      ...(internalOnly ? { internalOnly: true } : {}),
    },
    runtime: {
      profile,
      residency,
      startupTimeoutMs: duration(runtime["startup-timeout"], 15_000),
      shutdownTimeoutMs: duration(runtime["shutdown-timeout"], 10_000),
      heartbeatIntervalMs: duration(runtime["heartbeat-interval"], 5_000),
      heartbeatTimeoutMs: duration(runtime["heartbeat-timeout"], 20_000),
    },
    contract: { inputSchema, outputSchema },
    entrypoints: {
      cli: { enabled: cliEnabled },
      ...(apiEnabled
        ? {
            api: {
              enabled: true,
              response: {
                mode: stringValue(objectValue(api.response).mode, "auto") as "sync" | "async" | "auto",
                ...(objectValue(api.response).wait === undefined ? {} : { waitMs: duration(objectValue(api.response).wait, 30_000) }),
              },
              authentication: compileAuthentication(authentication),
            },
          }
        : {}),
      ...(front.schedules === undefined ? {} : { schedules: compileSchedules(front.schedules) }),
      ...(front.events === undefined ? {} : { events: compileEvents(front.events) }),
      ...(front.messages === undefined ? {} : { messages: { enabled: booleanValue(isObject(front.messages) ? front.messages.enabled : front.messages, true) } }),
    },
    handlers: { defaultLoop: kind === "prompt-task" ? "first-party:prompt-task" : kind === "assistant" ? "first-party:assistant-loop" : "first-party:agent-loop" },
    build: { sourceKind: "markdown", sourceHash, compilerVersion: "0.1.0" },
    ...(front.conversation === undefined ? {} : { conversation: compileConversation(objectValue(front.conversation)) }),
    ...(front["rate-limits"] === undefined ? {} : { rateLimits: compileRateLimits(front["rate-limits"]) }),
    ...(front.concurrency === undefined ? {} : { concurrency: compileConcurrency(objectValue(front.concurrency)) }),
    ...(front.tools === undefined ? {} : { tools: arrayValue(front.tools).map((id) => {
      const tool = officialToolManifest(String(id));
      if (tool === undefined) throw new MarcusError({ code: "MD_TOOL_NOT_REGISTERED", message: `Tool ${String(id)} is not an official Marcus tool`, retryable: false });
      return tool;
    }) }),
    ...(front.skills === undefined ? {} : { skills: arrayValue(front.skills).map((id) => ({ id: String(id) })) }),
    ...(front.assets === undefined ? {} : { assets: { staticDir: String(objectValue(front.assets)["static-dir"] ?? "./public"), expose: booleanValue(objectValue(front.assets).expose, false) } }),
    ...(front.recovery === undefined ? {} : { recovery: compileRecovery(objectValue(front.recovery)) }),
    ...(parsed.sections.execution === undefined ? {} : { loop: parseTypedObject(parsed.sections.execution, "execution") }),
    ...(parsed.sections.evaluation === undefined ? {} : { evaluation: parseTypedObject(parsed.sections.evaluation, "evaluation") }),
  };
  if (/\b(?:secret|secrets)\s*\./iu.test(`${parsed.sections.prompt ?? ""}\n${parsed.sections.system ?? ""}`)) {
    throw new MarcusError({ code: "MD_SECRET_INTERPOLATION_FORBIDDEN", message: "Prompt and System may not interpolate secrets", retryable: false });
  }
  return manifest;
}

function compileSchedules(value: JsonValue): NonNullable<AgentManifest["entrypoints"]["schedules"]> {
  const ids = new Set<string>();
  return arrayValue(value).map((item) => {
    const schedule = objectValue(item);
    const id = String(schedule.id ?? "");
    const cron = String(schedule.cron ?? "");
    const timezone = String(schedule.timezone ?? "UTC");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || ids.has(id)) throw new MarcusError({ code: "MD_SCHEDULE_INVALID", message: "Schedule id must be unique kebab-case", retryable: false });
    if (cron.trim().split(/\s+/u).length !== 5) throw new MarcusError({ code: "MD_SCHEDULE_INVALID", message: `Schedule ${id} cron must have five fields`, retryable: false });
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
    catch { throw new MarcusError({ code: "MD_SCHEDULE_INVALID", message: `Schedule ${id} timezone is invalid`, retryable: false }); }
    ids.add(id);
    return { id, cron, timezone, ...(schedule.input === undefined ? {} : { input: schedule.input }) };
  });
}

function compileEvents(value: JsonValue): NonNullable<AgentManifest["entrypoints"]["events"]> {
  return arrayValue(value).map((item) => {
    const event = objectValue(item);
    const topic = String(event.topic ?? "");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(topic)) throw new MarcusError({ code: "MD_EVENT_INVALID", message: "Event topic is invalid", retryable: false });
    return { topic, ...(typeof event["input-path"] === "string" ? { inputPath: event["input-path"] } : {}) };
  });
}

function compileRecovery(value: Record<string, JsonValue>): JsonObject {
  return {
    ...(typeof value.policy === "string" ? { policy: value.policy } : {}),
    ...(typeof value["max-restarts"] === "number" ? { maxRestarts: value["max-restarts"] } : {}),
  };
}

function compileSchema(value: JsonValue): SerializedSchema {
  if (!isObject(value)) throw new MarcusError({ code: "MD_SCHEMA_INVALID", message: "Schema block must be an object", retryable: false });
  if (isObject(value.object)) {
    const required = arrayValue(value.required).map(String);
    const properties = Object.fromEntries(Object.entries(value.object).map(([key, item]) => [key, compileSchema(item)]));
    return { type: "object", properties, required, additionalProperties: booleanValue(value["additional-properties"], false) };
  }
  const type = String(value.type ?? "object") as NonNullable<SerializedSchema["type"]>;
  const schema: SerializedSchema = { type };
  if (type === "array") schema.items = compileSchema(value.items ?? {});
  const explicitProperties = isObject(value.properties) ? value.properties : undefined;
  const implicitProperties = Object.fromEntries(Object.entries(value).filter(([key]) => !schemaKeywords.has(key)));
  const properties = explicitProperties ?? (Object.keys(implicitProperties).length === 0 ? undefined : implicitProperties);
  if (type === "object" && properties !== undefined) schema.properties = Object.fromEntries(Object.entries(properties).map(([key, item]) => [key, compileSchema(item)]));
  if (Array.isArray(value.required)) schema.required = value.required.map(String);
  if (value["additional-properties"] !== undefined) schema.additionalProperties = booleanValue(value["additional-properties"], false);
  for (const [from, to] of [["min-length", "minLength"], ["max-length", "maxLength"], ["minimum", "minimum"], ["maximum", "maximum"], ["min-items", "minItems"], ["max-items", "maxItems"]] as const) {
    if (typeof value[from] === "number") schema[to] = value[from];
  }
  if (typeof value.pattern === "string") schema.pattern = value.pattern;
  if (typeof value.format === "string") schema.format = value.format;
  if (Array.isArray(value.enum)) schema.enum = value.enum;
  return schema;
}

const schemaKeywords = new Set([
  "type", "object", "properties", "required", "additional-properties", "items",
  "min-length", "max-length", "minimum", "maximum", "min-items", "max-items",
  "pattern", "format", "enum",
]);

function compileAuthentication(value: Record<string, JsonValue>): NonNullable<AgentManifest["entrypoints"]["api"]>["authentication"] {
  const type = stringValue(value.type, "marcus-token");
  if (type === "none") {
    if (!booleanValue(value.public, false)) throw new MarcusError({ code: "MD_API_AUTH_REQUIRED", message: "Anonymous API requires public: true", retryable: false });
    return { type: "none", public: true };
  }
  if (type === "bearer-secret") return { type, secret: String(value.secret ?? "") };
  if (type === "hmac") return { type, secret: String(value.secret ?? ""), ...(typeof value.header === "string" ? { header: value.header } : {}) };
  if (type === "validator") return { type, scheme: String(value.scheme ?? "bearer"), validator: String(value.validator ?? "") };
  return { type: "marcus-token" };
}

function compileConversation(value: Record<string, JsonValue>): NonNullable<AgentManifest["conversation"]> {
  return {
    enabled: booleanValue(value.enabled, true),
    chatIdPath: String(value["chat-id"] ?? "input.chatId"),
    missingChatId: stringValue(value["missing-chat-id"], "required") as "required" | "generate" | "optional",
    scope: stringValue(value.scope, "principal+chat") as "principal+chat" | "chat-only" | "principal-only",
    history: { maxMessages: numberValue(value["history-limit"], 100), ...(value.retention === undefined ? {} : { retentionMs: duration(value.retention, 0) }) },
    injection: stringValue(value.injection, "automatic") as "automatic" | "manual" | "none",
  };
}

function compileRateLimits(value: JsonValue): NonNullable<AgentManifest["rateLimits"]> {
  return arrayValue(value).map((item, index) => {
    const rule = objectValue(item);
    return {
      name: String(rule.name ?? `rule-${index + 1}`),
      scope: String(rule.scope) as "ip" | "connection" | "principal" | "conversation" | "agent" | "project" | "custom",
      algorithm: String(rule.algorithm) as "token-bucket" | "fixed-window" | "rolling-window",
      limit: numberValue(rule.limit, 1),
      windowMs: duration(rule.window, 60_000),
      ...(typeof rule.burst === "number" ? { burst: rule.burst } : {}),
    };
  });
}

function compileConcurrency(value: Record<string, JsonValue>): NonNullable<AgentManifest["concurrency"]> {
  return {
    ...(typeof value.total === "number" ? { total: value.total } : {}),
    ...(typeof value["per-principal"] === "number" ? { perPrincipal: value["per-principal"] } : {}),
    ...(typeof value["per-conversation"] === "number" ? { perConversation: value["per-conversation"] } : {}),
    ...(typeof value["queue-limit"] === "number" ? { queueLimit: value["queue-limit"] } : {}),
    ...(value["queue-timeout"] === undefined ? {} : { queueTimeoutMs: duration(value["queue-timeout"], 0) }),
  };
}

function validateManifest(manifest: AgentManifest): void {
  if (manifest.schemaVersion !== "marcus.agent/v1") throw new MarcusError({ code: "MD_SCHEMA_VERSION_INVALID", message: "schema must be marcus.agent/v1", retryable: false });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(manifest.identity.id)) throw new MarcusError({ code: "MD_ID_INVALID", message: "id must be kebab-case", retryable: false });
  if (!["agent", "prompt-task", "assistant"].includes(manifest.identity.kind)) throw new MarcusError({ code: "MD_KIND_INVALID", message: "kind is invalid", retryable: false });
  if (manifest.runtime.profile === "container") throw new MarcusError({ code: "RUNTIME_CONTAINER_UNAVAILABLE", message: "container profile is unavailable in v1", retryable: false });
  if (manifest.entrypoints.api?.enabled === true && manifest.entrypoints.api.authentication.type === "none" && manifest.entrypoints.api.authentication.public !== true) {
    throw new MarcusError({ code: "MD_API_AUTH_REQUIRED", message: "Anonymous API requires public: true", retryable: false });
  }
  if (!validateSchema(manifest.contract.inputSchema, sampleFor(manifest.contract.inputSchema)).success && manifest.contract.inputSchema.type === undefined) {
    throw new MarcusError({ code: "MD_SCHEMA_INVALID", message: "Input schema is invalid", retryable: false });
  }
}

function validateIdentity(front: Record<string, JsonValue>): void {
  if (front.schema !== "marcus.agent/v1") throw markdownError("MD_SCHEMA_VERSION_INVALID", "schema must be marcus.agent/v1", 2);
  if (typeof front.id !== "string" || typeof front.name !== "string") throw markdownError("MD_IDENTITY_REQUIRED", "id and name are required", 2);
}

function extractTypedBlock(section: string | undefined, language: string): string | undefined {
  if (section === undefined) return undefined;
  const match = section.match(new RegExp("```(?:yaml\\s+" + language + "|" + language + ")\\s*\\n([\\s\\S]*?)\\n```", "iu"));
  return match?.[1];
}

function parseTypedObject(section: string, type: string): JsonObject {
  const block = extractTypedBlock(section, type);
  const value = block === undefined ? {} : parseMarcusYaml(block);
  return isObject(value) ? value : {};
}

function duration(value: JsonValue | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return fallback;
  const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u);
  if (match === null) throw new MarcusError({ code: "MD_DURATION_INVALID", message: `Invalid duration ${value}`, retryable: false });
  return Number(match[1]) * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!]!);
}

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> {
  return isObject(value) ? value : {};
}
function arrayValue(value: JsonValue | undefined): JsonValue[] { return Array.isArray(value) ? value : []; }
function stringValue(value: JsonValue | undefined, fallback: string): string { return typeof value === "string" ? value : fallback; }
function booleanValue(value: JsonValue | undefined, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function numberValue(value: JsonValue | undefined, fallback: number): number { return typeof value === "number" ? value : fallback; }
function isObject(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hashText(value: string): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
function hashBytes(value: Uint8Array): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sampleFor(schema: SerializedSchema): JsonValue {
  if (schema.type === "object") return Object.fromEntries((schema.required ?? []).map((key) => [key, sampleFor(schema.properties?.[key] ?? {})]));
  if (schema.type === "array") return [];
  if (schema.type === "string") return "";
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  return null;
}
function markdownError(code: string, message: string, line: number): MarcusError { return new MarcusError({ code, message, retryable: false, details: { line } }); }
