import type { JsonValue } from "@marcus/contracts";
import { appendFile, chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  projectId?: string;
  agentId?: string;
  agentVersionId?: string;
  instanceId?: string;
  runId?: string;
  mpid?: string;
  traceId?: string;
  attributes: Readonly<Record<string, JsonValue>>;
}

export interface LogSink {
  write(record: LogRecord): void | Promise<void>;
}

export class RedactedValue {
  readonly value = "[REDACTED]";
}

const sensitiveKey = /(?:password|passwd|secret|token|credential|authorization|cookie|api[-_]?key)/iu;

export class SafeLogger {
  private readonly source: string;
  private readonly sink: LogSink;
  private readonly context: Omit<LogRecord, "timestamp" | "level" | "source" | "message" | "attributes">;
  private readonly now: () => Date;

  constructor(options: {
    source: string;
    sink: LogSink;
    context?: Omit<LogRecord, "timestamp" | "level" | "source" | "message" | "attributes">;
    now?: () => Date;
  }) {
    this.source = options.source;
    this.sink = options.sink;
    this.context = options.context ?? {};
    this.now = options.now ?? (() => new Date());
  }

  redact(_value: unknown): RedactedValue {
    return new RedactedValue();
  }

  child(context: Partial<typeof this.context>): SafeLogger {
    return new SafeLogger({ source: this.source, sink: this.sink, context: { ...this.context, ...context }, now: this.now });
  }

  debug(message: string, attributes: Record<string, unknown> = {}): void { this.log("debug", message, attributes); }
  info(message: string, attributes: Record<string, unknown> = {}): void { this.log("info", message, attributes); }
  warn(message: string, attributes: Record<string, unknown> = {}): void { this.log("warn", message, attributes); }
  error(message: string, attributes: Record<string, unknown> = {}): void { this.log("error", message, attributes); }

  private log(level: LogLevel, message: string, attributes: Record<string, unknown>): void {
    void this.sink.write({
      timestamp: this.now().toISOString(),
      level,
      source: this.source,
      message,
      ...this.context,
      attributes: sanitize(attributes) as Record<string, JsonValue>,
    });
  }
}

export class MemoryLogSink implements LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void { this.records.push(structuredClone(record)); }
}

export class JsonLineFileLogSink implements LogSink {
  private pending = Promise.resolve();

  constructor(readonly path: string) {}

  write(record: LogRecord): void {
    this.pending = this.pending.then(async () => {
      await mkdir(resolve(this.path, ".."), { recursive: true, mode: 0o700 });
      await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(this.path, 0o600);
    }).catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.pending;
  }
}

export function createMarcusFileLogger(
  source: string,
  options: { logsDir?: string; context?: Omit<LogRecord, "timestamp" | "level" | "source" | "message" | "attributes"> } = {},
): SafeLogger {
  const logsDir = options.logsDir ?? resolve(homedir(), ".marcus", "logs");
  return new SafeLogger({
    source,
    sink: new JsonLineFileLogSink(resolve(logsDir, "all.log")),
    ...(options.context === undefined ? {} : { context: options.context }),
  });
}

function sanitize(value: unknown, key = ""): JsonValue {
  if (value instanceof RedactedValue || sensitiveKey.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [childKey, sanitize(item, childKey)]));
  }
  return String(value);
}
