import { MarcusError, type JsonValue, type SerializedSchema } from "@marcus/contracts";
import { validateSchema } from "@marcus/schema";

export type ProviderCatalogId = "openai" | "deepseek";
export type ReasoningEffort = "low" | "high" | "max";
type StructuredOutputMode = "json_schema" | "json_object" | "prompt" | "text";

export type ModelRole =
  | "agent.default"
  | "markdown.compiler"
  | "markdown.reviewer"
  | "kernel.evaluator"
  | "embedding.default"
  | (string & {});

export interface ProviderCapabilities {
  modelListing: boolean;
  chat: boolean;
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  thinking: boolean;
  vision: boolean;
  embeddings: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | JsonValue;
  reasoningContent?: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Readonly<Record<string, JsonValue>>;
}

export interface ModelGenerationRequest {
  model: string;
  messages: readonly ModelMessage[];
  userId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  outputSchema?: SerializedSchema;
  outputExample?: JsonValue;
  allowStructuredOutputFallback?: boolean;
  thinking?: boolean;
  reasoningEffort?: ReasoningEffort;
  tools?: readonly {
    name: string;
    description: string;
    inputSchema: SerializedSchema;
  }[];
  signal?: AbortSignal;
}

export interface ModelGenerationResponse<T = JsonValue> {
  output: T;
  text?: string;
  reasoningContent?: string;
  toolCalls?: readonly ModelToolCall[];
  finishReason: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
  };
  provider: string;
  model: string;
}

export interface ProviderProbeResult {
  healthy: boolean;
  capabilities: ProviderCapabilities;
  models: readonly string[];
  latencyMs: number;
  error?: { code: string; message: string };
}

export type ModelGenerationStreamEvent =
  | { type: "reasoning-delta"; delta: string }
  | { type: "content-delta"; delta: string }
  | { type: "usage"; usage: NonNullable<ModelGenerationResponse["usage"]> };

export type ModelGenerationStreamListener = (event: ModelGenerationStreamEvent) => void | Promise<void>;

export interface ModelProvider {
  readonly id: string;
  readonly type: string;
  listModels(signal?: AbortSignal): Promise<readonly string[]>;
  probe(signal?: AbortSignal): Promise<ProviderProbeResult>;
  generate<T = JsonValue>(request: ModelGenerationRequest): Promise<ModelGenerationResponse<T>>;
  generateStream<T = JsonValue>(request: ModelGenerationRequest, listener: ModelGenerationStreamListener): Promise<ModelGenerationResponse<T>>;
}

export interface ModelRoleBinding {
  role: ModelRole;
  providerId: string;
  model: string;
  configuration?: Readonly<Record<string, JsonValue>>;
}

export class ModelRoleRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly bindings = new Map<ModelRole, ModelRoleBinding>();

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  bind(binding: ModelRoleBinding): void {
    if (!this.providers.has(binding.providerId)) {
      throw new MarcusError({
        code: "PROVIDER_NOT_FOUND",
        message: `Provider ${binding.providerId} is not registered`,
        retryable: false,
      });
    }
    this.bindings.set(binding.role, structuredClone(binding));
  }

  resolve(role: ModelRole): { provider: ModelProvider; binding: ModelRoleBinding } {
    const binding = this.bindings.get(role);
    if (binding === undefined) {
      throw new MarcusError({ code: "MODEL_ROLE_NOT_CONFIGURED", message: `Model role ${role} is not configured`, retryable: false });
    }
    const provider = this.providers.get(binding.providerId);
    if (provider === undefined) {
      throw new MarcusError({ code: "PROVIDER_NOT_FOUND", message: `Provider ${binding.providerId} is not registered`, retryable: false });
    }
    return { provider, binding: structuredClone(binding) };
  }

  readiness(): Record<string, boolean> {
    const roles: ModelRole[] = [
      "agent.default",
      "markdown.compiler",
      "markdown.reviewer",
      "kernel.evaluator",
      "embedding.default",
    ];
    return Object.fromEntries(roles.map((role) => [role, this.bindings.has(role)]));
  }
}

export interface OpenAICompatibleProviderOptions {
  id: string;
  baseUrl: string;
  catalogId?: ProviderCatalogId;
  apiKey?: string | (() => string | Promise<string>);
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export interface ProviderCatalogEntry {
  id: ProviderCatalogId;
  name: string;
  type: "openai-compatible";
  baseUrl: string;
  description: string;
  defaultModel?: string;
  modelExamples: readonly string[];
  capabilities: ProviderCapabilities;
  structuredOutputModes: readonly Exclude<StructuredOutputMode, "text">[];
  thinking?: { defaultEnabled: boolean; defaultEffort: ReasoningEffort };
}

const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    description: "Modelos OpenAI con tools y Structured Outputs mediante JSON Schema.",
    modelExamples: [],
    capabilities: {
      modelListing: true,
      chat: true,
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      thinking: false,
      vision: true,
      embeddings: true,
    },
    structuredOutputModes: ["json_schema", "json_object", "prompt"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    description: "DeepSeek V4 con Thinking Mode, tools y JSON Output.",
    defaultModel: "deepseek-v4-pro",
    modelExamples: ["deepseek-v4-pro", "deepseek-v4-flash"],
    capabilities: {
      modelListing: true,
      chat: true,
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      thinking: true,
      vision: false,
      embeddings: false,
    },
    structuredOutputModes: ["json_object", "prompt"],
    thinking: { defaultEnabled: true, defaultEffort: "high" },
  },
];

export function listProviderCatalog(): readonly ProviderCatalogEntry[] {
  return structuredClone(PROVIDER_CATALOG);
}

export function providerCatalogEntry(id: string | undefined): ProviderCatalogEntry | undefined {
  const entry = PROVIDER_CATALOG.find((candidate) => candidate.id === id);
  return entry === undefined ? undefined : structuredClone(entry);
}

export function inferProviderCatalogId(baseUrl: string): ProviderCatalogId | undefined {
  let hostname: string;
  try { hostname = new URL(baseUrl).hostname.toLowerCase(); }
  catch { return undefined; }
  if (hostname === "api.deepseek.com") return "deepseek";
  if (hostname === "api.openai.com") return "openai";
  return undefined;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly type = "openai-compatible";
  private readonly baseUrl: string;
  private readonly catalog: ProviderCatalogEntry | undefined;
  private readonly options: OpenAICompatibleProviderOptions;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.catalog = providerCatalogEntry(options.catalogId ?? inferProviderCatalogId(options.baseUrl));
    this.options = options;
  }

  async listModels(signal?: AbortSignal): Promise<readonly string[]> {
    const response = await this.fetch("/models", { method: "GET", ...(signal === undefined ? {} : { signal }) });
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    return (body.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string");
  }

  async probe(signal?: AbortSignal): Promise<ProviderProbeResult> {
    const started = performance.now();
    try {
      const models = await this.listModels(signal);
      return {
        healthy: true,
        models,
        latencyMs: Math.round(performance.now() - started),
        capabilities: this.catalog?.capabilities ?? genericCapabilities(),
      };
    } catch (error) {
      return {
        healthy: false,
        models: [],
        latencyMs: Math.round(performance.now() - started),
        capabilities: {
          modelListing: false,
          chat: false,
          streaming: false,
          toolCalling: false,
          structuredOutput: false,
          thinking: false,
          vision: false,
          embeddings: false,
        },
        error: { code: error instanceof MarcusError ? error.code : "PROVIDER_PROBE_FAILED", message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async generate<T = JsonValue>(request: ModelGenerationRequest): Promise<ModelGenerationResponse<T>> {
    const modes = requestedStructuredOutputModes(request, this.catalog);
    let lastUnavailable: unknown;
    for (let index = 0; index < modes.length; index += 1) {
      const mode = modes[index]!;
      try {
        return await this.complete<T>(request, mode);
      } catch (error) {
        if (index === modes.length - 1 || !responseFormatUnavailable(error)) throw error;
        lastUnavailable = error;
      }
    }
    throw lastUnavailable;
  }

  async generateStream<T = JsonValue>(
    request: ModelGenerationRequest,
    listener: ModelGenerationStreamListener,
  ): Promise<ModelGenerationResponse<T>> {
    const modes = requestedStructuredOutputModes(request, this.catalog);
    let lastUnavailable: unknown;
    for (let index = 0; index < modes.length; index += 1) {
      const mode = modes[index]!;
      try {
        return await this.fetchStreaming(
          "/chat/completions",
          generationInit(request, mode, this.catalog, false, true),
          (response) => consumeCompletionStream<T>(response, request, this.id, listener),
        );
      } catch (error) {
        if (index === modes.length - 1 || !responseFormatUnavailable(error)) throw error;
        lastUnavailable = error;
      }
    }
    throw lastUnavailable;
  }

  private async complete<T>(request: ModelGenerationRequest, mode: StructuredOutputMode): Promise<ModelGenerationResponse<T>> {
    let body = await this.completionBody(request, mode, false);
    let text = completionText(body);
    if (request.outputSchema !== undefined && text.trim() === "") {
      body = await this.completionBody(request, mode, true);
      text = completionText(body);
    }
    const choice = body.choices?.[0];
    const reasoningContent = typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content : undefined;
    const toolCalls = (choice?.message?.tool_calls ?? []).map((call) => parseToolCall(call));
    let output: unknown = text;
    if (request.outputSchema !== undefined) {
      try { output = JSON.parse(stripJsonFence(text)); }
      catch { throw new MarcusError({ code: "PROVIDER_STRUCTURED_OUTPUT_INVALID", message: "Provider returned invalid structured JSON", retryable: true }); }
      const validation = validateSchema<T>(request.outputSchema, output);
      if (!validation.success) {
        throw new MarcusError({
          code: "PROVIDER_STRUCTURED_OUTPUT_SCHEMA_INVALID",
          message: `Provider JSON did not match the requested schema: ${validation.issues.slice(0, 5).map((issue) => `${issue.path || "$"}: ${issue.message}`).join("; ")}`,
          retryable: true,
        });
      }
      output = validation.data;
    }
    return {
      output: output as T,
      text,
      ...(reasoningContent === undefined ? {} : { reasoningContent }),
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown",
      provider: this.id,
      model: request.model,
      ...(body.usage === undefined ? {} : {
        usage: {
          ...(body.usage.prompt_tokens === undefined ? {} : { inputTokens: body.usage.prompt_tokens }),
          ...(body.usage.completion_tokens === undefined ? {} : { outputTokens: body.usage.completion_tokens }),
          ...(body.usage.total_tokens === undefined ? {} : { totalTokens: body.usage.total_tokens }),
        },
      }),
    };
  }

  private async completionBody(request: ModelGenerationRequest, mode: StructuredOutputMode, emptyRetry: boolean): Promise<CompletionBody> {
    const response = await this.fetch("/chat/completions", generationInit(request, mode, this.catalog, emptyRetry, false));
    return await response.json() as CompletionBody;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const apiKey = typeof this.options.apiKey === "function" ? await this.options.apiKey() : this.options.apiKey;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const externalSignal = init.signal;
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...this.options.headers,
          ...init.headers,
          ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
        },
      });
      if (!response.ok) {
        const message = (await response.text()).slice(0, 2_048);
        throw new ProviderHttpError(response.status, message);
      }
      return response;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  private async fetchStreaming<T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
    const apiKey = typeof this.options.apiKey === "function" ? await this.options.apiKey() : this.options.apiKey;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const externalSignal = init.signal;
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...this.options.headers,
          ...init.headers,
          ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
        },
      });
      if (!response.ok) {
        const message = (await response.text()).slice(0, 2_048);
        throw new ProviderHttpError(response.status, message);
      }
      return await consume(response);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }
}

type CompletionBody = {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          tool_calls?: Array<{ id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }>;
        };
        finish_reason?: unknown;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function completionText(body: CompletionBody): string {
  const content = body.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

type CompletionStreamChunk = {
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

async function consumeCompletionStream<T>(
  response: Response,
  request: ModelGenerationRequest,
  providerId: string,
  listener: ModelGenerationStreamListener,
): Promise<ModelGenerationResponse<T>> {
  if (response.body === null) {
    throw new MarcusError({ code: "PROVIDER_STREAM_MISSING", message: "Provider returned an empty streaming body", retryable: true });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoningContent = "";
  let finishReason = "unknown";
  let usage: ModelGenerationResponse["usage"];

  const consumeFrame = async (frame: string): Promise<boolean> => {
    const data = frame
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (data === "" || data.startsWith(":")) return false;
    if (data === "[DONE]") return true;
    let chunk: CompletionStreamChunk;
    try { chunk = JSON.parse(data) as CompletionStreamChunk; }
    catch {
      throw new MarcusError({ code: "PROVIDER_STREAM_INVALID", message: "Provider returned an invalid SSE JSON chunk", retryable: true });
    }
    const choice = chunk.choices?.[0];
    const reasoning = typeof choice?.delta?.reasoning_content === "string" ? choice.delta.reasoning_content : "";
    const content = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
    if (reasoning !== "") {
      reasoningContent += reasoning;
      await listener({ type: "reasoning-delta", delta: reasoning });
    }
    if (content !== "") {
      text += content;
      await listener({ type: "content-delta", delta: content });
    }
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    if (chunk.usage !== undefined) {
      usage = {
        ...(chunk.usage.prompt_tokens === undefined ? {} : { inputTokens: chunk.usage.prompt_tokens }),
        ...(chunk.usage.completion_tokens === undefined ? {} : { outputTokens: chunk.usage.completion_tokens }),
        ...(chunk.usage.total_tokens === undefined ? {} : { totalTokens: chunk.usage.total_tokens }),
      };
      await listener({ type: "usage", usage });
    }
    return false;
  };

  let done = false;
  while (!done) {
    const part = await reader.read();
    buffer += decoder.decode(part.value, { stream: !part.done });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (await consumeFrame(frame)) {
        done = true;
        break;
      }
    }
    if (part.done) {
      if (buffer.trim() !== "") await consumeFrame(buffer);
      break;
    }
  }

  let output: unknown = text;
  if (request.outputSchema !== undefined) {
    if (text.trim() === "") {
      throw new MarcusError({ code: "PROVIDER_STRUCTURED_OUTPUT_INVALID", message: "Provider returned an empty structured response", retryable: true });
    }
    try { output = JSON.parse(stripJsonFence(text)); }
    catch { throw new MarcusError({ code: "PROVIDER_STRUCTURED_OUTPUT_INVALID", message: "Provider returned invalid structured JSON", retryable: true }); }
    const validation = validateSchema<T>(request.outputSchema, output);
    if (!validation.success) {
      throw new MarcusError({
        code: "PROVIDER_STRUCTURED_OUTPUT_SCHEMA_INVALID",
        message: `Provider JSON did not match the requested schema: ${validation.issues.slice(0, 5).map((issue) => `${issue.path || "$"}: ${issue.message}`).join("; ")}`,
        retryable: true,
      });
    }
    output = validation.data;
  }

  return {
    output: output as T,
    text,
    ...(reasoningContent === "" ? {} : { reasoningContent }),
    finishReason,
    provider: providerId,
    model: request.model,
    ...(usage === undefined ? {} : { usage }),
  };
}

class ProviderHttpError extends MarcusError {
  constructor(readonly status: number, readonly responseBody: string) {
    super({ code: "PROVIDER_HTTP_ERROR", message: `Provider returned ${status}: ${responseBody}`, retryable: status >= 500 || status === 429 });
  }
}

function generationInit(
  request: ModelGenerationRequest,
  mode: StructuredOutputMode,
  catalog: ProviderCatalogEntry | undefined,
  emptyRetry: boolean,
  stream: boolean,
): RequestInit {
  const messages = request.outputSchema === undefined || mode === "json_schema"
    ? request.messages
    : structuredOutputMessages(request.messages, request.outputSchema, request.outputExample);
  const retryMessages = emptyRetry
    ? appendSystemInstruction(messages, "The previous structured response was empty. Return the complete JSON value now.")
    : messages;
  const thinking = thinkingConfiguration(request, catalog);
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      messages: retryMessages.map(openAiMessage),
      ...(request.userId === undefined ? {} : { user_id: request.userId }),
      ...(stream ? { stream: true } : {}),
      ...(request.temperature === undefined || thinking?.enabled === true ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      ...(thinking === undefined ? {} : { thinking: { type: thinking.enabled ? "enabled" : "disabled" } }),
      ...(thinking?.enabled === true && thinking.effort !== undefined ? { reasoning_effort: thinking.effort } : {}),
      ...(mode === "json_schema" && request.outputSchema !== undefined
        ? { response_format: { type: "json_schema", json_schema: { name: "marcus_output", strict: true, schema: request.outputSchema } } }
        : {}),
      ...(mode === "json_object" ? { response_format: { type: "json_object" } } : {}),
      ...(request.tools === undefined
        ? {}
        : { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }),
    }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

function structuredOutputModes(request: ModelGenerationRequest, catalog: ProviderCatalogEntry | undefined): StructuredOutputMode[] {
  const schema = request.outputSchema;
  if (schema === undefined) return ["text"];
  const configured = catalog?.structuredOutputModes ?? ["json_schema", "json_object", "prompt"];
  return configured.filter((mode) => mode !== "json_object" || schemaAllowsJsonObject(schema));
}

function requestedStructuredOutputModes(request: ModelGenerationRequest, catalog: ProviderCatalogEntry | undefined): StructuredOutputMode[] {
  const modes = structuredOutputModes(request, catalog);
  return request.allowStructuredOutputFallback === false ? modes.slice(0, 1) : modes;
}

function schemaAllowsJsonObject(schema: SerializedSchema): boolean {
  if (schema.type === "object") return true;
  return schema.anyOf?.some((candidate) => candidate.type === "object") ?? false;
}

function thinkingConfiguration(
  request: ModelGenerationRequest,
  catalog: ProviderCatalogEntry | undefined,
): { enabled: boolean; effort?: ReasoningEffort } | undefined {
  if (request.thinking !== undefined) {
    return { enabled: request.thinking, ...(request.thinking && request.reasoningEffort !== undefined ? { effort: request.reasoningEffort } : {}) };
  }
  if (catalog?.thinking?.defaultEnabled !== true) return undefined;
  return { enabled: true, effort: request.reasoningEffort ?? catalog.thinking.defaultEffort };
}

function structuredOutputMessages(messages: readonly ModelMessage[], schema: SerializedSchema, outputExample?: JsonValue): ModelMessage[] {
  const example = outputExample ?? exampleFromSchema(schema);
  const instruction = `Return only one valid JSON value matching this JSON Schema. Do not include Markdown fences, commentary or any text outside the JSON value.\nJSON Schema:\n${JSON.stringify(schema)}\nExample JSON output:\n${JSON.stringify(example)}`;
  return appendSystemInstruction(messages, instruction);
}

function appendSystemInstruction(messages: readonly ModelMessage[], instruction: string): ModelMessage[] {
  const result = messages.map((message) => ({ ...message }));
  const systemIndex = result.findIndex((message) => message.role === "system");
  if (systemIndex < 0) return [{ role: "system", content: instruction }, ...result];
  const system = result[systemIndex]!;
  result[systemIndex] = { ...system, content: `${typeof system.content === "string" ? system.content : JSON.stringify(system.content)}\n\n${instruction}` };
  return result;
}

function exampleFromSchema(schema: SerializedSchema): JsonValue {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.[0] !== undefined) return schema.enum[0]!;
  if (schema.anyOf?.[0] !== undefined) return exampleFromSchema(schema.anyOf[0]);
  if (schema.type === "object") {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, exampleFromSchema(value)]));
  }
  if (schema.type === "array") return schema.items === undefined ? [] : [exampleFromSchema(schema.items)];
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  return "value";
}

function genericCapabilities(): ProviderCapabilities {
  return {
    modelListing: true,
    chat: true,
    streaming: true,
    toolCalling: true,
    structuredOutput: true,
    thinking: false,
    vision: false,
    embeddings: true,
  };
}

function responseFormatUnavailable(error: unknown): boolean {
  if (!(error instanceof ProviderHttpError) || (error.status !== 400 && error.status !== 422)) return false;
  const message = error.responseBody.toLowerCase();
  return message.includes("response_format")
    && (message.includes("unavailable") || message.includes("unsupported") || message.includes("not supported") || message.includes("not available"));
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/iu);
  return match?.[1]?.trim() ?? trimmed;
}

function openAiMessage(message: ModelMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.role === "tool" && typeof message.content !== "string" ? JSON.stringify(message.content) : message.content,
    ...(message.reasoningContent === undefined ? {} : { reasoning_content: message.reasoningContent }),
    ...(message.name === undefined ? {} : { name: message.name }),
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
    ...(message.toolCalls === undefined ? {} : {
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }),
  };
}

function parseToolCall(call: { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }): ModelToolCall {
  if (typeof call.id !== "string" || call.type !== "function" || typeof call.function?.name !== "string" || typeof call.function.arguments !== "string") {
    throw new MarcusError({ code: "PROVIDER_TOOL_CALL_INVALID", message: "Provider returned an invalid tool call", retryable: true });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(call.function.arguments); }
  catch { throw new MarcusError({ code: "PROVIDER_TOOL_CALL_INVALID", message: "Provider returned invalid tool arguments", retryable: true }); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MarcusError({ code: "PROVIDER_TOOL_CALL_INVALID", message: "Provider tool arguments must be an object", retryable: true });
  }
  return { id: call.id, name: call.function.name, arguments: parsed as Record<string, JsonValue> };
}
