import { MarcusError, createId, type JsonValue, type Principal } from "@marcus/contracts";
import {
  RuntimeMessageType,
  isRuntimeEnvelope,
  runtimeEnvelope,
  type RuntimeEnvelope,
  type RuntimeReply,
} from "./protocol";

export * from "./protocol";

export interface RuntimeInvocation {
  instanceId: string;
  runId: string;
  project: { id: string; slug: string; homePath: string };
  agent: { id: string; versionId: string };
  entrypoint: string;
  input: JsonValue;
  principal?: Principal;
  deadlineAt?: string;
  conversation?: { id: string; chatId: string; principalId?: string };
  traceId?: string;
  correlationId?: string;
}

export interface RuntimeResult {
  runId: string;
  instanceId: string;
  output: JsonValue;
}

export interface RuntimeAuthenticationRequest {
  project: { id: string; slug: string };
  agent: { id: string; versionId: string };
  request: { method: string; path: string; remoteAddress?: string; headers: Readonly<Record<string, string>> };
  credential: { scheme: string; token?: string; signature?: string; timestamp?: string; headers?: Readonly<Record<string, string>> };
}

export interface RuntimeAuthenticationResult {
  authenticated: boolean;
  principal?: Principal;
  code?: string;
  metadata?: Readonly<Record<string, JsonValue>>;
}

export type ManagedRuntimeHandler = (envelope: RuntimeEnvelope) => unknown | Promise<unknown>;

export interface RuntimeHostControllerOptions {
  hostEntrypoint?: string;
  hostExecutable?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  handlers?: Partial<Record<RuntimeMessageType, ManagedRuntimeHandler>>;
  onEvent?: (envelope: RuntimeEnvelope) => void;
}

type Pending = {
  resolve(value: RuntimeEnvelope): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export class RuntimeHostController {
  readonly mpid = createId("process");
  private readonly options: Required<Pick<RuntimeHostControllerOptions, "startupTimeoutMs" | "requestTimeoutMs" | "shutdownTimeoutMs">> &
    RuntimeHostControllerOptions;
  private readonly pending = new Map<string, Pending>();
  private process?: Bun.Subprocess<"ignore", "pipe", "pipe">;
  private started?: Promise<void>;
  private stopped = false;

  constructor(options: RuntimeHostControllerOptions = {}) {
    this.options = {
      startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 2_000,
      ...options,
    };
  }

  get osPid(): number | undefined {
    return this.process?.pid;
  }

  async start(): Promise<void> {
    if (this.started !== undefined) return this.started;
    this.started = this.spawn();
    return this.started;
  }

  async loadArtifact(instanceId: string, artifactPath: string): Promise<void> {
    await this.request(RuntimeMessageType.LOAD_ARTIFACT, { artifactPath }, { instanceId });
  }

  async startInstance(instanceId: string, options: { authOnly?: boolean } = {}): Promise<void> {
    await this.request(RuntimeMessageType.START_INSTANCE, options, { instanceId });
  }

  async invoke(invocation: RuntimeInvocation): Promise<RuntimeResult> {
    const envelope = await this.request(RuntimeMessageType.INVOKE_RUN, invocation, {
      instanceId: invocation.instanceId,
      runId: invocation.runId,
      ...(invocation.traceId === undefined ? {} : { traceId: invocation.traceId }),
      ...(invocation.correlationId === undefined ? {} : { correlationId: invocation.correlationId }),
    });
    const reply = unwrapReply<RuntimeResult>(envelope.payload);
    return reply;
  }

  async validateAuthentication(instanceId: string, input: RuntimeAuthenticationRequest): Promise<RuntimeAuthenticationResult> {
    const envelope = await this.request(RuntimeMessageType.AUTH_VALIDATE, input, { instanceId });
    return unwrapReply<RuntimeAuthenticationResult>(envelope.payload);
  }

  async cancelRun(runId: string, reason = "cancelled by caller", graceMs = 1_000): Promise<void> {
    await this.request(RuntimeMessageType.CANCEL_RUN, { reason, graceMs }, { runId });
  }

  async stopInstance(instanceId: string): Promise<void> {
    await this.request(RuntimeMessageType.STOP_INSTANCE, {}, { instanceId });
  }

  async terminateWorker(instanceId: string): Promise<void> {
    await this.request(RuntimeMessageType.TERMINATE_WORKER, {}, { instanceId });
  }

  async close(): Promise<void> {
    this.stopped = true;
    const process = this.process;
    if (process === undefined) return;
    process.kill("SIGTERM");
    const closed = await Promise.race([
      process.exited.then(() => true),
      Bun.sleep(this.options.shutdownTimeoutMs).then(() => false),
    ]);
    if (!closed) process.kill("SIGKILL");
    this.rejectAll(runtimeError("RUNTIME_HOST_CLOSED", "Runtime Host closed", true));
  }

  private async spawn(): Promise<void> {
    const hostEntrypoint = this.options.hostEntrypoint ?? defaultEntrypoint("host-process");
    let helloResolve: (() => void) | undefined;
    let helloReject: ((error: Error) => void) | undefined;
    const hello = new Promise<void>((resolve, reject) => {
      helloResolve = resolve;
      helloReject = reject;
    });
    const command = this.options.hostExecutable === undefined
      ? [globalThis.process.execPath, hostEntrypoint, "--mpid", this.mpid]
      : [this.options.hostExecutable, "--mpid", this.mpid];
    const child = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ipc: (message) => {
        if (!isRuntimeEnvelope(message)) return;
        if (message.type === RuntimeMessageType.HOST_HELLO) helloResolve?.();
        void this.receive(message);
      },
    });
    this.process = child;
    void child.exited.then((exitCode: number) => {
      if (exitCode !== 0 && !this.stopped) {
        helloReject?.(runtimeError("RUNTIME_HOST_EXITED", `Runtime Host exited with code ${exitCode}`, true));
      }
      this.rejectAll(runtimeError("RUNTIME_HOST_EXITED", `Runtime Host exited with code ${exitCode}`, true));
    });
    const ready = await Promise.race([
      hello.then(() => true),
      Bun.sleep(this.options.startupTimeoutMs).then(() => false),
    ]);
    if (!ready) {
      child.kill("SIGKILL");
      throw runtimeError("RUNTIME_HOST_START_TIMEOUT", "Runtime Host did not send HOST_HELLO", true);
    }
  }

  private async request(
    type: RuntimeMessageType,
    payload: unknown,
    context: { instanceId?: string; runId?: string; traceId?: string; correlationId?: string } = {},
  ): Promise<RuntimeEnvelope> {
    await this.start();
    const process = this.process;
    if (process === undefined || process.exitCode !== null) {
      throw runtimeError("RUNTIME_HOST_UNAVAILABLE", "Runtime Host is unavailable", true);
    }
    const envelope = runtimeEnvelope(type, payload, {
      mpid: this.mpid,
      ...(context.instanceId === undefined ? {} : { instanceId: context.instanceId }),
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
      ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    });
    const response = new Promise<RuntimeEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.messageId);
        reject(runtimeError("RUNTIME_REQUEST_TIMEOUT", `${type} timed out`, true));
      }, this.options.requestTimeoutMs);
      this.pending.set(envelope.messageId, { resolve, reject, timer });
    });
    process.send(envelope);
    const reply = await response;
    if (reply.type === RuntimeMessageType.HOST_ERROR) unwrapReply(reply.payload);
    return reply;
  }

  private async receive(envelope: RuntimeEnvelope): Promise<void> {
    if (envelope.causationId !== undefined) {
      const pending = this.pending.get(envelope.causationId);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(envelope.causationId);
        pending.resolve(envelope);
        return;
      }
    }
    this.options.onEvent?.(envelope);
    const handler = this.options.handlers?.[envelope.type];
    if (handler === undefined) return;
    try {
      const data = await handler(envelope);
      this.process?.send(runtimeEnvelope(envelope.type, { ok: true, data }, responseContext(envelope, this.mpid)));
    } catch (error) {
      this.process?.send(
        runtimeEnvelope(
          envelope.type,
          {
            ok: false,
            error: {
              code: error instanceof MarcusError ? error.code : "RUNTIME_HANDLER_FAILED",
              message: error instanceof Error ? error.message : String(error),
              retryable: error instanceof MarcusError ? error.retryable : false,
            },
          },
          responseContext(envelope, this.mpid),
        ),
      );
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export interface ProcessRuntimeControllerOptions extends Omit<RuntimeHostControllerOptions, "hostEntrypoint" | "hostExecutable"> {
  processEntrypoint?: string;
  processExecutable?: string;
}

export class ProcessRuntimeController {
  readonly mpid = createId("process");
  private readonly options: Required<Pick<RuntimeHostControllerOptions, "startupTimeoutMs" | "requestTimeoutMs" | "shutdownTimeoutMs">> &
    ProcessRuntimeControllerOptions;
  private readonly pending = new Map<string, Pending>();
  private readonly artifacts = new Map<string, string>();
  private readonly runRequests = new Map<string, string>();
  private process?: Bun.Subprocess<"ignore", "pipe", "pipe">;
  private started?: Promise<void>;

  constructor(options: ProcessRuntimeControllerOptions = {}) {
    this.options = {
      startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 2_000,
      ...options,
    };
  }

  get osPid(): number | undefined {
    return this.process?.pid;
  }

  async start(): Promise<void> {
    if (this.started !== undefined) return this.started;
    this.started = this.spawn();
    return this.started;
  }

  async loadArtifact(instanceId: string, artifactPath: string): Promise<void> {
    if (!(await Bun.file(artifactPath).exists())) throw runtimeError("AGENT_ARTIFACT_MISSING", `Artifact does not exist: ${artifactPath}`, false);
    this.artifacts.set(instanceId, artifactPath);
  }

  async startInstance(instanceId: string, options: { authOnly?: boolean } = {}): Promise<void> {
    const artifactPath = this.artifacts.get(instanceId);
    if (artifactPath === undefined) throw runtimeError("AGENT_ARTIFACT_MISSING", `No artifact loaded for ${instanceId}`, false);
    await this.request(RuntimeMessageType.START_INSTANCE, { artifactPath, ...options }, { instanceId });
  }

  async invoke(invocation: RuntimeInvocation): Promise<RuntimeResult> {
    const request = runtimeEnvelope(RuntimeMessageType.INVOKE_RUN, invocation, {
      mpid: this.mpid,
      instanceId: invocation.instanceId,
      runId: invocation.runId,
      ...(invocation.traceId === undefined ? {} : { traceId: invocation.traceId }),
      ...(invocation.correlationId === undefined ? {} : { correlationId: invocation.correlationId }),
    });
    this.runRequests.set(invocation.runId, request.messageId);
    try {
      const response = await this.sendRequest(request);
      return unwrapReply<RuntimeResult>(response.payload);
    } finally {
      this.runRequests.delete(invocation.runId);
    }
  }

  async validateAuthentication(instanceId: string, input: RuntimeAuthenticationRequest): Promise<RuntimeAuthenticationResult> {
    const envelope = await this.request(RuntimeMessageType.AUTH_VALIDATE, input, { instanceId });
    return unwrapReply<RuntimeAuthenticationResult>(envelope.payload);
  }

  async cancelRun(runId: string, reason = "cancelled by caller", graceMs = 1_000): Promise<void> {
    await this.request(RuntimeMessageType.CANCEL_RUN, { reason }, { runId });
    setTimeout(() => {
      const requestId = this.runRequests.get(runId);
      if (requestId === undefined) return;
      const pending = this.pending.get(requestId);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.reject(runtimeError("RUN_KILLED", "Agent process was killed after cancellation timeout", true));
      }
      this.process?.kill("SIGKILL");
    }, Math.max(0, Math.min(graceMs, 30_000)));
  }

  async stopInstance(instanceId: string): Promise<void> {
    await this.request(RuntimeMessageType.STOP_INSTANCE, {}, { instanceId });
  }

  async close(): Promise<void> {
    const child = this.process;
    if (child === undefined) return;
    child.kill("SIGTERM");
    const closed = await Promise.race([child.exited.then(() => true), Bun.sleep(this.options.shutdownTimeoutMs).then(() => false)]);
    if (!closed) child.kill("SIGKILL");
    this.rejectAll(runtimeError("AGENT_PROCESS_CLOSED", "Agent process closed", true));
  }

  private async spawn(): Promise<void> {
    const entrypoint = this.options.processEntrypoint ?? defaultEntrypoint("process-entry");
    let ready: (() => void) | undefined;
    const hello = new Promise<void>((resolve) => { ready = resolve; });
    const command = this.options.processExecutable === undefined
      ? [globalThis.process.execPath, entrypoint]
      : [this.options.processExecutable];
    const child = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ipc: (message) => {
        if (!isRuntimeEnvelope(message)) return;
        if (message.type === RuntimeMessageType.HOST_HELLO) ready?.();
        void this.receive(message);
      },
    });
    this.process = child;
    void child.exited.then((code: number) => this.rejectAll(runtimeError("AGENT_PROCESS_EXITED", `Agent process exited with code ${code}`, true)));
    const didStart = await Promise.race([hello.then(() => true), Bun.sleep(this.options.startupTimeoutMs).then(() => false)]);
    if (!didStart) {
      child.kill("SIGKILL");
      throw runtimeError("AGENT_PROCESS_START_TIMEOUT", "Agent process did not start", true);
    }
  }

  private request(
    type: RuntimeMessageType,
    payload: unknown,
    context: { instanceId?: string; runId?: string } = {},
  ): Promise<RuntimeEnvelope> {
    return this.sendRequest(runtimeEnvelope(type, payload, {
      mpid: this.mpid,
      ...(context.instanceId === undefined ? {} : { instanceId: context.instanceId }),
      ...(context.runId === undefined ? {} : { runId: context.runId }),
    }));
  }

  private async sendRequest(envelope: RuntimeEnvelope): Promise<RuntimeEnvelope> {
    await this.start();
    const child = this.process;
    if (child === undefined || child.exitCode !== null) throw runtimeError("AGENT_PROCESS_UNAVAILABLE", "Agent process is unavailable", true);
    const response = new Promise<RuntimeEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.messageId);
        reject(runtimeError("RUNTIME_REQUEST_TIMEOUT", `${envelope.type} timed out`, true));
      }, this.options.requestTimeoutMs);
      this.pending.set(envelope.messageId, { resolve, reject, timer });
    });
    child.send(envelope);
    const reply = await response;
    if (reply.type === RuntimeMessageType.HOST_ERROR) unwrapReply(reply.payload);
    return reply;
  }

  private async receive(envelope: RuntimeEnvelope): Promise<void> {
    if (envelope.causationId !== undefined) {
      const pending = this.pending.get(envelope.causationId);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(envelope.causationId);
        pending.resolve(envelope);
        return;
      }
    }
    this.options.onEvent?.(envelope);
    const handler = this.options.handlers?.[envelope.type];
    if (handler === undefined) return;
    try {
      const data = await handler(envelope);
      this.process?.send(runtimeEnvelope(envelope.type, { ok: true, data }, responseContext(envelope, this.mpid)));
    } catch (error) {
      this.process?.send(runtimeEnvelope(envelope.type, {
        ok: false,
        error: {
          code: error instanceof MarcusError ? error.code : "RUNTIME_HANDLER_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: error instanceof MarcusError ? error.retryable : false,
          ...(error instanceof MarcusError && error.details !== undefined ? { details: error.details } : {}),
        },
      }, responseContext(envelope, this.mpid)));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function responseContext(envelope: RuntimeEnvelope, mpid: string) {
  return {
    mpid,
    causationId: envelope.messageId,
    correlationId: envelope.correlationId,
    traceId: envelope.traceId,
    ...(envelope.instanceId === undefined ? {} : { instanceId: envelope.instanceId }),
    ...(envelope.runId === undefined ? {} : { runId: envelope.runId }),
  };
}

function unwrapReply<T>(payload: unknown): T {
  const reply = payload as RuntimeReply<T>;
  if (reply?.ok === true) return reply.data;
  if (reply?.ok === false) {
    throw new MarcusError({
      code: reply.error.code,
      message: reply.error.message,
      retryable: reply.error.retryable,
      ...(reply.error.details === undefined ? {} : { details: reply.error.details }),
    });
  }
  throw runtimeError("RUNTIME_REPLY_INVALID", "Runtime reply is malformed", false);
}

function defaultEntrypoint(name: "host-process" | "process-entry"): string {
  return `${import.meta.dir}/${name}.ts`;
}

function runtimeError(code: string, message: string, retryable: boolean): MarcusError {
  return new MarcusError({ code, message, retryable });
}
