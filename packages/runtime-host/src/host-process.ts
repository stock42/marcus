import { MarcusError } from "@marcus/contracts";
import {
  RuntimeMessageType,
  isRuntimeEnvelope,
  runtimeEnvelope,
  type RuntimeEnvelope,
} from "./protocol";

type HostedWorker = {
  worker: Worker;
  artifactPath: string;
  ready: Promise<void>;
};

const mpid = readArgument("--mpid") ?? `runtime-host-${process.pid}`;
const artifacts = new Map<string, string>();
const workers = new Map<string, HostedWorker>();
const bridgeRequests = new Map<string, Worker>();
const runRequests = new Map<string, RuntimeEnvelope>();
let closing = false;

process.on("message", (message: unknown) => {
  if (!isRuntimeEnvelope(message)) return;
  if (message.causationId !== undefined) {
    const worker = bridgeRequests.get(message.causationId);
    if (worker !== undefined) {
      bridgeRequests.delete(message.causationId);
      worker.postMessage(message);
      return;
    }
  }
  void receive(message);
});

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
process.on("disconnect", () => void shutdown(0));

send(runtimeEnvelope(RuntimeMessageType.HOST_HELLO, { pid: process.pid, runtimeVersion: "1" }, { mpid }));
const heartbeat = setInterval(() => {
  send(runtimeEnvelope(RuntimeMessageType.HEARTBEAT, { pid: process.pid, instances: workers.size }, { mpid }));
}, 1_000);
heartbeat.unref();

async function receive(envelope: RuntimeEnvelope): Promise<void> {
  try {
    switch (envelope.type) {
      case RuntimeMessageType.LOAD_ARTIFACT: {
        requireInstance(envelope);
        const artifactPath = (envelope.payload as { artifactPath?: unknown }).artifactPath;
        if (typeof artifactPath !== "string") throw new Error("LOAD_ARTIFACT requires artifactPath");
        if (!(await Bun.file(artifactPath).exists())) throw new Error(`Artifact does not exist: ${artifactPath}`);
        artifacts.set(envelope.instanceId, artifactPath);
        reply(envelope, RuntimeMessageType.LOAD_ARTIFACT, { loaded: true });
        return;
      }
      case RuntimeMessageType.START_INSTANCE:
        await startWorker(envelope);
        return;
      case RuntimeMessageType.INVOKE_RUN: {
        const worker = getWorker(envelope);
        if (envelope.runId !== undefined) runRequests.set(envelope.runId, envelope);
        worker.postMessage(envelope);
        return;
      }
      case RuntimeMessageType.AUTH_VALIDATE:
        getWorker(envelope).postMessage(envelope);
        return;
      case RuntimeMessageType.CANCEL_RUN:
        await cancelRun(envelope);
        return;
      case RuntimeMessageType.STOP_INSTANCE:
        await stopWorker(envelope);
        return;
      case RuntimeMessageType.TERMINATE_WORKER:
        await terminateWorker(envelope, "terminated by daemon");
        reply(envelope, RuntimeMessageType.TERMINATE_WORKER, { terminated: true });
        return;
      default:
        sendError(envelope, "RUNTIME_HOST_MESSAGE_UNSUPPORTED", `Runtime Host cannot handle ${envelope.type}`);
    }
  } catch (error) {
    sendError(envelope, error instanceof MarcusError ? error.code : "RUNTIME_HOST_FAILED", errorMessage(error));
  }
}

async function startWorker(envelope: RuntimeEnvelope): Promise<void> {
  requireInstance(envelope);
  const artifactPath = artifacts.get(envelope.instanceId);
  if (artifactPath === undefined) throw new Error(`No artifact loaded for ${envelope.instanceId}`);
  if (workers.has(envelope.instanceId)) throw new Error(`Instance ${envelope.instanceId} already started`);
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const worker = new Worker(workerEntrypoint(), { name: `marcus-${envelope.instanceId}` });
  const hosted: HostedWorker = { worker, artifactPath, ready };
  workers.set(envelope.instanceId, hosted);
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!isRuntimeEnvelope(event.data)) return;
    if (event.data.type === RuntimeMessageType.HOST_HELLO) {
      resolveReady?.();
      return;
    }
    receiveWorker(event.data, worker);
  });
  worker.addEventListener("error", (event: ErrorEvent) => {
    rejectReady?.(new Error(event.message));
    failRunsForInstance(envelope.instanceId!, "RUNTIME_WORKER_CRASHED", event.message || "Worker crashed");
  });
  worker.addEventListener("close", () => {
    workers.delete(envelope.instanceId!);
    send(runtimeEnvelope(RuntimeMessageType.INSTANCE_EXIT, { reason: "worker-closed" }, {
      mpid,
      instanceId: envelope.instanceId,
      correlationId: envelope.correlationId,
      traceId: envelope.traceId,
    }));
  });
  const didStart = await Promise.race([ready.then(() => true), Bun.sleep(2_000).then(() => false)]);
  if (!didStart) {
    worker.terminate();
    workers.delete(envelope.instanceId);
    throw new Error("Worker did not send HOST_HELLO");
  }
  const startOptions = typeof envelope.payload === "object" && envelope.payload !== null ? envelope.payload as { authOnly?: boolean } : {};
  worker.postMessage(
    runtimeEnvelope(RuntimeMessageType.START_INSTANCE, { artifactPath, ...(startOptions.authOnly === true ? { authOnly: true } : {}) }, {
      mpid,
      instanceId: envelope.instanceId,
      causationId: envelope.messageId,
      correlationId: envelope.correlationId,
      traceId: envelope.traceId,
    }),
  );
}

function receiveWorker(envelope: RuntimeEnvelope, worker: Worker): void {
  if (envelope.type === RuntimeMessageType.RUN_RESULT && envelope.runId !== undefined) runRequests.delete(envelope.runId);
  const managed = new Set<RuntimeMessageType>([
    RuntimeMessageType.MODEL_GENERATE,
    RuntimeMessageType.TOOL_CALL,
    RuntimeMessageType.TOOL_DISCOVERY,
    RuntimeMessageType.TOOL_RESULT,
    RuntimeMessageType.SUBAGENT_REQUEST,
    RuntimeMessageType.MESSAGE_SEND,
    RuntimeMessageType.EVENT_PUBLISH,
    RuntimeMessageType.CONVERSATION_OPERATION,
    RuntimeMessageType.CHECKPOINT_SAVE,
    RuntimeMessageType.ARTIFACT_COMMIT,
    RuntimeMessageType.FILE_OPERATION,
    RuntimeMessageType.SECRET_GET,
    RuntimeMessageType.APPROVAL_REQUEST,
  ]);
  if (managed.has(envelope.type)) bridgeRequests.set(envelope.messageId, worker);
  send({ ...envelope, mpid });
}

async function cancelRun(envelope: RuntimeEnvelope): Promise<void> {
  const runId = envelope.runId;
  if (runId === undefined) throw new Error("CANCEL_RUN requires runId");
  const invocation = runRequests.get(runId);
  if (invocation === undefined || invocation.instanceId === undefined) {
    reply(envelope, RuntimeMessageType.CANCEL_RUN, { cancelled: false });
    return;
  }
  const hosted = workers.get(invocation.instanceId);
  if (hosted === undefined) {
    reply(envelope, RuntimeMessageType.CANCEL_RUN, { cancelled: false });
    return;
  }
  hosted.worker.postMessage(runtimeEnvelope(RuntimeMessageType.CANCEL_RUN, envelope.payload, {
    mpid,
    instanceId: invocation.instanceId,
    runId,
    correlationId: envelope.correlationId,
    traceId: envelope.traceId,
  }));
  reply(envelope, RuntimeMessageType.CANCEL_RUN, { cancelled: true });
  const graceMs = Math.max(0, Math.min(Number((envelope.payload as { graceMs?: unknown }).graceMs ?? 1_000), 30_000));
  setTimeout(() => {
    if (!runRequests.has(runId)) return;
    void terminateWorker(invocation, "cancellation grace elapsed").then(() => {
      failRun(invocation, "RUN_KILLED", "Worker was terminated after cancellation timeout");
    });
  }, graceMs);
}

async function stopWorker(envelope: RuntimeEnvelope): Promise<void> {
  const hosted = getHosted(envelope);
  const closePromise = new Promise<void>((resolve) => hosted.worker.addEventListener("close", () => resolve(), { once: true }));
  hosted.worker.postMessage(envelope);
  const closed = await Promise.race([closePromise.then(() => true), Bun.sleep(1_000).then(() => false)]);
  if (!closed) await terminateWorker(envelope, "shutdown timeout");
  reply(envelope, RuntimeMessageType.STOP_INSTANCE, { stopped: true });
}

async function terminateWorker(envelope: RuntimeEnvelope, reason: string): Promise<void> {
  const hosted = getHosted(envelope);
  const instanceId = envelope.instanceId!;
  const closePromise = new Promise<void>((resolve) => hosted.worker.addEventListener("close", () => resolve(), { once: true }));
  hosted.worker.terminate();
  const closed = await Promise.race([closePromise.then(() => true), Bun.sleep(1_000).then(() => false)]);
  if (!closed) {
    sendError(envelope, "RUNTIME_WORKER_TERMINATE_TIMEOUT", `Worker did not terminate: ${reason}`);
    await shutdown(70);
    return;
  }
  workers.delete(instanceId);
}

function failRunsForInstance(instanceId: string, code: string, message: string): void {
  for (const request of runRequests.values()) {
    if (request.instanceId === instanceId) failRun(request, code, message);
  }
}

function failRun(request: RuntimeEnvelope, code: string, message: string): void {
  if (request.runId !== undefined) runRequests.delete(request.runId);
  send(
    runtimeEnvelope(
      RuntimeMessageType.RUN_RESULT,
      { ok: false, error: { code, message, retryable: true } },
      replyContext(request),
    ),
  );
}

function getWorker(envelope: RuntimeEnvelope): Worker {
  return getHosted(envelope).worker;
}

function getHosted(envelope: RuntimeEnvelope): HostedWorker {
  requireInstance(envelope);
  const hosted = workers.get(envelope.instanceId);
  if (hosted === undefined) throw new Error(`Instance ${envelope.instanceId} is not running`);
  return hosted;
}

function requireInstance(envelope: RuntimeEnvelope): asserts envelope is RuntimeEnvelope & { instanceId: string } {
  if (envelope.instanceId === undefined) throw new Error(`${envelope.type} requires instanceId`);
}

function reply(request: RuntimeEnvelope, type: RuntimeMessageType, data: unknown): void {
  send(runtimeEnvelope(type, { ok: true, data }, replyContext(request)));
}

function sendError(request: RuntimeEnvelope, code: string, message: string): void {
  send(runtimeEnvelope(RuntimeMessageType.HOST_ERROR, { ok: false, error: { code, message, retryable: false } }, replyContext(request)));
}

function replyContext(request: RuntimeEnvelope) {
  return {
    mpid,
    causationId: request.causationId ?? request.messageId,
    correlationId: request.correlationId,
    traceId: request.traceId,
    ...(request.instanceId === undefined ? {} : { instanceId: request.instanceId }),
    ...(request.runId === undefined ? {} : { runId: request.runId }),
  };
}

function send(envelope: RuntimeEnvelope): void {
  process.send?.(envelope);
}

async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  for (const hosted of workers.values()) hosted.worker.terminate();
  await Bun.sleep(10);
  process.exit(code);
}

function workerEntrypoint(): string {
  if (import.meta.dir.includes("$bunfs")) return "./worker-entry.ts";
  return `${import.meta.dir}/worker-entry.ts`;
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
