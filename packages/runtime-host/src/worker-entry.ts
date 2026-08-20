import { MarcusError, createId, type JsonValue, type ToolCallOptions, type ToolManifest } from "@marcus/contracts";
import {
  isMarcusAgentModule,
  isDefinedTool,
  type AuthenticationContext,
  type AuthValidatorDefinition,
  type Credential,
  type AgentContext,
  type AgentLogger,
  type MarcusAgentModule,
  type DefinedTool,
} from "@marcus/sdk";
import {
  RuntimeMessageType,
  isRuntimeEnvelope,
  runtimeEnvelope,
  type RuntimeEnvelope,
  type RuntimeReply,
} from "./protocol";
import type { RuntimeAuthenticationRequest, RuntimeAuthenticationResult, RuntimeInvocation, RuntimeResult } from "./index";

type ExecutableDefinition = {
  onStart?: (context: AgentContext) => Promise<void>;
  onRun?: (context: AgentContext, input: unknown) => Promise<unknown>;
  onCancel?: (context: AgentContext, reason: string) => Promise<void>;
  onStop?: (context: AgentContext) => Promise<void>;
  onError?: (context: AgentContext, error: Error) => Promise<void>;
  onEnd?: (context: AgentContext, result: JsonValue) => Promise<void>;
  system?: string;
  prompt?: (context: { input: unknown }) => string;
  tools?: readonly unknown[];
  entrypoints?: { api?: { authentication?: { type?: string; validate?: (context: AuthenticationContext, credential: Credential) => Promise<RuntimeAuthenticationResult> } } };
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
};

const scope = self as unknown as WorkerScope;
type AuthValidatorModule = AuthValidatorDefinition & { readonly type: "auth-validator" };
type LoadedArtifact = MarcusAgentModule | AuthValidatorModule;

let artifact: LoadedArtifact | undefined;
let instanceId: string | undefined;
let lastInvocation: RuntimeInvocation | undefined;
const runs = new Map<string, { abort: AbortController; context: AgentContext }>();
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();

scope.onmessage = (event: MessageEvent<unknown>) => {
  if (!isRuntimeEnvelope(event.data)) return;
  const envelope = event.data;
  if (envelope.causationId !== undefined) {
    const callback = pending.get(envelope.causationId);
    if (callback !== undefined) {
      pending.delete(envelope.causationId);
      try {
        callback.resolve(unwrapReply(envelope.payload));
      } catch (error) {
        callback.reject(asError(error));
      }
      return;
    }
  }
  void receive(envelope);
};

send(RuntimeMessageType.HOST_HELLO, { worker: true, pid: process.pid });

async function receive(envelope: RuntimeEnvelope): Promise<void> {
  try {
    switch (envelope.type) {
      case RuntimeMessageType.START_INSTANCE:
        await start(envelope);
        return;
      case RuntimeMessageType.INVOKE_RUN:
        await invoke(envelope as RuntimeEnvelope<RuntimeInvocation>);
        return;
      case RuntimeMessageType.AUTH_VALIDATE:
        await validateAuthentication(envelope as RuntimeEnvelope<RuntimeAuthenticationRequest>);
        return;
      case RuntimeMessageType.CANCEL_RUN:
        await cancel(envelope);
        return;
      case RuntimeMessageType.STOP_INSTANCE:
        await stop(envelope);
        return;
      default:
        sendError(envelope, "RUNTIME_MESSAGE_UNSUPPORTED", `Worker cannot handle ${envelope.type}`);
    }
  } catch (error) {
    sendError(envelope, error instanceof MarcusError ? error.code : "RUNTIME_WORKER_FAILED", asError(error).message, error);
  }
}

async function validateAuthentication(envelope: RuntimeEnvelope<RuntimeAuthenticationRequest>): Promise<void> {
  if (artifact === undefined) throw new Error("Instance is not started");
  const validate = isAuthValidatorModule(artifact)
    ? artifact.validate
    : (artifact.definition as ExecutableDefinition).entrypoints?.api?.authentication?.validate;
  if (typeof validate !== "function") throw new MarcusError({ code: "AUTH_VALIDATOR_NOT_FOUND", message: "Artifact has no inline authentication validator", retryable: false });
  const abort = new AbortController();
  const base: MessageContext = {
    ...(envelope.instanceId === undefined ? {} : { instanceId: envelope.instanceId }),
    traceId: envelope.traceId,
    correlationId: envelope.correlationId,
  };
  const logger: AgentLogger = {
    debug: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "debug", message, attributes: redactValue(attributes) }, base),
    info: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "info", message, attributes: redactValue(attributes) }, base),
    warn: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "warn", message, attributes: redactValue(attributes) }, base),
    error: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "error", message, attributes: redactValue(attributes) }, base),
    redact: redactValue,
  };
  const context: AuthenticationContext = {
    signal: abort.signal,
    project: envelope.payload.project,
    agent: envelope.payload.agent,
    request: envelope.payload.request,
    logger,
    secrets: {
      ref: (name) => ({ name }),
      get: async (name) => (await managed(RuntimeMessageType.SECRET_GET, { name }, base)) as string,
    },
  };
  const result = await validate(context, envelope.payload.credential);
  if (typeof result !== "object" || result === null || typeof result.authenticated !== "boolean") {
    throw new MarcusError({ code: "AUTH_VALIDATOR_RESULT_INVALID", message: "Authentication validator returned an invalid result", retryable: false });
  }
  reply(envelope, RuntimeMessageType.AUTH_VALIDATE, result);
}

async function start(envelope: RuntimeEnvelope): Promise<void> {
  const payload = envelope.payload as { artifactPath?: string; authOnly?: boolean };
  if (typeof payload.artifactPath !== "string") throw new Error("START_INSTANCE requires artifactPath");
  instanceId = envelope.instanceId;
  artifact = await loadArtifact(payload.artifactPath);
  if (isAuthValidatorModule(artifact) && payload.authOnly !== true) throw new MarcusError({ code: "AUTH_VALIDATOR_RUNTIME_ONLY", message: "Auth validator artifacts can only start in auth-only mode", retryable: false });
  const definition = isMarcusAgentModule(artifact) ? artifact.definition as ExecutableDefinition : undefined;
  if (payload.authOnly !== true && definition?.onStart !== undefined) {
    await definition.onStart(createContext(undefined, new AbortController()));
  }
  reply(envelope, RuntimeMessageType.START_INSTANCE, { instanceId, ready: true });
}

async function invoke(envelope: RuntimeEnvelope<RuntimeInvocation>): Promise<void> {
  if (artifact === undefined) throw new Error("Instance is not started");
  if (!isMarcusAgentModule(artifact)) throw new MarcusError({ code: "AUTH_VALIDATOR_NOT_INVOCABLE", message: "Auth validator artifacts cannot execute Runs", retryable: false });
  const invocation = envelope.payload;
  lastInvocation = invocation;
  const abort = new AbortController();
  const context = createContext(invocation, abort);
  runs.set(invocation.runId, { abort, context });
  try {
    const input = artifact.inputSchema.parse(invocation.input);
    const definition = artifact.definition as ExecutableDefinition;
    let rawOutput: unknown;
    if (definition.onRun !== undefined) {
      rawOutput = await definition.onRun(context, input);
    } else {
      const prompt = definition.prompt?.({ input }) ?? JSON.stringify(input);
      const response = await context.model.generate({
        ...(definition.system === undefined ? {} : { system: definition.system }),
        messages: [{ role: "user", content: prompt }],
        output: artifact.outputSchema,
      });
      rawOutput = response.output;
    }
    if (abort.signal.aborted) throw new MarcusError({ code: "RUN_CANCELLED", message: "Run was cancelled", retryable: false });
    const output = artifact.outputSchema.parse(rawOutput) as JsonValue;
    await definition.onEnd?.(context, output);
    const result: RuntimeResult = { runId: invocation.runId, instanceId: invocation.instanceId, output };
    reply(envelope, RuntimeMessageType.RUN_RESULT, result);
  } catch (error) {
    const definition = artifact.definition as ExecutableDefinition;
    await definition.onError?.(context, asError(error)).catch(() => undefined);
    sendError(envelope, error instanceof MarcusError ? error.code : "AGENT_RUN_FAILED", asError(error).message, error, RuntimeMessageType.RUN_RESULT);
  } finally {
    runs.delete(invocation.runId);
  }
}

async function cancel(envelope: RuntimeEnvelope): Promise<void> {
  const runId = envelope.runId;
  const running = runId === undefined ? undefined : runs.get(runId);
  if (running !== undefined) {
    const reason = String((envelope.payload as { reason?: unknown }).reason ?? "cancelled");
    running.abort.abort(reason);
    const definition = artifact !== undefined && isMarcusAgentModule(artifact) ? artifact.definition as ExecutableDefinition : undefined;
    await definition?.onCancel?.(running.context, reason);
  }
  reply(envelope, RuntimeMessageType.CANCEL_RUN, { cancelled: running !== undefined });
}

async function stop(envelope: RuntimeEnvelope): Promise<void> {
  for (const run of runs.values()) run.abort.abort("instance stopping");
  const definition = artifact !== undefined && isMarcusAgentModule(artifact) ? artifact.definition as ExecutableDefinition : undefined;
  await definition?.onStop?.(
    createContext(lastInvocation, new AbortController()),
  );
  reply(envelope, RuntimeMessageType.STOP_INSTANCE, { stopped: true });
  scope.close();
}

async function loadArtifact(artifactPath: string): Promise<LoadedArtifact> {
  const imported = (await import(artifactPath)) as Record<string, unknown>;
  for (const candidate of [imported.default, imported.agent, ...Object.values(imported)]) {
    if (isMarcusAgentModule(candidate)) return candidate;
    if (isAuthValidatorModule(candidate)) return candidate;
  }
  throw new MarcusError({
    code: "AGENT_ARTIFACT_INVALID",
    message: `No Marcus agent or auth validator module exported by ${artifactPath}`,
    retryable: false,
  });
}

function createContext(invocation: RuntimeInvocation | undefined, abort: AbortController): AgentContext {
  const current = invocation ?? {
    instanceId: instanceId ?? "unassigned",
    runId: "lifecycle",
    project: { id: "unknown", slug: "unknown", homePath: "" },
    agent: { id: artifact === undefined ? "unknown" : isAuthValidatorModule(artifact) ? artifact.id : artifact.toManifest().identity.id, versionId: "unknown" },
    entrypoint: "lifecycle",
    input: null,
  };
  const base: MessageContext = {
    instanceId: current.instanceId,
    runId: current.runId,
    ...(current.traceId === undefined ? {} : { traceId: current.traceId }),
    ...(current.correlationId === undefined ? {} : { correlationId: current.correlationId }),
  };
  const logger: AgentLogger = {
    debug: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "debug", message, attributes }, base),
    info: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "info", message, attributes }, base),
    warn: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "warn", message, attributes }, base),
    error: (message, attributes) => emit(RuntimeMessageType.LOG, { level: "error", message, attributes }, base),
    redact: redactValue,
  };
  return {
    signal: abort.signal,
    project: current.project,
    agent: { id: current.agent.id, versionId: current.agent.versionId, instanceId: current.instanceId },
    run: {
      id: current.runId,
      entrypoint: current.entrypoint,
      ...(current.principal === undefined ? {} : { principal: current.principal }),
      traceId: current.traceId ?? createId("trace"),
      ...(current.deadlineAt === undefined ? {} : { deadlineAt: current.deadlineAt }),
    },
    logger,
    progress: {
      report: (progress) => emit(RuntimeMessageType.PROGRESS, progress, base),
      waiting: async (input) => {
        emit(RuntimeMessageType.PROGRESS, { waiting: true, reason: input.reason, until: input.until?.toISOString() }, base);
      },
    },
    model: {
      generate: async <T>(input: unknown) => (await managed(RuntimeMessageType.MODEL_GENERATE, serializeModelRequest(input), base)) as Awaited<ReturnType<AgentContext["model"]["generate"]>> as never,
    },
    tools: {
      call: async <T>(tool: string, input: JsonValue, options?: ToolCallOptions) => invokeTool<T>(tool, input, options, base, abort.signal),
      list: async () => (await managed(RuntimeMessageType.TOOL_DISCOVERY, {}, base)) as readonly ToolManifest[],
      get: async (tool: string) => (await managed(RuntimeMessageType.TOOL_DISCOVERY, { tool }, base)) as ToolManifest,
    },
    agents: {
      run: async <T>(input: unknown) => (await managed(RuntimeMessageType.SUBAGENT_REQUEST, { operation: "run", input }, base)) as T,
      parallel: async <T>(tasks: readonly unknown[], options?: unknown) =>
        (await managed(RuntimeMessageType.SUBAGENT_REQUEST, { operation: "parallel", tasks, options }, base)) as T,
    },
    messages: { send: async (input) => (await managed(RuntimeMessageType.MESSAGE_SEND, input, base)) as { messageId: string } },
    events: { publish: async (topic, payload) => void (await managed(RuntimeMessageType.EVENT_PUBLISH, { topic, payload }, base)) },
    ...(current.conversation === undefined
      ? {}
      : {
          conversation: {
            id: current.conversation.id,
            chatId: current.conversation.chatId,
            ...(current.conversation.principalId === undefined ? {} : { principalId: current.conversation.principalId }),
            listMessages: async (options?: unknown) =>
              (await managed(RuntimeMessageType.CONVERSATION_OPERATION, { operation: "list", options }, base)) as readonly JsonValue[],
            appendMessage: async (message: JsonValue) =>
              void (await managed(RuntimeMessageType.CONVERSATION_OPERATION, { operation: "append", message }, base)),
            getMetadata: async <T>() =>
              (await managed(RuntimeMessageType.CONVERSATION_OPERATION, { operation: "getMetadata" }, base)) as T | undefined,
            setMetadata: async <T>(value: T) =>
              void (await managed(RuntimeMessageType.CONVERSATION_OPERATION, { operation: "setMetadata", value }, base)),
            clear: async (options?: unknown) =>
              void (await managed(RuntimeMessageType.CONVERSATION_OPERATION, { operation: "clear", options }, base)),
          },
        }),
    checkpoint: { save: async (input) => (await managed(RuntimeMessageType.CHECKPOINT_SAVE, input, base)) as { checkpointId: string } },
    artifacts: {
      fromBytes: async (input) => (await managed(RuntimeMessageType.ARTIFACT_COMMIT, { operation: "bytes", ...input }, base)) as { artifactId: string },
      fromProjectFile: async (path) =>
        (await managed(RuntimeMessageType.ARTIFACT_COMMIT, { operation: "projectFile", path }, base)) as { artifactId: string },
    },
    files: {
      read: async (path) => (await managed(RuntimeMessageType.FILE_OPERATION, { operation: "read", path }, base)) as Uint8Array,
      write: async (path, content, options) =>
        (await managed(RuntimeMessageType.FILE_OPERATION, { operation: "write", path, content, options }, base)) as { revision: number },
    },
    secrets: {
      ref: (name) => ({ name }),
      get: async (name) => (await managed(RuntimeMessageType.SECRET_GET, { name }, base)) as string,
    },
    approvals: { request: async <T>(input: unknown) => (await managed(RuntimeMessageType.APPROVAL_REQUEST, input, base)) as T },
  };
}

async function invokeTool<T>(
  toolId: string,
  input: JsonValue,
  options: ToolCallOptions | undefined,
  base: MessageContext,
  runSignal: AbortSignal,
): Promise<T> {
  const local = localTool(toolId);
  const decision = await managed(RuntimeMessageType.TOOL_CALL, {
    tool: toolId,
    input,
    ...(options === undefined ? {} : { options }),
  }, base) as { kind?: unknown; output?: unknown; toolCallId?: unknown; timeoutMs?: unknown };
  if (decision.kind === "result") return decision.output as T;
  if (decision.kind !== "execute" || typeof decision.toolCallId !== "string" || typeof decision.timeoutMs !== "number") {
    throw new MarcusError({ code: "TOOL_RUNTIME_DECISION_INVALID", message: `Marcus returned an invalid execution decision for ${toolId}`, retryable: false });
  }
  if (local === undefined) {
    const error = new MarcusError({ code: "TOOL_IMPLEMENTATION_NOT_FOUND", message: `Agent artifact has no defineTool implementation for ${toolId}`, retryable: false });
    await reportToolResult(decision.toolCallId, toolId, undefined, error, base);
    throw error;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(runSignal.reason ?? "Run cancelled");
  if (runSignal.aborted) cancel();
  else runSignal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(`Tool ${toolId} timed out after ${decision.timeoutMs}ms`), decision.timeoutMs);
  try {
    let parsedInput: unknown;
    try {
      parsedInput = local.input.parse(input);
    } catch (error) {
      throw new MarcusError({ code: "TOOL_INPUT_INVALID", message: error instanceof Error ? error.message : `Invalid input for ${toolId}`, retryable: false });
    }
    const toolContext = { ...currentContext(base.runId), signal: controller.signal };
    const output = await Promise.race([
      local.execute(toolContext, parsedInput as never),
      aborted(controller.signal, toolId),
    ]);
    let parsedOutput: unknown;
    try {
      parsedOutput = local.output.parse(output);
    } catch (error) {
      throw new MarcusError({ code: "TOOL_OUTPUT_INVALID", message: error instanceof Error ? error.message : `Invalid output from ${toolId}`, retryable: false });
    }
    await reportToolResult(decision.toolCallId, toolId, parsedOutput as JsonValue, undefined, base);
    return parsedOutput as T;
  } catch (error) {
    const failure = error instanceof MarcusError
      ? error
      : new MarcusError({ code: controller.signal.aborted ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED", message: asError(error).message, retryable: false });
    await reportToolResult(decision.toolCallId, toolId, undefined, failure, base).catch(() => undefined);
    throw failure;
  } finally {
    clearTimeout(timer);
    runSignal.removeEventListener("abort", cancel);
  }
}

function localTool(toolId: string): DefinedTool | undefined {
  if (artifact === undefined || !isMarcusAgentModule(artifact)) return undefined;
  const tools = (artifact.definition as ExecutableDefinition).tools ?? [];
  return tools.find((candidate): candidate is DefinedTool => isDefinedTool(candidate) && candidate.id === toolId);
}

function currentContext(runId: string | undefined): AgentContext {
  const running = runId === undefined ? undefined : runs.get(runId);
  if (running === undefined) throw new MarcusError({ code: "RUN_CONTEXT_MISSING", message: "Tool execution has no active Run context", retryable: false });
  return running.context;
}

function aborted(signal: AbortSignal, toolId: string): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new MarcusError({
      code: String(signal.reason).includes("timed out") ? "TOOL_TIMEOUT" : "TOOL_CANCELLED",
      message: signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? `Tool ${toolId} cancelled`),
      retryable: false,
    }));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

async function reportToolResult(
  toolCallId: string,
  tool: string,
  output: JsonValue | undefined,
  error: MarcusError | undefined,
  base: MessageContext,
): Promise<void> {
  await managed(RuntimeMessageType.TOOL_RESULT, {
    toolCallId,
    tool,
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error: { code: error.code, message: error.message, retryable: error.retryable } }),
  }, base);
}

function isAuthValidatorModule(value: unknown): value is AuthValidatorModule {
  return typeof value === "object" && value !== null
    && (value as { type?: unknown }).type === "auth-validator"
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { scheme?: unknown }).scheme === "string"
    && typeof (value as { validate?: unknown }).validate === "function";
}

function serializeModelRequest(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const request = input as Record<string, unknown>;
  const output = request.output;
  return {
    ...request,
    ...(typeof output === "object" && output !== null && "toJSON" in output && typeof (output as { toJSON?: unknown }).toJSON === "function"
      ? { output: (output as { toJSON(): unknown }).toJSON() }
      : {}),
  };
}

function managed(type: RuntimeMessageType, payload: unknown, context: MessageContext): Promise<unknown> {
  const envelope = runtimeEnvelope(type, payload, context);
  return new Promise((resolve, reject) => {
    pending.set(envelope.messageId, { resolve, reject });
    scope.postMessage(envelope);
  });
}

type MessageContext = { instanceId?: string; runId?: string; traceId?: string; correlationId?: string };

function emit(type: RuntimeMessageType, payload: unknown, context: MessageContext): void {
  scope.postMessage(runtimeEnvelope(type, payload, context));
}

function send(type: RuntimeMessageType, payload: unknown): void {
  scope.postMessage(runtimeEnvelope(type, payload, { ...(instanceId === undefined ? {} : { instanceId }) }));
}

function reply(request: RuntimeEnvelope, type: RuntimeMessageType, data: unknown): void {
  scope.postMessage(runtimeEnvelope(type, { ok: true, data }, replyContext(request)));
}

function sendError(
  request: RuntimeEnvelope,
  code: string,
  message: string,
  error?: unknown,
  type: RuntimeMessageType = RuntimeMessageType.HOST_ERROR,
): void {
  const details = error instanceof MarcusError ? error.details : undefined;
  scope.postMessage(
    runtimeEnvelope(
      type,
      { ok: false, error: { code, message, retryable: false, ...(details === undefined ? {} : { details }) } },
      replyContext(request),
    ),
  );
}

function replyContext(request: RuntimeEnvelope) {
  return {
    causationId: request.causationId ?? request.messageId,
    correlationId: request.correlationId,
    traceId: request.traceId,
    ...(request.instanceId === undefined ? {} : { instanceId: request.instanceId }),
    ...(request.runId === undefined ? {} : { runId: request.runId }),
  };
}

function unwrapReply(payload: unknown): unknown {
  const reply = payload as RuntimeReply;
  if (reply?.ok === true) return reply.data;
  if (reply?.ok === false) throw new MarcusError(reply.error);
  throw new Error("Managed runtime reply is malformed");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return "[REDACTED]";
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|credential/i.test(key) ? "[REDACTED]" : redactValue(item)]));
  }
  return value;
}
