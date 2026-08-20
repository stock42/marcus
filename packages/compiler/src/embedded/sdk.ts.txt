/// <reference types="bun" />

import {
  MarcusError,
  type AgentKind,
  type AgentManifest,
  type ConcurrencyPolicy,
  type EntrypointManifest,
  type JsonObject,
  type JsonValue,
  type Principal,
  type RateLimitRule,
  type SerializedSchema,
  type ToolCallOptions,
  type ToolIdempotencyManifest,
  type ToolManifest,
  type ToolRisk,
  MARCUS_OFFICIAL_TOOL_CATALOG,
  officialToolManifest,
} from "@marcus/contracts";
import { m, type Infer, type MarcusSchema } from "@marcus/schema";

export { MarcusError, m };
export type { Infer, MarcusSchema } from "@marcus/schema";
export { MARCUS_OFFICIAL_TOOL_CATALOG } from "@marcus/contracts";
export type { AgentManifest, Principal, ToolCallOptions, ToolIdempotencyManifest, ToolManifest, ToolRisk } from "@marcus/contracts";

export const MARCUS_SDK_VERSION = "0.1.0";
const moduleSymbol = Symbol.for("marcus.agent.module");

type AnySchema = MarcusSchema<unknown, boolean>;

export interface RuntimeDefinition {
  profile?: "worker" | "process" | "container";
  residency?: "on-demand" | "resident";
  startupTimeout?: Duration;
  shutdownTimeout?: Duration;
  heartbeatInterval?: Duration;
  heartbeatTimeout?: Duration;
}

export type Duration = number | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

export type AuthenticationDefinition =
  | { type: "marcus-token" }
  | { type: "bearer-secret"; secret: string }
  | { type: "hmac"; secret: string; header?: string; timestampHeader?: string; replayWindow?: Duration }
  | {
      type: "custom";
      scheme: string;
      validate: AuthenticationHandler;
    }
  | { type: "validator"; scheme: string; validator: string }
  | { type: "none"; public: true };

export interface EntrypointsDefinition {
  cli?: { enabled: boolean };
  api?: {
    enabled: boolean;
    response?: { mode: "sync" | "async" | "auto"; wait?: Duration };
    authentication?: AuthenticationDefinition;
  };
  schedules?: readonly { id: string; cron: string; timezone: string; input?: JsonValue }[];
  events?: readonly { topic: string; inputPath?: string }[];
  messages?: { enabled: boolean };
}

export interface ConversationDefinition<I> {
  enabled: true;
  chatId?: (context: { input: I }) => string | undefined;
  chatIdPath?: string;
  missingChatId?: "required" | "generate" | "optional";
  scope?: "principal+chat" | "chat-only" | "principal-only";
  history?: { maxMessages?: number; retention?: Duration };
  injection?: "automatic" | "manual" | "none";
}

export interface AgentContext {
  readonly signal: AbortSignal;
  readonly project: { id: string; slug: string; homePath: string };
  readonly agent: { id: string; versionId: string; instanceId: string };
  readonly run: { id: string; entrypoint: string; principal?: Principal; traceId: string; deadlineAt?: string };
  readonly logger: AgentLogger;
  readonly progress: ProgressApi;
  readonly model: ModelApi;
  readonly tools: ToolRuntimeApi;
  readonly agents: SubagentApi;
  readonly messages: MessageApi;
  readonly events: EventApi;
  readonly conversation?: ConversationApi;
  readonly checkpoint: CheckpointApi;
  readonly artifacts: ArtifactApi;
  readonly files: ProjectFileApi;
  readonly secrets: SecretApi;
  readonly approvals: ApprovalApi;
}

export interface AgentLogger {
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
  redact(value: unknown): unknown;
}

export interface ProgressApi {
  report(progress: { current?: number; total?: number; unit?: string; stage?: string; message?: string }): void;
  waiting(input: { reason: string; until?: Date }): Promise<void>;
}

export interface ModelApi {
  generate<T>(input: {
    role?: string;
    system?: string;
    messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string | JsonValue }[];
    output?: MarcusSchema<T, boolean>;
    temperature?: number;
    maxOutputTokens?: number;
    thinking?: boolean;
    reasoningEffort?: "low" | "high" | "max";
    timeout?: Duration;
  }): Promise<ModelResponse<T>>;
}

export interface ModelResponse<T> {
  output: T;
  text?: string;
  finishReason: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: number };
  provider: string;
  model: string;
}

export interface ToolRuntimeApi {
  call<T = JsonValue>(tool: string, input: JsonValue, options?: ToolCallOptions): Promise<T>;
  list(): Promise<readonly ToolManifest[]>;
  get(tool: string): Promise<ToolManifest>;
}

export interface SubagentApi {
  run<T = JsonValue>(input: {
    agent: string;
    input: JsonValue;
    parentClose?: "terminate" | "request-cancel" | "detach";
    wait?: boolean;
  }): Promise<T>;
  parallel<T = JsonValue>(
    tasks: readonly { agent: string; input: JsonValue; parentClose?: "terminate" | "request-cancel" | "detach" }[],
    options?: { concurrency?: number; join?: JsonObject; failure?: string },
  ): Promise<T>;
}

export interface MessageApi {
  send(input: { recipient: string; type: string; payload: JsonValue }): Promise<{ messageId: string }>;
}

export interface EventApi {
  publish(topic: string, payload: JsonValue): Promise<void>;
}

export interface ConversationApi {
  readonly id: string;
  readonly chatId: string;
  readonly principalId?: string;
  listMessages(options?: { limit?: number; beforeSequence?: number }): Promise<readonly JsonValue[]>;
  appendMessage(message: JsonValue): Promise<void>;
  getMetadata<T>(): Promise<T | undefined>;
  setMetadata<T>(value: T): Promise<void>;
  clear(options?: { before?: string }): Promise<void>;
}

export interface CheckpointApi {
  save(input: { schemaVersion: number; resumeKey: string; domainState: JsonValue }): Promise<{ checkpointId: string }>;
}

export interface ArtifactApi {
  fromBytes(input: {
    name: string;
    mediaType: string;
    bytes: Uint8Array;
    visibility?: "private" | "public" | "signed";
  }): Promise<{ artifactId: string }>;
  fromProjectFile(path: string): Promise<{ artifactId: string }>;
}

export interface ProjectFileApi {
  read(path: string): Promise<Uint8Array>;
  write(path: string, content: Uint8Array | string, options?: { expectedRevision?: number }): Promise<{ revision: number }>;
}

export interface SecretApi {
  ref(name: string): { name: string };
  get(name: string): Promise<string>;
}

export interface ApprovalApi {
  request<T = JsonValue>(input: { action: string; prompt: string; data?: JsonValue }): Promise<T>;
}

export interface AuthenticationContext {
  readonly signal: AbortSignal;
  readonly project: { id: string; slug: string };
  readonly agent: { id: string; versionId: string };
  readonly request: {
    method: string;
    path: string;
    remoteAddress?: string;
    headers: Readonly<Record<string, string>>;
  };
  readonly logger: AgentLogger;
  readonly secrets: SecretApi;
}

export interface Credential {
  scheme: string;
  token?: string;
  signature?: string;
  timestamp?: string;
  headers?: Readonly<Record<string, string>>;
}

export type AuthenticationHandler = (
  context: AuthenticationContext,
  credential: Credential,
) => Promise<
  | { authenticated: true; principal: Principal }
  | { authenticated: false; code?: string }
>;

interface BaseDefinition<TInputSchema extends AnySchema, TOutputSchema extends AnySchema> {
  id: string;
  name: string;
  description?: string;
  tags?: readonly string[];
  internalOnly?: boolean;
  input: TInputSchema;
  output: TOutputSchema;
  runtime?: RuntimeDefinition;
  entrypoints?: EntrypointsDefinition;
  conversation?: ConversationDefinition<Infer<TInputSchema>>;
  rateLimits?: readonly RateLimitDefinition[];
  concurrency?: ConcurrencyDefinition;
  model?: Readonly<Record<string, JsonValue>>;
  tools?: readonly (ToolReference | DefinedTool)[];
  skills?: readonly string[];
  assets?: { staticDir: string; expose?: boolean };
  recovery?: Readonly<Record<string, JsonValue>>;
  authorization?: {
    authorize(context: AgentContext, request: { principal: Principal; input: Infer<TInputSchema>; entrypoint: string }):
      | Promise<{ allowed: boolean; code?: string }>
      | { allowed: boolean; code?: string };
  };
}

export interface AgentDefinition<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>
  extends BaseDefinition<TInputSchema, TOutputSchema> {
  objective?: string;
  system?: string;
  prompt?: (context: { input: Infer<TInputSchema> }) => string;
  loop?: Readonly<Record<string, JsonValue>>;
  evaluation?: Readonly<Record<string, JsonValue>>;
  onStart?: (context: AgentContext) => Promise<void>;
  onRun?: (context: AgentContext, input: Infer<TInputSchema>) => Promise<Infer<TOutputSchema>>;
  onResume?: (context: AgentContext, checkpoint: JsonValue) => Promise<Infer<TOutputSchema>>;
  onCancel?: (context: AgentContext, reason: string) => Promise<void>;
  onStop?: (context: AgentContext) => Promise<void>;
  onError?: (context: AgentContext, error: Error) => Promise<void>;
  onEnd?: (context: AgentContext, result: JsonValue) => Promise<void>;
}

export interface PromptTaskDefinition<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>
  extends BaseDefinition<TInputSchema, TOutputSchema> {
  system: string;
  prompt: (context: { input: Infer<TInputSchema> }) => string;
}

export interface AssistantDefinition<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>
  extends BaseDefinition<TInputSchema, TOutputSchema> {
  system: string;
  prompt?: (context: { input: Infer<TInputSchema> }) => string;
}

export interface RateLimitDefinition {
  name?: string;
  entrypoints?: readonly ("cli" | "api" | "schedule" | "event" | "message" | "adapter")[];
  scope: RateLimitRule["scope"];
  algorithm: RateLimitRule["algorithm"];
  limit: number;
  window: Duration;
  burst?: number;
  key?: (context: { principal?: Principal; input: JsonValue }) => string;
}

export interface ConcurrencyDefinition {
  total?: number;
  perPrincipal?: number;
  perConversation?: number;
  queueLimit?: number;
  queueTimeout?: Duration;
  saturation?: "queue" | "reject" | "shed-low-priority";
}

export interface MarcusAgentModule<I = unknown, O = unknown> {
  readonly [moduleSymbol]: true;
  readonly kind: AgentKind;
  readonly definition: Readonly<Record<string, unknown>>;
  readonly inputSchema: MarcusSchema<I, boolean>;
  readonly outputSchema: MarcusSchema<O, boolean>;
  toManifest(options?: ManifestBuildOptions): AgentManifest;
}

export interface ManifestBuildOptions {
  sourceHash?: string;
  compilerVersion?: string;
  entrypoint?: string;
}

export interface ToolReference { id: string }

export interface ToolDefinition<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
> {
  id: string;
  description: string;
  input: TInputSchema;
  output: TOutputSchema;
  timeout?: Duration;
  cancellable?: boolean;
  idempotency?: ToolIdempotencyManifest;
  sideEffects?: boolean;
  risk?: ToolRisk;
  execute(context: AgentContext, input: Infer<TInputSchema>): Promise<Infer<TOutputSchema>>;
}

export type DefinedTool<
  TInputSchema extends AnySchema = AnySchema,
  TOutputSchema extends AnySchema = AnySchema,
> = ToolDefinition<TInputSchema, TOutputSchema> & { readonly type: "tool" };

export interface AuthValidatorDefinition {
  id: string;
  scheme: string;
  validate: AuthenticationHandler;
}

export function defineAgent<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>(
  definition: AgentDefinition<TInputSchema, TOutputSchema>,
): MarcusAgentModule<Infer<TInputSchema>, Infer<TOutputSchema>> {
  return createModule("agent", definition);
}

export function definePromptTask<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>(
  definition: PromptTaskDefinition<TInputSchema, TOutputSchema>,
): MarcusAgentModule<Infer<TInputSchema>, Infer<TOutputSchema>> {
  return createModule("prompt-task", definition);
}

export function defineAssistant<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>(
  definition: AssistantDefinition<TInputSchema, TOutputSchema>,
): MarcusAgentModule<Infer<TInputSchema>, Infer<TOutputSchema>> {
  return createModule("assistant", definition);
}

export function defineTool<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>(
  definition: ToolDefinition<TInputSchema, TOutputSchema>,
): DefinedTool<TInputSchema, TOutputSchema> {
  if (definition.id.startsWith("marcus/")) {
    throw new MarcusError({ code: "SDK_TOOL_NAMESPACE_RESERVED", message: `Tool namespace marcus/ is reserved for official tools: ${definition.id}`, retryable: false });
  }
  assertKebabCase(definition.id);
  return Object.freeze({ ...definition, type: "tool" as const });
}

export function defineAuthValidator(definition: AuthValidatorDefinition): AuthValidatorDefinition & { readonly type: "auth-validator" } {
  assertKebabCase(definition.id);
  return Object.freeze({ ...definition, type: "auth-validator" as const });
}

export const tools = {
  load(ids: readonly string[]): ToolReference[] {
    return ids.map((id) => ({ id }));
  },
  ref(id: string): ToolReference {
    return { id };
  },
  official(): readonly ToolManifest[] {
    return MARCUS_OFFICIAL_TOOL_CATALOG;
  },
};

export function isDefinedTool(value: unknown): value is DefinedTool {
  return typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "tool"
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { description?: unknown }).description === "string"
    && typeof (value as { execute?: unknown }).execute === "function";
}

export function isMarcusAgentModule(value: unknown): value is MarcusAgentModule {
  return typeof value === "object" && value !== null && (value as Partial<MarcusAgentModule>)[moduleSymbol] === true;
}

function createModule<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>(
  kind: AgentKind,
  definition:
    | AgentDefinition<TInputSchema, TOutputSchema>
    | PromptTaskDefinition<TInputSchema, TOutputSchema>
    | AssistantDefinition<TInputSchema, TOutputSchema>,
): MarcusAgentModule<Infer<TInputSchema>, Infer<TOutputSchema>> {
  assertKebabCase(definition.id);
  if (definition.name.trim().length === 0) throw new MarcusError({ code: "SDK_NAME_INVALID", message: "Agent name is required", retryable: false });
  const module: MarcusAgentModule<Infer<TInputSchema>, Infer<TOutputSchema>> = {
    [moduleSymbol]: true,
    kind,
    definition: definition as unknown as Readonly<Record<string, unknown>>,
    inputSchema: definition.input as MarcusSchema<Infer<TInputSchema>, boolean>,
    outputSchema: definition.output as MarcusSchema<Infer<TOutputSchema>, boolean>,
    toManifest(options: ManifestBuildOptions = {}): AgentManifest {
      return buildManifest(kind, definition, options);
    },
  };
  return Object.freeze(module);
}

function buildManifest<TInputSchema extends AnySchema, TOutputSchema extends AnySchema>(
  kind: AgentKind,
  definition: BaseDefinition<TInputSchema, TOutputSchema> & {
    objective?: string;
    system?: string;
    prompt?: unknown;
    loop?: Readonly<Record<string, JsonValue>>;
    evaluation?: Readonly<Record<string, JsonValue>>;
    onStart?: unknown;
    onRun?: unknown;
    onResume?: unknown;
    onCancel?: unknown;
    onStop?: unknown;
    onError?: unknown;
    onEnd?: unknown;
  },
  options: ManifestBuildOptions,
): AgentManifest {
  const runtime = definition.runtime ?? {};
  const entrypoints = buildEntrypoints(definition.entrypoints, definition.internalOnly === true);
  ensureAddressable(entrypoints, definition.internalOnly === true);
  const handlers: Record<string, string> = {};
  for (const name of ["onStart", "onRun", "onResume", "onCancel", "onStop", "onError", "onEnd", "authorization"] as const) {
    if (typeof definition[name] === "function" || (name === "authorization" && definition.authorization !== undefined)) {
      handlers[name] = `module:${name}`;
    }
  }
  if (kind === "prompt-task") handlers.defaultLoop = "first-party:prompt-task";
  if (kind === "assistant") handlers.defaultLoop = "first-party:assistant-loop";
  if (kind === "agent" && handlers.onRun === undefined) handlers.defaultLoop = "first-party:agent-loop";
  const manifest: AgentManifest = {
    schemaVersion: "marcus.agent/v1",
    identity: {
      id: definition.id,
      name: definition.name,
      kind,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.tags === undefined ? {} : { tags: definition.tags }),
      ...(definition.internalOnly === undefined ? {} : { internalOnly: definition.internalOnly }),
    },
    runtime: {
      profile: runtime.profile ?? "worker",
      residency: runtime.residency ?? "on-demand",
      startupTimeoutMs: parseDuration(runtime.startupTimeout ?? "15s"),
      shutdownTimeoutMs: parseDuration(runtime.shutdownTimeout ?? "10s"),
      heartbeatIntervalMs: parseDuration(runtime.heartbeatInterval ?? "5s"),
      heartbeatTimeoutMs: parseDuration(runtime.heartbeatTimeout ?? "20s"),
    },
    contract: { inputSchema: definition.input.toJSON(), outputSchema: definition.output.toJSON() },
    entrypoints,
    handlers,
    build: {
      sourceKind: "sdk",
      sourceHash: options.sourceHash ?? "unbuilt",
      compilerVersion: options.compilerVersion ?? MARCUS_SDK_VERSION,
      sdkVersion: MARCUS_SDK_VERSION,
      ...(options.entrypoint === undefined ? {} : { entrypoint: options.entrypoint }),
    },
    ...(definition.conversation === undefined ? {} : { conversation: buildConversation(definition.conversation) }),
    ...(definition.rateLimits === undefined ? {} : { rateLimits: definition.rateLimits.map(buildRateLimit) }),
    ...(definition.concurrency === undefined ? {} : { concurrency: buildConcurrency(definition.concurrency) }),
    ...(definition.model === undefined ? {} : { model: definition.model }),
    ...(definition.tools === undefined ? {} : { tools: buildTools(definition.tools) }),
    ...(definition.skills === undefined ? {} : { skills: definition.skills.map((id) => ({ id })) }),
    ...(definition.assets === undefined
      ? {}
      : { assets: { staticDir: definition.assets.staticDir, expose: definition.assets.expose ?? false } }),
    ...(definition.recovery === undefined ? {} : { recovery: definition.recovery }),
    ...(typeof definition.loop !== "object" || definition.loop === null ? {} : { loop: definition.loop as JsonObject }),
    ...(typeof definition.evaluation !== "object" || definition.evaluation === null
      ? {}
      : { evaluation: definition.evaluation as JsonObject }),
  };
  return manifest;
}

function buildEntrypoints(definition: EntrypointsDefinition | undefined, internalOnly: boolean): EntrypointManifest {
  const source = definition ?? (internalOnly ? {} : { cli: { enabled: true } });
  return {
    ...(source.cli === undefined ? {} : { cli: source.cli }),
    ...(source.api === undefined
      ? {}
      : {
          api: {
            enabled: source.api.enabled,
            response: {
              mode: source.api.response?.mode ?? "auto",
              ...(source.api.response?.wait === undefined ? {} : { waitMs: parseDuration(source.api.response.wait) }),
            },
            authentication: buildAuthentication(source.api.authentication ?? { type: "marcus-token" }),
          },
        }),
    ...(source.schedules === undefined ? {} : { schedules: validateSchedules(source.schedules) }),
    ...(source.events === undefined ? {} : { events: validateEvents(source.events) }),
    ...(source.messages === undefined ? {} : { messages: source.messages }),
  };
}

function validateSchedules(schedules: NonNullable<EntrypointsDefinition["schedules"]>): NonNullable<EntrypointManifest["schedules"]> {
  const ids = new Set<string>();
  return schedules.map((schedule) => {
    assertKebabCase(schedule.id);
    if (ids.has(schedule.id)) throw new MarcusError({ code: "SDK_SCHEDULE_DUPLICATE", message: `Schedule ${schedule.id} is duplicated`, retryable: false });
    if (schedule.cron.trim().split(/\s+/u).length !== 5) throw new MarcusError({ code: "SDK_SCHEDULE_CRON_INVALID", message: `Schedule ${schedule.id} cron must have five fields`, retryable: false });
    try { new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone }); }
    catch { throw new MarcusError({ code: "SDK_SCHEDULE_TIMEZONE_INVALID", message: `Schedule ${schedule.id} timezone is invalid`, retryable: false }); }
    ids.add(schedule.id);
    return schedule;
  });
}

function validateEvents(events: NonNullable<EntrypointsDefinition["events"]>): NonNullable<EntrypointManifest["events"]> {
  return events.map((event) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(event.topic)) throw new MarcusError({ code: "SDK_EVENT_TOPIC_INVALID", message: `Event topic ${event.topic} is invalid`, retryable: false });
    return event;
  });
}

function buildAuthentication(definition: AuthenticationDefinition): NonNullable<EntrypointManifest["api"]>["authentication"] {
  if (definition.type === "custom") return { type: "custom", scheme: definition.scheme, handlerRef: "module:authentication" };
  if (definition.type === "hmac") {
    return {
      type: "hmac",
      secret: definition.secret,
      ...(definition.header === undefined ? {} : { header: definition.header }),
      ...(definition.timestampHeader === undefined ? {} : { timestampHeader: definition.timestampHeader }),
      ...(definition.replayWindow === undefined ? {} : { replayWindowMs: parseDuration(definition.replayWindow) }),
    };
  }
  return definition;
}

function buildConversation<I>(definition: ConversationDefinition<I>): NonNullable<AgentManifest["conversation"]> {
  return {
    enabled: true,
    chatIdPath: definition.chatIdPath ?? (definition.chatId === undefined ? "input.chatId" : "handler:conversation.chatId"),
    missingChatId: definition.missingChatId ?? "required",
    scope: definition.scope ?? "principal+chat",
    history: {
      maxMessages: definition.history?.maxMessages ?? 100,
      ...(definition.history?.retention === undefined ? {} : { retentionMs: parseDuration(definition.history.retention) }),
    },
    injection: definition.injection ?? "automatic",
  };
}

function buildRateLimit(definition: RateLimitDefinition, index: number): RateLimitRule {
  if (!Number.isInteger(definition.limit) || definition.limit <= 0) {
    throw new MarcusError({ code: "SDK_RATE_LIMIT_INVALID", message: "Rate limit must be a positive integer", retryable: false });
  }
  return {
    name: definition.name ?? `rule-${index + 1}`,
    scope: definition.scope,
    algorithm: definition.algorithm,
    limit: definition.limit,
    windowMs: parseDuration(definition.window),
    ...(definition.entrypoints === undefined ? {} : { entrypoints: definition.entrypoints }),
    ...(definition.burst === undefined ? {} : { burst: definition.burst }),
    ...(definition.key === undefined ? {} : { keyHandlerRef: `module:rateLimits.${index}.key` }),
  };
}

function buildConcurrency(definition: ConcurrencyDefinition): ConcurrencyPolicy {
  const { queueTimeout, ...values } = definition;
  return {
    ...values,
    ...(queueTimeout === undefined ? {} : { queueTimeoutMs: parseDuration(queueTimeout) }),
  };
}

function buildTools(definitions: readonly (ToolReference | DefinedTool)[]): ToolManifest[] {
  const ids = new Set<string>();
  return definitions.map((definition) => {
    if (ids.has(definition.id)) {
      throw new MarcusError({ code: "SDK_TOOL_DUPLICATE", message: `Tool ${definition.id} is declared more than once`, retryable: false });
    }
    ids.add(definition.id);
    if (!isDefinedTool(definition)) {
      const official = officialToolManifest(definition.id);
      if (official === undefined) {
        throw new MarcusError({
          code: "SDK_TOOL_NOT_REGISTERED",
          message: `Tool ${definition.id} is not an official Marcus tool; pass a defineTool() definition instead`,
          retryable: false,
        });
      }
      return official;
    }
    if (definition.id.startsWith("marcus/")) {
      throw new MarcusError({ code: "SDK_TOOL_NAMESPACE_RESERVED", message: `Tool namespace marcus/ is reserved for official tools: ${definition.id}`, retryable: false });
    }
    const timeoutMs = parseDuration(definition.timeout ?? "30s");
    if (timeoutMs <= 0) {
      throw new MarcusError({ code: "SDK_TOOL_TIMEOUT_INVALID", message: `Tool ${definition.id} timeout must be positive`, retryable: false });
    }
    const descriptor: Omit<ToolManifest, "version"> = {
      id: definition.id,
      source: "agent",
      description: definition.description,
      inputSchema: definition.input.toJSON(),
      outputSchema: definition.output.toJSON(),
      timeoutMs,
      cancellable: definition.cancellable ?? true,
      sideEffects: definition.sideEffects ?? false,
      risk: definition.risk ?? "low",
      idempotency: definition.idempotency ?? { strategy: "none" },
    };
    const version = new Bun.CryptoHasher("sha256").update(stableJson(descriptor)).digest("hex");
    return { ...descriptor, version };
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function ensureAddressable(entrypoints: EntrypointManifest, internalOnly: boolean): void {
  if (internalOnly) return;
  const enabled =
    entrypoints.cli?.enabled === true ||
    entrypoints.api?.enabled === true ||
    (entrypoints.schedules?.length ?? 0) > 0 ||
    (entrypoints.events?.length ?? 0) > 0 ||
    entrypoints.messages?.enabled === true;
  if (!enabled) {
    throw new MarcusError({
      code: "SDK_ENTRYPOINT_REQUIRED",
      message: "Agent must enable an entrypoint or declare internalOnly",
      retryable: false,
    });
  }
}

function assertKebabCase(value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new MarcusError({ code: "SDK_ID_INVALID", message: `Agent/tool id ${value} must be kebab-case`, retryable: false });
  }
}

export function parseDuration(value: Duration): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw invalidDuration(value);
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u.exec(value);
  if (match === null) throw invalidDuration(value);
  const amount = Number(match[1]);
  const unit = match[2]!;
  return Math.round(amount * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 0));
}

function invalidDuration(value: unknown): MarcusError {
  return new MarcusError({ code: "SDK_DURATION_INVALID", message: `Invalid duration ${String(value)}`, retryable: false });
}

export class MarcusAgentError extends MarcusError {}

export function schemaDefinition(schema: AnySchema): SerializedSchema {
  return schema.toJSON();
}
