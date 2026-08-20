import { MarcusError, createId, type JsonValue } from "@marcus/contracts";
import {
  MNP_PREFACE,
  MNP_PREFACE_OK,
  MNP_PROTOCOL_VERSION,
  MnpFrameCodec,
  MnpFrameDecoder,
  type MnpAuthOk,
  type MnpAuthentication,
  type MnpErrorResponse,
  type MnpEvent,
  type MnpFrame,
  type MnpHello,
  type MnpRequest,
  type MnpResponse,
} from "@marcus/protocol";

export interface MnpClientOptions {
  hostname: string;
  port: number;
  tls?: boolean | Bun.TLSOptions;
  authentication: MnpAuthentication;
  client?: { name?: string; version?: string; platform?: string; capabilities?: readonly string[] };
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxFrameBytes?: number;
}

type ClientSocketData = { client: MnpClient };
type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export class MnpClient {
  readonly options: MnpClientOptions;
  session?: MnpAuthOk;
  private readonly codec: MnpFrameCodec;
  private readonly decoder: MnpFrameDecoder;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(event: MnpEvent) => void>();
  private readonly writeQueue: Uint8Array[] = [];
  private socket?: Bun.Socket<ClientSocketData>;
  private preface = new Uint8Array(0);
  private stage: "disconnected" | "preface" | "hello" | "auth" | "ready" | "closed" = "disconnected";
  private connectionPromise?: Promise<MnpAuthOk>;
  private connectResolve?: (value: MnpAuthOk) => void;
  private connectReject?: (error: Error) => void;

  constructor(options: MnpClientOptions) {
    this.options = options;
    const limits = options.maxFrameBytes === undefined ? {} : { maxPayloadBytes: options.maxFrameBytes };
    this.codec = new MnpFrameCodec(limits);
    this.decoder = new MnpFrameDecoder(limits);
  }

  async connect(): Promise<MnpAuthOk> {
    if (this.session !== undefined && this.stage === "ready") return this.session;
    if (this.connectionPromise !== undefined) return this.connectionPromise;
    this.connectionPromise = new Promise<MnpAuthOk>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    const timeout = setTimeout(
      () => this.failConnection(clientError("MNP_CONNECT_TIMEOUT", "Timed out connecting or authenticating", true)),
      this.options.connectTimeoutMs ?? 5_000,
    );
    try {
      this.socket = await Bun.connect<ClientSocketData>({
        hostname: this.options.hostname,
        port: this.options.port,
        ...(this.options.tls === undefined ? {} : { tls: this.options.tls }),
        data: { client: this },
        socket: socketHandlers,
      });
      const session = await this.connectionPromise;
      clearTimeout(timeout);
      return session;
    } catch (error) {
      clearTimeout(timeout);
      this.failConnection(asError(error));
      throw error;
    }
  }

  async request<TData = JsonValue, TPayload = JsonValue>(
    operation: string,
    payload: TPayload,
    options: { projectId?: string; idempotencyKey?: string; deadlineAt?: string; timeoutMs?: number } = {},
  ): Promise<TData> {
    await this.connect();
    const requestId = createId("message");
    const request: MnpRequest<TPayload> = {
      requestId,
      operation,
      protocolVersion: MNP_PROTOCOL_VERSION,
      payload,
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt }),
    };
    const result = new Promise<TData>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(clientError("MNP_REQUEST_TIMEOUT", `${operation} timed out`, true));
      }, options.timeoutMs ?? this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(requestId, { resolve: (value) => resolve(value as TData), reject, timer });
    });
    this.write(this.codec.encodeJson("REQUEST", request));
    return result;
  }

  subscribe(listener: (event: MnpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ping(sequence = Date.now()): void {
    this.write(this.codec.encodeJson("PING", { sequence, sentAt: new Date().toISOString() }));
  }

  close(): void {
    if (this.stage === "closed") return;
    if (this.socket?.readyState === 1) {
      this.write(this.codec.encodeJson("CLOSE", { reason: "client-close" }));
      this.socket.end();
    }
    this.stage = "closed";
    this.rejectPending(clientError("MNP_CONNECTION_CLOSED", "MNP connection closed", true));
  }

  _open(socket: Bun.Socket<ClientSocketData>): void {
    this.stage = "preface";
    this.writeToSocket(socket, new TextEncoder().encode(MNP_PREFACE));
  }

  _data(socket: Bun.Socket<ClientSocketData>, data: Uint8Array): void {
    try {
      let remaining = data;
      if (this.stage === "preface") {
        const joined = new Uint8Array(this.preface.length + data.length);
        joined.set(this.preface);
        joined.set(data, this.preface.length);
        const expected = new TextEncoder().encode(MNP_PREFACE_OK);
        const compared = Math.min(joined.length, expected.length);
        for (let index = 0; index < compared; index += 1) {
          if (joined[index] !== expected[index]) throw clientError("PROTOCOL_PREFACE_INVALID", "Server rejected MNP/1 preface", false);
        }
        if (joined.length < expected.length) {
          this.preface = joined;
          return;
        }
        this.preface = new Uint8Array(0);
        remaining = joined.slice(expected.length);
        this.stage = "hello";
        const hello: MnpHello = {
          protocolVersion: 1,
          productVersion: this.options.client?.version ?? "0.1.0",
          name: this.options.client?.name ?? "marcus-client",
          capabilities: this.options.client?.capabilities ?? ["multiplex", "events", "streaming"],
          ...(this.options.client?.platform === undefined ? {} : { platform: this.options.client.platform }),
        };
        this.writeToSocket(socket, this.codec.encodeJson("HELLO", hello));
      }
      for (const frame of this.decoder.push(remaining)) this.handleFrame(frame);
    } catch (error) {
      this.failConnection(asError(error));
      socket.terminate();
    }
  }

  _drain(socket: Bun.Socket<ClientSocketData>): void {
    while (this.writeQueue.length > 0) {
      const bytes = this.writeQueue.shift()!;
      const written = socket.write(bytes);
      if (written < 0) return this.failConnection(clientError("MNP_CONNECTION_CLOSED", "Socket closed while writing", true));
      if (written < bytes.length) {
        this.writeQueue.unshift(bytes.slice(written));
        return;
      }
    }
  }

  _close(): void {
    this.stage = "closed";
    this.failConnection(clientError("MNP_CONNECTION_CLOSED", "Server closed the connection", true));
  }

  private handleFrame(frame: MnpFrame): void {
    if (frame.type === "HELLO" && this.stage === "hello") {
      const hello = this.codec.decodeJson<MnpHello>(frame);
      if (hello.protocolVersion !== 1) throw clientError("PROTOCOL_VERSION_UNSUPPORTED", "Server does not support MNP/1", false);
      this.stage = "auth";
      this.write(this.codec.encodeJson("AUTH", this.options.authentication));
      return;
    }
    if (frame.type === "AUTH_OK" && this.stage === "auth") {
      this.session = this.codec.decodeJson<MnpAuthOk>(frame);
      this.stage = "ready";
      this.connectResolve?.(this.session);
      return;
    }
    if (frame.type === "AUTH_ERROR") {
      const error = this.codec.decodeJson<MnpErrorResponse>(frame);
      throw responseError(error);
    }
    if (frame.type === "RESPONSE") {
      const response = this.codec.decodeJson<MnpResponse>(frame);
      const pending = this.pending.get(response.requestId);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.requestId);
      pending.resolve(response.data);
      return;
    }
    if (frame.type === "ERROR") {
      const response = this.codec.decodeJson<MnpErrorResponse>(frame);
      if (response.requestId === undefined) throw responseError(response);
      const pending = this.pending.get(response.requestId);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.requestId);
      pending.reject(responseError(response));
      return;
    }
    if (frame.type === "EVENT") {
      const event = this.codec.decodeJson<MnpEvent>(frame);
      for (const listener of this.listeners) listener(event);
      return;
    }
    if (frame.type === "PING") {
      this.write(this.codec.encode("PONG", frame.payload));
      return;
    }
    if (frame.type === "CLOSE") this.close();
  }

  private write(bytes: Uint8Array): void {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== 1) throw clientError("MNP_CONNECTION_CLOSED", "MNP socket is not open", true);
    this.writeToSocket(socket, bytes);
  }

  private writeToSocket(socket: Bun.Socket<ClientSocketData>, bytes: Uint8Array): void {
    if (this.writeQueue.length > 0) {
      this.writeQueue.push(bytes);
      return;
    }
    const written = socket.write(bytes);
    if (written < 0) throw clientError("MNP_CONNECTION_CLOSED", "MNP socket closed while writing", true);
    if (written < bytes.length) this.writeQueue.push(bytes.slice(written));
  }

  private failConnection(error: Error): void {
    this.connectReject?.(error);
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const socketHandlers: Bun.SocketHandler<ClientSocketData> = {
  open: (socket) => socket.data.client._open(socket),
  data: (socket, data) => socket.data.client._data(socket, data),
  drain: (socket) => socket.data.client._drain(socket),
  close: (socket) => socket.data.client._close(),
  error: (socket, error) => socket.data.client._close(),
  connectError: (socket, error) => socket.data.client._close(),
};

function responseError(response: MnpErrorResponse): MarcusError {
  return new MarcusError({
    code: response.error.code,
    message: response.error.message,
    retryable: response.error.retryable,
    ...(response.error.details === undefined ? {} : { details: response.error.details }),
    ...(response.error.traceId === undefined ? {} : { traceId: response.error.traceId }),
  });
}

function clientError(code: string, message: string, retryable: boolean): MarcusError {
  return new MarcusError({ code, message, retryable });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
