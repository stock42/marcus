import { createId, type JsonValue } from "@marcus/contracts";

export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export const RuntimeMessageType = {
  HOST_HELLO: "HOST_HELLO",
  LOAD_ARTIFACT: "LOAD_ARTIFACT",
  START_INSTANCE: "START_INSTANCE",
  INVOKE_RUN: "INVOKE_RUN",
  AUTH_VALIDATE: "AUTH_VALIDATE",
  CANCEL_RUN: "CANCEL_RUN",
  STOP_INSTANCE: "STOP_INSTANCE",
  TERMINATE_WORKER: "TERMINATE_WORKER",
  HEARTBEAT: "HEARTBEAT",
  PROGRESS: "PROGRESS",
  LOG: "LOG",
  MODEL_GENERATE: "MODEL_GENERATE",
  TOOL_CALL: "TOOL_CALL",
  TOOL_DISCOVERY: "TOOL_DISCOVERY",
  TOOL_RESULT: "TOOL_RESULT",
  SUBAGENT_REQUEST: "SUBAGENT_REQUEST",
  MESSAGE_SEND: "MESSAGE_SEND",
  EVENT_PUBLISH: "EVENT_PUBLISH",
  CONVERSATION_OPERATION: "CONVERSATION_OPERATION",
  CHECKPOINT_SAVE: "CHECKPOINT_SAVE",
  ARTIFACT_COMMIT: "ARTIFACT_COMMIT",
  FILE_OPERATION: "FILE_OPERATION",
  SECRET_GET: "SECRET_GET",
  APPROVAL_REQUEST: "APPROVAL_REQUEST",
  RUN_RESULT: "RUN_RESULT",
  INSTANCE_EXIT: "INSTANCE_EXIT",
  HOST_ERROR: "HOST_ERROR",
} as const;

export type RuntimeMessageType = (typeof RuntimeMessageType)[keyof typeof RuntimeMessageType];

export interface RuntimeEnvelope<TPayload = unknown> {
  version: 1;
  type: RuntimeMessageType;
  messageId: string;
  mpid?: string;
  instanceId?: string;
  runId?: string;
  taskId?: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
  timestamp: string;
  payload: TPayload;
}

export interface RuntimeErrorPayload {
  ok: false;
  error: { code: string; message: string; retryable: boolean; details?: JsonValue };
}

export interface RuntimeSuccessPayload<T = unknown> {
  ok: true;
  data: T;
}

export type RuntimeReply<T = unknown> = RuntimeSuccessPayload<T> | RuntimeErrorPayload;

export function runtimeEnvelope<T>(
  type: RuntimeMessageType,
  payload: T,
  context: Partial<Omit<RuntimeEnvelope<T>, "version" | "type" | "messageId" | "timestamp" | "payload">> = {},
): RuntimeEnvelope<T> {
  const messageId = createId("message");
  return {
    version: RUNTIME_PROTOCOL_VERSION,
    type,
    messageId,
    correlationId: context.correlationId ?? messageId,
    traceId: context.traceId ?? createId("trace"),
    timestamp: new Date().toISOString(),
    payload,
    ...(context.mpid === undefined ? {} : { mpid: context.mpid }),
    ...(context.instanceId === undefined ? {} : { instanceId: context.instanceId }),
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    ...(context.taskId === undefined ? {} : { taskId: context.taskId }),
    ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
  };
}

export function isRuntimeEnvelope(value: unknown): value is RuntimeEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RuntimeEnvelope>;
  return (
    candidate.version === 1 &&
    typeof candidate.type === "string" &&
    Object.values(RuntimeMessageType).includes(candidate.type as RuntimeMessageType) &&
    typeof candidate.messageId === "string" &&
    typeof candidate.correlationId === "string" &&
    typeof candidate.traceId === "string" &&
    typeof candidate.timestamp === "string" &&
    "payload" in candidate
  );
}
