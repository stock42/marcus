export const STUDIO_PROTOCOL = "marcus.studio/v1" as const;
export const STUDIO_SESSION_COOKIE = "marcus_studio_session" as const;
export const STUDIO_REQUEST_ID_HEADER = "x-marcus-studio-request-id" as const;
export const STUDIO_IDEMPOTENCY_HEADER = "x-marcus-studio-idempotency-key" as const;

export const STUDIO_LIMITS = Object.freeze({
  promptCharacters: 4_000,
  sourceBytes: 64 * 1_024,
  requestsPerMinute: 10,
  windowMs: 60_000,
  maxOutputTokens: 8_192,
});

export type StudioFormat = "markdown" | "typescript";
export type StudioRequestId = `streq_${string}`;

export interface StudioSourceVersion {
  number: number;
  filename: string;
  source: string;
}

export interface StudioGenerationRequest {
  requestId: StudioRequestId;
  idempotencyKey: string;
  format: StudioFormat;
  prompt: string;
  baseVersion?: StudioSourceVersion;
}

export interface StudioDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  line?: number;
  column?: number;
}

export interface StudioGeneratedOutput {
  format: StudioFormat;
  filename: string;
  name: string;
  summary: string;
  source: string;
  assumptions: readonly string[];
  warnings: readonly string[];
  diagnostics: readonly StudioDiagnostic[];
  valid: boolean;
  validationLabel: string;
}

export type StudioStage =
  | "request-accepted"
  | "quota-reserved"
  | "provider-connecting"
  | "provider-thinking"
  | "provider-answering"
  | "marcus-validating"
  | "completed";

export type StudioErrorCode =
  | "STUDIO_INVALID_REQUEST"
  | "STUDIO_RATE_LIMITED"
  | "STUDIO_SESSION_EXPIRED"
  | "STUDIO_PROVIDER_BUSY"
  | "STUDIO_PROVIDER_TIMEOUT"
  | "STUDIO_PROVIDER_FAILED"
  | "STUDIO_OUTPUT_INVALID"
  | "STUDIO_MARKDOWN_INVALID"
  | "STUDIO_TYPESCRIPT_INVALID"
  | "STUDIO_IDEMPOTENCY_CONFLICT"
  | "STUDIO_CANCELLED"
  | "STUDIO_CONNECTION_LOST";

interface StudioEventBase<TType extends string, TData> {
  protocol: typeof STUDIO_PROTOCOL;
  type: TType;
  requestId?: StudioRequestId;
  sequence: number;
  emittedAt: string;
  data: TData;
}

export type StudioServerEvent =
  | StudioEventBase<"session.ready", {
      sessionExpiresAt: string;
      quota: StudioQuota;
      model: string;
    }>
  | StudioEventBase<"quota.updated", { quota: StudioQuota }>
  | StudioEventBase<"request.accepted", { format: StudioFormat }>
  | StudioEventBase<"request.replayed", { status: "running" | "completed" | "failed" }>
  | StudioEventBase<"generation.stage", { stage: StudioStage; message: string }>
  | StudioEventBase<"generation.validation", { diagnostics: readonly StudioDiagnostic[]; valid: boolean }>
  | StudioEventBase<"generation.completed", { output: StudioGeneratedOutput; usage?: StudioUsage }>
  | StudioEventBase<"generation.failed", { code: StudioErrorCode; message: string; retryable: boolean; diagnostics?: readonly StudioDiagnostic[] }>
  | StudioEventBase<"generation.rate_limited", { retryAfterMs: number; quota: StudioQuota }>
  | StudioEventBase<"pong", { at: string }>;

export interface StudioQuota {
  limit: number;
  remaining: number;
  windowMs: number;
  retryAfterMs: number;
}

export interface StudioUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type StudioClientMessage =
  | { protocol: typeof STUDIO_PROTOCOL; type: "resume"; requestId: StudioRequestId; afterSequence: number }
  | { protocol: typeof STUDIO_PROTOCOL; type: "generation.cancel"; requestId: StudioRequestId }
  | { protocol: typeof STUDIO_PROTOCOL; type: "ping" };

export type StudioRequestParseResult =
  | { success: true; data: StudioGenerationRequest }
  | { success: false; message: string };

export function parseStudioGenerationRequest(value: unknown): StudioRequestParseResult {
  if (!isRecord(value)) return invalid("El payload debe ser un objeto JSON.");
  if (!isRequestId(value.requestId)) return invalid("requestId no pertenece al contrato streq_.");
  if (!isToken(value.idempotencyKey, 16, 160)) return invalid("idempotencyKey debe tener entre 16 y 160 caracteres seguros.");
  if (value.format !== "markdown" && value.format !== "typescript") return invalid("format debe ser markdown o typescript.");
  if (typeof value.prompt !== "string" || value.prompt.trim().length < 12 || value.prompt.length > STUDIO_LIMITS.promptCharacters) {
    return invalid(`prompt debe tener entre 12 y ${STUDIO_LIMITS.promptCharacters} caracteres.`);
  }
  let baseVersion: StudioSourceVersion | undefined;
  if (value.baseVersion !== undefined) {
    if (!isRecord(value.baseVersion)) return invalid("baseVersion debe ser un objeto.");
    if (!Number.isSafeInteger(value.baseVersion.number) || Number(value.baseVersion.number) < 1) return invalid("baseVersion.number debe ser positivo.");
    if (!safeFilename(value.baseVersion.filename)) return invalid("baseVersion.filename no es seguro.");
    if (typeof value.baseVersion.source !== "string" || byteLength(value.baseVersion.source) > STUDIO_LIMITS.sourceBytes) {
      return invalid(`baseVersion.source supera ${STUDIO_LIMITS.sourceBytes} bytes.`);
    }
    baseVersion = {
      number: Number(value.baseVersion.number),
      filename: value.baseVersion.filename,
      source: value.baseVersion.source,
    };
  }
  return {
    success: true,
    data: {
      requestId: value.requestId,
      idempotencyKey: value.idempotencyKey,
      format: value.format,
      prompt: value.prompt.trim(),
      ...(baseVersion === undefined ? {} : { baseVersion }),
    },
  };
}

export function parseStudioClientMessage(value: unknown): StudioClientMessage | undefined {
  if (!isRecord(value) || value.protocol !== STUDIO_PROTOCOL || typeof value.type !== "string") return undefined;
  if (value.type === "ping") return { protocol: STUDIO_PROTOCOL, type: "ping" };
  if (value.type === "generation.cancel" && isRequestId(value.requestId)) {
    return { protocol: STUDIO_PROTOCOL, type: value.type, requestId: value.requestId };
  }
  if (value.type === "resume" && isRequestId(value.requestId) && Number.isSafeInteger(value.afterSequence) && Number(value.afterSequence) >= 0) {
    return { protocol: STUDIO_PROTOCOL, type: value.type, requestId: value.requestId, afterSequence: Number(value.afterSequence) };
  }
  return undefined;
}

export function isStudioServerEvent(value: unknown): value is StudioServerEvent {
  return isRecord(value)
    && value.protocol === STUDIO_PROTOCOL
    && typeof value.type === "string"
    && Number.isSafeInteger(value.sequence)
    && typeof value.emittedAt === "string"
    && isRecord(value.data);
}

export function safeStudioFilename(value: string, format: StudioFormat): string {
  const extension = format === "markdown" ? ".agent.md" : ".ts";
  const withoutExtension = value.replace(/(?:\.agent\.md|\.tsx?|\.md)$/iu, "");
  const slug = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "marcus-agent";
  return `${slug}${extension}`;
}

function invalid(message: string): StudioRequestParseResult {
  return { success: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is StudioRequestId {
  return typeof value === "string" && /^streq_[a-zA-Z0-9_-]{12,96}$/u.test(value);
}

function isToken(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && /^[a-zA-Z0-9._~-]+$/u.test(value);
}

function safeFilename(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\\/\0]/u.test(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
