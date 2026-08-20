import { MarcusError, createId, type JsonValue } from "@marcus/contracts";
import {
  MNP_PREFACE,
  MNP_PREFACE_OK,
  MnpFrameCodec,
  MnpFrameDecoder,
  type MnpAuthentication,
  type MnpEvent,
  type MnpHello,
  type MnpRequest,
} from "@marcus/protocol";
import type { AuthenticationService } from "./auth";
import type { CommandRouter, MarcusSession } from "./router";
import type { SafeLogger } from "@marcus/observability";

export interface MnpServerOptions {
  hostname?: string;
  port?: number;
  tls?: Bun.TLSOptions;
  productVersion?: string;
  nodeId: string;
  maxFrameBytes?: number;
}

type Connection = {
  connectionId: string;
  stage: "preface" | "hello" | "auth" | "ready" | "closed";
  preface: Uint8Array;
  decoder: MnpFrameDecoder;
  writeQueue: Uint8Array[];
  hello?: MnpHello;
  session?: MarcusSession;
};

export interface RealtimePublication {
  topic: string;
  timestamp: string;
  payload: JsonValue;
  eventSeq?: number;
  projectId?: string;
  principalId?: string;
}

export interface MnpRealtimeStats {
  activeConnections: number;
  publishedEvents: number;
  deliveredEvents: number;
}

export class MnpServer {
  private readonly codec: MnpFrameCodec;
  private readonly connections = new Map<string, Bun.Socket<Connection>>();
  private listener: Bun.TCPSocketListener<Connection> | undefined;
  private publishedEvents = 0;
  private deliveredEvents = 0;

  constructor(
    readonly options: MnpServerOptions,
    private readonly authentication: AuthenticationService,
    private readonly router: CommandRouter,
    private readonly logger?: SafeLogger,
    private readonly canReceiveRealtime?: (session: MarcusSession, event: RealtimePublication) => boolean,
  ) {
    this.codec = new MnpFrameCodec(options.maxFrameBytes === undefined ? {} : { maxPayloadBytes: options.maxFrameBytes });
  }

  start(): { hostname: string; port: number } {
    if (this.listener !== undefined) return { hostname: this.options.hostname ?? "127.0.0.1", port: this.listener.port };
    this.listener = Bun.listen<Connection>({
      hostname: this.options.hostname ?? "127.0.0.1",
      port: this.options.port ?? 4242,
      ...(this.options.tls === undefined ? {} : { tls: this.options.tls }),
      socket: {
        open: (socket) => this.open(socket),
        data: (socket, data) => this.data(socket, data),
        drain: (socket) => this.drain(socket),
        close: (socket) => {
          this.logger?.debug("connection.closed", { connectionId: socket.data.connectionId, remoteAddress: socket.remoteAddress });
          socket.data.stage = "closed";
          this.connections.delete(socket.data.connectionId);
        },
        error: (socket, error) => {
          this.logger?.warn("connection.error", { connectionId: socket.data.connectionId, remoteAddress: socket.remoteAddress, error });
          socket.data.stage = "closed";
          this.connections.delete(socket.data.connectionId);
        },
      },
    });
    return { hostname: this.options.hostname ?? "127.0.0.1", port: this.listener.port };
  }

  stop(): void {
    this.listener?.stop(true);
    this.listener = undefined;
    this.connections.clear();
  }

  publishRealtime(event: RealtimePublication): void {
    this.publishedEvents += 1;
    for (const socket of this.connections.values()) {
      const session = socket.data.session;
      if (socket.data.stage !== "ready" || session === undefined) continue;
      if (this.canReceiveRealtime?.(session, event) === false) continue;
      const publication: MnpEvent<JsonValue> = {
        subscriptionId: "realtime",
        ...(event.eventSeq === undefined ? {} : { eventSeq: event.eventSeq }),
        topic: event.topic,
        timestamp: event.timestamp,
        payload: {
          ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
          data: event.payload,
        },
      };
      this.write(socket, this.codec.encodeJson("EVENT", publication));
      this.deliveredEvents += 1;
    }
  }

  realtimeStats(): MnpRealtimeStats {
    return {
      activeConnections: [...this.connections.values()].filter((socket) => socket.data.stage === "ready").length,
      publishedEvents: this.publishedEvents,
      deliveredEvents: this.deliveredEvents,
    };
  }

  private open(socket: Bun.Socket<Connection>): void {
    const connectionId = createId("connection");
    socket.data = {
      connectionId,
      stage: "preface",
      preface: new Uint8Array(0),
      decoder: new MnpFrameDecoder(this.options.maxFrameBytes === undefined ? {} : { maxPayloadBytes: this.options.maxFrameBytes }),
      writeQueue: [],
    };
    this.connections.set(connectionId, socket);
    this.logger?.debug("connection.opened", { connectionId: socket.data.connectionId, remoteAddress: socket.remoteAddress });
  }

  private data(socket: Bun.Socket<Connection>, data: Uint8Array): void {
    try {
      let remaining = data;
      if (socket.data.stage === "preface") {
        const joined = join(socket.data.preface, data);
        const expected = new TextEncoder().encode(MNP_PREFACE);
        const compared = Math.min(joined.length, expected.length);
        for (let index = 0; index < compared; index += 1) {
          if (joined[index] !== expected[index]) throw protocolError("PROTOCOL_PREFACE_INVALID", "Expected MNP/1 preface");
        }
        if (joined.length < expected.length) {
          socket.data.preface = joined;
          return;
        }
        remaining = joined.slice(expected.length);
        socket.data.preface = new Uint8Array(0);
        socket.data.stage = "hello";
        this.write(socket, new TextEncoder().encode(MNP_PREFACE_OK));
      }
      for (const frame of socket.data.decoder.push(remaining)) void this.frame(socket, frame.type, frame.payload);
    } catch (error) {
      this.sendError(socket, undefined, error);
      socket.terminate();
    }
  }

  private async frame(socket: Bun.Socket<Connection>, type: string, payload: Uint8Array): Promise<void> {
    const startedAt = performance.now();
    let requestContext: { requestId: string; operation: string; projectId?: string } | undefined;
    try {
      if (type === "PING") {
        this.write(socket, this.codec.encode("PONG", payload));
        return;
      }
      if (type === "CLOSE") {
        socket.end();
        return;
      }
      if (type === "HELLO" && socket.data.stage === "hello") {
        const hello = JSON.parse(new TextDecoder().decode(payload)) as MnpHello;
        if (hello.protocolVersion !== 1) throw protocolError("PROTOCOL_VERSION_UNSUPPORTED", "Only MNP/1 is supported");
        socket.data.hello = hello;
        socket.data.stage = "auth";
        this.write(socket, this.codec.encodeJson("HELLO", {
          protocolVersion: 1,
          productVersion: this.options.productVersion ?? "0.1.0",
          name: "marcusd",
          nodeId: this.options.nodeId,
          capabilities: ["multiplex", "events", "streaming", "uploads"],
        } satisfies MnpHello));
        return;
      }
      if (type === "AUTH" && socket.data.stage === "auth") {
        const authenticated = await this.authentication.authenticate(
          JSON.parse(new TextDecoder().decode(payload)) as MnpAuthentication,
          socket.remoteAddress,
        );
        const hello = socket.data.hello!;
        const session: MarcusSession = {
          sessionId: createId("session"),
          connectionId: socket.data.connectionId,
          principal: authenticated.principal,
          authenticatedAt: new Date().toISOString(),
          client: {
            name: hello.name,
            version: hello.productVersion,
            ...(hello.platform === undefined ? {} : { platform: hello.platform }),
          },
        };
        socket.data.session = session;
        socket.data.stage = "ready";
        this.logger?.info("session.authenticated", {
          connectionId: session.connectionId,
          sessionId: session.sessionId,
          principalId: session.principal.id,
          principalType: session.principal.type ?? "user",
          client: session.client.name,
          remoteAddress: socket.remoteAddress,
        });
        this.write(socket, this.codec.encodeJson("AUTH_OK", {
          sessionId: session.sessionId,
          principal: session.principal,
          permissions: authenticated.permissions,
        }));
        return;
      }
      if (type === "REQUEST" && socket.data.stage === "ready" && socket.data.session !== undefined) {
        const request = JSON.parse(new TextDecoder().decode(payload)) as MnpRequest;
        requestContext = {
          requestId: request.requestId,
          operation: request.operation,
          ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
        };
        const data = await this.router.route(socket.data.session, request, socket.remoteAddress);
        this.logger?.info("request.completed", {
          ...requestContext,
          durationMs: Math.round(performance.now() - startedAt),
          principalId: socket.data.session.principal.id,
        });
        this.write(socket, this.codec.encodeJson("RESPONSE", { requestId: request.requestId, ok: true, data, serverTime: new Date().toISOString() }));
        return;
      }
      throw protocolError("PROTOCOL_STATE_INVALID", `${type} is not valid during ${socket.data.stage}`);
    } catch (error) {
      this.logger?.error(type === "REQUEST" ? "request.failed" : "protocol.failed", {
        ...(requestContext ?? {}),
        frameType: type,
        durationMs: Math.round(performance.now() - startedAt),
        connectionId: socket.data.connectionId,
        error,
      });
      const requestId = type === "REQUEST" ? safeRequestId(payload) : undefined;
      this.sendError(socket, requestId, error, type === "AUTH" ? "AUTH_ERROR" : "ERROR");
      if (type === "AUTH") socket.end();
    }
  }

  private sendError(socket: Bun.Socket<Connection>, requestId: string | undefined, error: unknown, type: "ERROR" | "AUTH_ERROR" = "ERROR"): void {
    const source = error instanceof MarcusError
      ? error
      : new MarcusError({ code: "SERVICE_INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error), retryable: false });
    this.write(socket, this.codec.encodeJson(type, {
      ...(requestId === undefined ? {} : { requestId }),
      ok: false,
      error: source.toJSON(),
    }));
  }

  private write(socket: Bun.Socket<Connection>, bytes: Uint8Array): void {
    if (socket.data.writeQueue.length > 0) {
      socket.data.writeQueue.push(bytes);
      return;
    }
    const written = socket.write(bytes);
    if (written < 0) return;
    if (written < bytes.length) socket.data.writeQueue.push(bytes.slice(written));
  }

  private drain(socket: Bun.Socket<Connection>): void {
    while (socket.data.writeQueue.length > 0) {
      const bytes = socket.data.writeQueue.shift()!;
      const written = socket.write(bytes);
      if (written < 0) return;
      if (written < bytes.length) {
        socket.data.writeQueue.unshift(bytes.slice(written));
        return;
      }
    }
  }
}

function join(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

function safeRequestId(payload: Uint8Array): string | undefined {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as { requestId?: unknown };
    return typeof value.requestId === "string" ? value.requestId : undefined;
  } catch {
    return undefined;
  }
}

function protocolError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
