export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export * from "./tool-catalog";
import type { ToolManifest } from "./tool-catalog";

export type ProjectId = string;
export type UserId = string;
export type AgentId = string;
export type AgentVersionId = string;
export type AgentInstanceId = string;
export type RunId = string;
export type TaskId = string;
export type StepId = string;
export type ConversationId = string;
export type ArtifactId = string;
export type MessageId = string;
export type TraceId = string;
export type ProcessId = string;

export type AgentKind = "agent" | "prompt-task" | "assistant";
export type RuntimeProfile = "worker" | "process" | "container";
export type Residency = "on-demand" | "resident";
export type EntrypointType = "cli" | "api" | "schedule" | "event" | "message" | "adapter";
export type AgentDefinitionStatus = "draft" | "active" | "disabled" | "archived" | "source-missing";
export type AgentVersionStatus = "building" | "valid" | "invalid" | "active" | "superseded";
export type AgentInstanceState =
  | "created"
  | "queued"
  | "starting"
  | "initializing"
  | "ready"
  | "running"
  | "waiting"
  | "paused"
  | "stopping"
  | "stopped"
  | "failed"
  | "killed"
  | "orphaned"
  | "zombie";
export type RunState =
  | "accepted"
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "waiting_for_child"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "killed";
export type Health = "healthy" | "degraded" | "unresponsive" | "unknown";
export type RunResult = "none" | "success" | "failure" | "cancelled" | "timeout" | "killed";

export interface Principal {
  id: string;
  type?: "user" | "service-account" | "external" | "anonymous";
  claims?: Readonly<Record<string, JsonValue>>;
  scopes?: readonly string[];
}

export interface ActorContext {
  principal?: Principal;
  sessionId?: string;
  connectionId?: string;
  sourceIp?: string;
  reason?: string;
}

export interface TraceContext {
  traceId: TraceId;
  correlationId: string;
  causationId?: string;
}

export interface SerializedSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  const?: JsonValue;
  enum?: readonly JsonValue[];
  properties?: Readonly<Record<string, SerializedSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | SerializedSchema;
  items?: SerializedSchema;
  anyOf?: readonly SerializedSchema[];
  default?: JsonValue;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  nullable?: boolean;
  [extension: `x-${string}`]: JsonValue | undefined;
}

export interface AgentDefinitionRecord {
  agentId: AgentId;
  projectId: ProjectId;
  slug: string;
  name: string;
  description?: string;
  kind: AgentKind;
  status: AgentDefinitionStatus;
  activeVersionId?: AgentVersionId;
  sourcePath?: string;
  sourceState?: "clean" | "dirty" | "unregistered" | "source-missing" | "invalid";
  createdAt: string;
  updatedAt: string;
}

export interface AgentVersionRecord {
  agentVersionId: AgentVersionId;
  agentId: AgentId;
  versionLabel?: string;
  sourceKind: "sdk" | "markdown";
  sourceHash: string;
  manifestHash: string;
  artifactHash: string;
  manifestSchemaVersion: "marcus.agent/v1";
  sdkVersion?: string;
  status: AgentVersionStatus;
  createdAt: string;
  activatedAt?: string;
}

export interface AgentInstanceRecord {
  instanceId: AgentInstanceId;
  agentId: AgentId;
  agentVersionId: AgentVersionId;
  runtimeProfile: RuntimeProfile;
  residency: Residency;
  mpid: ProcessId;
  osPid?: number;
  state: AgentInstanceState;
  health: Health;
  startedAt: string;
  stoppedAt?: string;
  restartedFromInstanceId?: AgentInstanceId;
}

export interface ProcessRecord {
  mpid: ProcessId;
  processType: "runtime-host" | "worker" | "agent-process" | "container";
  projectId?: ProjectId;
  agentId?: AgentId;
  agentVersionId?: AgentVersionId;
  instanceId?: AgentInstanceId;
  parentMpid?: ProcessId;
  osPid?: number;
  state: AgentInstanceState;
  health: Health;
  startedAt: string;
  lastHeartbeatAt?: string;
  lastProgressAt?: string;
  exitCode?: number;
  signal?: string;
}

export interface RunRecord {
  runId: RunId;
  projectId: ProjectId;
  agentId: AgentId;
  agentVersionId: AgentVersionId;
  instanceId?: AgentInstanceId;
  entrypoint: EntrypointType;
  state: RunState;
  result: RunResult;
  principalId?: string;
  conversationId?: ConversationId;
  idempotencyKey?: string;
  inputHash: string;
  traceId: TraceId;
  correlationId: string;
  causationId?: string;
  acceptedAt: string;
  startedAt?: string;
  finishedAt?: string;
  output?: JsonValue;
  error?: MarcusErrorShape;
}

export interface RuntimeManifest {
  profile: RuntimeProfile;
  residency: Residency;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}

export type AuthenticationPolicy =
  | { type: "marcus-token" }
  | { type: "bearer-secret"; secret: string }
  | { type: "hmac"; secret: string; header?: string; timestampHeader?: string; replayWindowMs?: number }
  | { type: "custom" | "validator"; scheme: string; handlerRef?: string; validator?: string }
  | { type: "none"; public: true };

export interface ApiEntrypointManifest {
  enabled: boolean;
  response: { mode: "sync" | "async" | "auto"; waitMs?: number };
  authentication: AuthenticationPolicy;
}

export interface EntrypointManifest {
  cli?: { enabled: boolean };
  api?: ApiEntrypointManifest;
  schedules?: readonly { id: string; cron: string; timezone: string; input?: JsonValue }[];
  events?: readonly { topic: string; inputPath?: string }[];
  messages?: { enabled: boolean };
  adapters?: readonly { type: string; id: string; configuration: JsonObject }[];
}

export interface ConversationPolicyManifest {
  enabled: boolean;
  chatIdPath?: string;
  missingChatId: "required" | "generate" | "optional";
  scope: "principal+chat" | "chat-only" | "principal-only";
  history: { maxMessages: number; retentionMs?: number };
  injection: "automatic" | "manual" | "none";
}

export interface RateLimitRule {
  name: string;
  entrypoints?: readonly EntrypointType[];
  scope: "ip" | "connection" | "principal" | "conversation" | "agent" | "project" | "custom";
  algorithm: "token-bucket" | "fixed-window" | "rolling-window";
  limit: number;
  windowMs: number;
  burst?: number;
  keyHandlerRef?: string;
}

export interface ConcurrencyPolicy {
  total?: number;
  perPrincipal?: number;
  perConversation?: number;
  queueLimit?: number;
  queueTimeoutMs?: number;
  saturation?: "queue" | "reject" | "shed-low-priority";
}

export interface AgentManifest {
  schemaVersion: "marcus.agent/v1";
  identity: {
    id: string;
    name: string;
    description?: string;
    kind: AgentKind;
    tags?: readonly string[];
    internalOnly?: boolean;
  };
  runtime: RuntimeManifest;
  contract: {
    inputSchema: SerializedSchema;
    outputSchema: SerializedSchema;
  };
  entrypoints: EntrypointManifest;
  conversation?: ConversationPolicyManifest;
  rateLimits?: readonly RateLimitRule[];
  concurrency?: ConcurrencyPolicy;
  model?: JsonObject;
  loop?: JsonObject;
  evaluation?: JsonObject;
  tools?: readonly ToolManifest[];
  skills?: readonly { id: string }[];
  assets?: { staticDir: string; expose: boolean };
  resources?: JsonObject;
  recovery?: JsonObject;
  handlers: Readonly<Record<string, string>>;
  build: {
    sourceKind: "sdk" | "markdown";
    entrypoint?: string;
    sourceHash: string;
    compilerVersion: string;
    sdkVersion?: string;
    minimumKernelVersion?: string;
    minimumRuntimeHostVersion?: string;
  };
}

export interface AgentInvocationEnvelope<I = unknown> extends TraceContext {
  invocationId: string;
  projectId: ProjectId;
  agentId: AgentId;
  agentVersionId: AgentVersionId;
  entrypoint: EntrypointType;
  principal?: Principal;
  credentialMetadata?: Readonly<Record<string, JsonValue>>;
  input: I;
  chatId?: string;
  conversationId?: ConversationId;
  idempotencyKey?: string;
  requestedAt: string;
  deadlineAt?: string;
  requestMetadata?: Readonly<Record<string, JsonValue>>;
}

export interface AgentProgress {
  current?: number;
  total?: number;
  unit?: string;
  percent?: number;
  stage?: string;
  message?: string;
  metadata?: Readonly<Record<string, JsonValue>>;
}

export interface AgentHeartbeat {
  instanceId: AgentInstanceId;
  sequence: number;
  emittedAt: string;
  state: "running" | "waiting" | "paused";
  runId?: RunId;
  progress?: AgentProgress;
  waitReason?: string;
  waitDeadlineAt?: string;
  currentOperation?: string;
}

export interface KernelEvent<TPayload extends JsonValue = JsonValue> extends TraceContext {
  eventId: string;
  eventSeq: number;
  eventType: string;
  nodeId: string;
  projectId?: ProjectId;
  agentId?: AgentId;
  runId?: RunId;
  mpid?: ProcessId;
  actor?: ActorContext;
  occurredAt: string;
  payload: TPayload;
}

export interface ArtifactRecord {
  artifactId: ArtifactId;
  projectId: ProjectId;
  agentId: AgentId;
  agentVersionId: AgentVersionId;
  runId: RunId;
  taskId?: TaskId;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  storageUri: string;
  visibility: "private" | "public" | "signed";
  createdAt: string;
}

export interface MarcusErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  details?: JsonValue;
  traceId?: string;
}

export class MarcusError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: JsonValue;
  readonly traceId?: string;

  constructor(shape: MarcusErrorShape) {
    super(shape.message);
    this.name = "MarcusError";
    this.code = shape.code;
    this.retryable = shape.retryable;
    if (shape.details !== undefined) this.details = shape.details;
    if (shape.traceId !== undefined) this.traceId = shape.traceId;
  }

  toJSON(): MarcusErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.traceId === undefined ? {} : { traceId: this.traceId }),
    };
  }
}

const idPrefixes = {
  project: "prj",
  user: "usr",
  agent: "agt",
  agentVersion: "av",
  authValidator: "val",
  authValidatorVersion: "valv",
  instance: "ins",
  run: "run",
  task: "tsk",
  step: "stp",
  conversation: "conv",
  artifact: "art",
  message: "msg",
  trace: "trc",
  event: "evt",
  session: "ses",
  connection: "con",
  upload: "upl",
  file: "fil",
  trash: "tsh",
  graph: "grf",
  process: "m",
} as const;

export type MarcusIdKind = keyof typeof idPrefixes;

export function createId(kind: MarcusIdKind): string {
  const value = Bun.randomUUIDv7().replaceAll("-", "");
  return `${idPrefixes[kind]}_${value}`;
}

export function isMarcusId(value: string, kind?: MarcusIdKind): boolean {
  const prefix = kind === undefined ? "[a-z]{1,5}" : idPrefixes[kind];
  return new RegExp(`^${prefix}_[0-9a-f]{32}$`, "i").test(value);
}

export function createTraceContext(causationId?: string): TraceContext {
  const traceId = createId("trace");
  return {
    traceId,
    correlationId: traceId,
    ...(causationId === undefined ? {} : { causationId }),
  };
}

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new MarcusError({ code: "INTERNAL_INVARIANT", message: `${message}: ${String(value)}`, retryable: false });
}
