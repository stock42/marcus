import {
  MarcusError,
  createId,
  createTraceContext,
  type AgentDefinitionRecord,
  type AgentManifest,
  type AgentVersionRecord,
  type EntrypointType,
  type JsonValue,
  type KernelEvent,
  type Principal,
  type RunRecord,
} from "@marcus/contracts";
import { validateSchema } from "@marcus/schema";
import { ConcurrencyManager, type ConcurrencyContext } from "./concurrency";
import { RateLimitManager } from "./rate-limits";
import { FairScheduler, type SchedulerPriority } from "./scheduler";
import { assertRunTransition } from "./state-machines";

export interface KernelRepository {
  getAgentDefinition(agentId: string): AgentDefinitionRecord | undefined;
  getAgentVersion(versionId: string): AgentVersionRecord | undefined;
  getAgentManifest(versionId: string): AgentManifest | undefined;
  createRun(input: RunRecord & { input: JsonValue }): void;
  getRun(runId: string): RunRecord | undefined;
  findIdempotentRun(input: {
    projectId: string;
    agentId: string;
    principalId?: string;
    idempotencyKey: string;
  }): RunRecord | undefined;
  transitionRun(
    runId: string,
    expected: readonly RunRecord["state"][],
    next: RunRecord["state"],
    update?: { result?: RunRecord["result"]; output?: JsonValue; error?: RunRecord["error"]; now?: string },
  ): RunRecord;
  resolveConversation(key: {
    projectId: string;
    agentId: string;
    scope: "principal+chat" | "chat-only" | "principal-only";
    principalId?: string;
    chatId?: string;
  }, now?: string): string;
  appendConversationMessage(input: {
    conversationId: string;
    role: "system" | "user" | "assistant" | "tool" | "event";
    content: JsonValue;
    runId?: string;
    agentVersionId?: string;
    metadata?: JsonValue;
    now?: string;
  }): { conversationMessageId: string; sequence: number };
  appendKernelEvent(input: {
    eventType: string;
    nodeId: string;
    projectId?: string;
    agentId?: string;
    runId?: string;
    mpid?: string;
    actor?: JsonValue;
    correlationId: string;
    causationId?: string;
    traceId: string;
    occurredAt?: string;
    payload: JsonValue;
  }): KernelEvent;
}

export interface InvokeAgentInput {
  projectId: string;
  agentId: string;
  entrypoint: EntrypointType;
  input: JsonValue;
  principal?: Principal;
  chatId?: string;
  idempotencyKey?: string;
  connectionId?: string;
  remoteAddress?: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  deadlineAt?: string;
  priority?: SchedulerPriority;
}

export interface RunHandle {
  runId: string;
  state: RunRecord["state"];
  agentVersionId: string;
  conversationId?: string;
  chatId?: string;
  idempotentReplay: boolean;
}

interface QueuedContext extends ConcurrencyContext {
  policy: AgentManifest["concurrency"];
}

export class MarcusKernel {
  readonly nodeId: string;
  readonly scheduler: FairScheduler;
  readonly rateLimits: RateLimitManager;
  readonly concurrency: ConcurrencyManager;
  private readonly repository: KernelRepository;
  private readonly queuedContexts = new Map<string, QueuedContext>();
  private readonly now: () => number;

  constructor(options: {
    nodeId: string;
    repository: KernelRepository;
    scheduler?: FairScheduler;
    rateLimits?: RateLimitManager;
    concurrency?: ConcurrencyManager;
    now?: () => number;
  }) {
    this.nodeId = options.nodeId;
    this.repository = options.repository;
    this.scheduler = options.scheduler ?? new FairScheduler();
    this.rateLimits = options.rateLimits ?? new RateLimitManager(options.now === undefined ? {} : { now: options.now });
    this.concurrency = options.concurrency ?? new ConcurrencyManager(options.now === undefined ? {} : { now: options.now });
    this.now = options.now ?? Date.now;
  }

  invokeAgent(input: InvokeAgentInput): RunHandle {
    const definition = this.repository.getAgentDefinition(input.agentId);
    if (definition === undefined || definition.projectId !== input.projectId || definition.status !== "active") {
      throw new MarcusError({ code: "AGENT_NOT_ACTIVE", message: "Agent is not active in this project", retryable: false });
    }
    if (definition.activeVersionId === undefined) {
      throw new MarcusError({ code: "AGENT_VERSION_NOT_ACTIVE", message: "Agent has no active version", retryable: false });
    }
    const version = this.repository.getAgentVersion(definition.activeVersionId);
    const manifest = this.repository.getAgentManifest(definition.activeVersionId);
    if (version === undefined || manifest === undefined || version.status !== "active") {
      throw new MarcusError({ code: "AGENT_VERSION_NOT_ACTIVE", message: "Active AgentVersion is unavailable", retryable: false });
    }
    if (!isEntrypointEnabled(manifest, input.entrypoint)) {
      throw new MarcusError({ code: "ENTRYPOINT_DISABLED", message: `${input.entrypoint} entrypoint is disabled`, retryable: false });
    }
    const validation = validateSchema(manifest.contract.inputSchema, input.input);
    if (!validation.success) {
      throw new MarcusError({
        code: "AGENT_INPUT_INVALID",
        message: "Input does not match the active AgentVersion contract",
        retryable: false,
        details: { issues: validation.issues.map(({ path, code, message }) => ({ path, code, message })) },
      });
    }
    const inputHash = hashJson(input.input);
    if (input.idempotencyKey !== undefined) {
      const existing = this.repository.findIdempotentRun({
        projectId: input.projectId,
        agentId: input.agentId,
        ...(input.principal === undefined ? {} : { principalId: input.principal.id }),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== undefined) {
        if (existing.inputHash !== inputHash) {
          throw new MarcusError({ code: "IDEMPOTENCY_CONFLICT", message: "Idempotency key was used with different input", retryable: false });
        }
        return {
          runId: existing.runId,
          state: existing.state,
          agentVersionId: existing.agentVersionId,
          ...(existing.conversationId === undefined ? {} : { conversationId: existing.conversationId }),
          idempotentReplay: true,
        };
      }
    }

    const now = new Date(this.now()).toISOString();
    const conversation = resolveConversation(this.repository, manifest, input, now);
    this.rateLimits.consume(manifest.rateLimits ?? [], {
      projectId: input.projectId,
      agentId: input.agentId,
      entrypoint: input.entrypoint,
      ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      ...(input.principal === undefined ? {} : { principalId: input.principal.id }),
      ...(conversation.conversationId === undefined ? {} : { conversationId: conversation.conversationId }),
      ...(input.remoteAddress === undefined ? {} : { ip: input.remoteAddress }),
    });
    this.concurrency.preflight(manifest.concurrency);

    const runId = createId("run");
    const trace = input.traceId === undefined
      ? createTraceContext(input.causationId)
      : {
          traceId: input.traceId,
          correlationId: input.correlationId ?? input.traceId,
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        };
    const run: RunRecord & { input: JsonValue } = {
      runId,
      projectId: input.projectId,
      agentId: input.agentId,
      agentVersionId: version.agentVersionId,
      entrypoint: input.entrypoint,
      state: "accepted",
      result: "none",
      inputHash,
      input: input.input,
      traceId: trace.traceId,
      correlationId: trace.correlationId,
      acceptedAt: now,
      ...(input.principal === undefined ? {} : { principalId: input.principal.id }),
      ...(conversation.conversationId === undefined ? {} : { conversationId: conversation.conversationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      ...(trace.causationId === undefined ? {} : { causationId: trace.causationId }),
    };
    this.repository.createRun(run);
    if (conversation.conversationId !== undefined) {
      this.repository.appendConversationMessage({
        conversationId: conversation.conversationId,
        role: "user",
        content: input.input,
        runId,
        agentVersionId: version.agentVersionId,
        now,
      });
    }
    this.repository.appendKernelEvent({
      eventType: "run.accepted",
      nodeId: this.nodeId,
      projectId: input.projectId,
      agentId: input.agentId,
      runId,
      correlationId: trace.correlationId,
      traceId: trace.traceId,
      ...(trace.causationId === undefined ? {} : { causationId: trace.causationId }),
      occurredAt: now,
      payload: { entrypoint: input.entrypoint, agentVersionId: version.agentVersionId },
    });
    const queued = this.repository.transitionRun(runId, ["accepted"], "queued", { now });
    this.concurrency.queue(runId);
    this.queuedContexts.set(runId, {
      runId,
      agentId: input.agentId,
      ...(input.principal === undefined ? {} : { principalId: input.principal.id }),
      ...(conversation.conversationId === undefined ? {} : { conversationId: conversation.conversationId }),
      policy: manifest.concurrency,
    });
    this.scheduler.enqueue({
      runId,
      projectId: input.projectId,
      agentId: input.agentId,
      priority: input.priority ?? "normal",
      acceptedAtMs: this.now(),
      ...(input.deadlineAt === undefined ? {} : { deadlineAtMs: Date.parse(input.deadlineAt) }),
    });
    return {
      runId,
      state: queued.state,
      agentVersionId: version.agentVersionId,
      ...(conversation.conversationId === undefined ? {} : { conversationId: conversation.conversationId }),
      ...(conversation.chatId === undefined ? {} : { chatId: conversation.chatId }),
      idempotentReplay: false,
    };
  }

  dispatchNext(): RunRecord | undefined {
    const scheduled = this.scheduler.dequeue((candidate) => {
      const context = this.queuedContexts.get(candidate.runId);
      return context !== undefined && this.concurrency.tryAcquire(context, context.policy);
    });
    if (scheduled === undefined) return undefined;
    this.queuedContexts.delete(scheduled.runId);
    return this.transition(scheduled.runId, "starting");
  }

  markRunning(runId: string): RunRecord {
    return this.transition(runId, "running");
  }

  markWaitingForApproval(runId: string): RunRecord {
    return this.transition(runId, "waiting_for_approval");
  }

  resumeRun(runId: string): RunRecord {
    return this.transition(runId, "running");
  }

  completeRun(runId: string, output: JsonValue): RunRecord {
    const run = this.requiredRun(runId);
    assertRunTransition(run.state, "completed");
    const manifest = this.repository.getAgentManifest(run.agentVersionId);
    if (manifest === undefined) {
      throw new MarcusError({ code: "AGENT_VERSION_NOT_FOUND", message: "Run AgentVersion manifest is unavailable", retryable: false });
    }
    const validation = validateSchema(manifest.contract.outputSchema, output);
    if (!validation.success) {
      return this.failRun(runId, {
        code: "INVALID_OUTPUT",
        message: "Agent output does not match its contract",
        retryable: false,
        details: { issues: validation.issues.map(({ path, code, message }) => ({ path, code, message })) },
      });
    }
    const completed = this.repository.transitionRun(runId, [run.state], "completed", {
      result: "success",
      output,
      now: new Date(this.now()).toISOString(),
    });
    if (run.conversationId !== undefined) {
      this.repository.appendConversationMessage({
        conversationId: run.conversationId,
        role: "assistant",
        content: output,
        runId,
        agentVersionId: run.agentVersionId,
        ...(completed.finishedAt === undefined ? {} : { now: completed.finishedAt }),
      });
    }
    this.concurrency.release(runId);
    this.emitRunTerminal(completed);
    return completed;
  }

  failRun(runId: string, error: NonNullable<RunRecord["error"]>): RunRecord {
    const run = this.requiredRun(runId);
    assertRunTransition(run.state, "failed");
    const failed = this.repository.transitionRun(runId, [run.state], "failed", {
      result: "failure",
      error,
      now: new Date(this.now()).toISOString(),
    });
    this.concurrency.release(runId);
    this.emitRunTerminal(failed);
    return failed;
  }

  cancelRun(runId: string): RunRecord {
    const run = this.requiredRun(runId);
    if (run.state === "accepted" || run.state === "queued") {
      this.scheduler.remove(runId);
      this.queuedContexts.delete(runId);
      this.concurrency.release(runId);
      return this.repository.transitionRun(runId, [run.state], "cancelled", {
        result: "cancelled",
        now: new Date(this.now()).toISOString(),
      });
    }
    return this.transition(runId, "cancelling");
  }

  finishCancelled(runId: string): RunRecord {
    const run = this.requiredRun(runId);
    assertRunTransition(run.state, "cancelled");
    const cancelled = this.repository.transitionRun(runId, [run.state], "cancelled", {
      result: "cancelled",
      now: new Date(this.now()).toISOString(),
    });
    this.concurrency.release(runId);
    this.emitRunTerminal(cancelled);
    return cancelled;
  }

  killRun(runId: string, message = "Run was killed"): RunRecord {
    const run = this.requiredRun(runId);
    assertRunTransition(run.state, "killed");
    const killed = this.repository.transitionRun(runId, [run.state], "killed", {
      result: "killed",
      error: { code: "RUN_KILLED", message, retryable: false },
      now: new Date(this.now()).toISOString(),
    });
    this.concurrency.release(runId);
    this.emitRunTerminal(killed);
    return killed;
  }

  timeOutRun(runId: string, message = "Run deadline exceeded"): RunRecord {
    const run = this.requiredRun(runId);
    assertRunTransition(run.state, "timed_out");
    const timedOut = this.repository.transitionRun(runId, [run.state], "timed_out", {
      result: "timeout",
      error: { code: "RUN_TIMED_OUT", message, retryable: false },
      now: new Date(this.now()).toISOString(),
    });
    this.concurrency.release(runId);
    this.emitRunTerminal(timedOut);
    return timedOut;
  }

  private transition(runId: string, next: RunRecord["state"]): RunRecord {
    const run = this.requiredRun(runId);
    assertRunTransition(run.state, next);
    return this.repository.transitionRun(runId, [run.state], next, { now: new Date(this.now()).toISOString() });
  }

  private requiredRun(runId: string): RunRecord {
    const run = this.repository.getRun(runId);
    if (run === undefined) throw new MarcusError({ code: "RUN_NOT_FOUND", message: `Run ${runId} not found`, retryable: false });
    return run;
  }

  private emitRunTerminal(run: RunRecord): void {
    this.repository.appendKernelEvent({
      eventType: `run.${run.state}`,
      nodeId: this.nodeId,
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.runId,
      correlationId: run.correlationId,
      traceId: run.traceId,
      ...(run.causationId === undefined ? {} : { causationId: run.causationId }),
      ...(run.finishedAt === undefined ? {} : { occurredAt: run.finishedAt }),
      payload: { result: run.result },
    });
  }
}

function isEntrypointEnabled(manifest: AgentManifest, entrypoint: EntrypointType): boolean {
  switch (entrypoint) {
    case "cli":
      return manifest.entrypoints.cli?.enabled === true;
    case "api":
      return manifest.entrypoints.api?.enabled === true;
    case "schedule":
      return (manifest.entrypoints.schedules?.length ?? 0) > 0;
    case "event":
      return (manifest.entrypoints.events?.length ?? 0) > 0;
    case "message":
      return manifest.entrypoints.messages?.enabled === true;
    case "adapter":
      return (manifest.entrypoints.adapters?.length ?? 0) > 0;
  }
}

function resolveConversation(
  repository: KernelRepository,
  manifest: AgentManifest,
  input: InvokeAgentInput,
  now: string,
): { conversationId?: string; chatId?: string } {
  const policy = manifest.conversation;
  if (policy?.enabled !== true) return {};
  let chatId = input.chatId ?? valueAtPath(input.input, policy.chatIdPath);
  if (chatId === undefined && policy.missingChatId === "generate") chatId = `chat_${Bun.randomUUIDv7().replaceAll("-", "")}`;
  if (chatId === undefined && policy.missingChatId === "required") {
    throw new MarcusError({ code: "CHAT_ID_REQUIRED", message: "Agent conversation requires chatId", retryable: false });
  }
  if (chatId === undefined && policy.missingChatId === "optional") return {};
  const principalId = input.principal?.id;
  const conversationId = repository.resolveConversation(
    {
      projectId: input.projectId,
      agentId: input.agentId,
      scope: policy.scope,
      ...(principalId === undefined ? {} : { principalId }),
      ...(chatId === undefined ? {} : { chatId }),
    },
    now,
  );
  return { conversationId, ...(chatId === undefined ? {} : { chatId }) };
}

function valueAtPath(value: JsonValue, path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const segments = path.replace(/^input\./u, "").split(".");
  let current: unknown = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

export function hashJson(value: JsonValue): string {
  return new Bun.CryptoHasher("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
