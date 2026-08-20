import { MarcusError, type JsonValue } from "@marcus/contracts";
import { createMarcusFileLogger, type SafeLogger } from "@marcus/observability";
import { OpenAICompatibleProvider, type ModelProvider } from "@marcus/provider-contracts";
import {
  STUDIO_IDEMPOTENCY_HEADER,
  STUDIO_LIMITS,
  STUDIO_PROTOCOL,
  STUDIO_REQUEST_ID_HEADER,
  STUDIO_SESSION_COOKIE,
  isStudioServerEvent,
  parseStudioClientMessage,
  parseStudioGenerationRequest,
  type StudioClientMessage,
  type StudioErrorCode,
  type StudioGenerationRequest,
  type StudioRequestId,
  type StudioServerEvent,
  type StudioUsage,
} from "@marcus/studio-contracts";
import type { StudioGatewayConfig } from "./config";
import { STUDIO_OUTPUT_EXAMPLE, STUDIO_OUTPUT_SCHEMA, studioMessages, type ProviderStudioOutput } from "./prompt";
import { StudioStore } from "./storage";
import { validateStudioOutput } from "./validation";

type StudioSocketData = { sessionId: string };
type StudioSocket = Bun.ServerWebSocket<StudioSocketData>;
type PendingEvent = Omit<StudioServerEvent, "sequence" | "emittedAt" | "requestId">;

export class MarcusStudioGateway {
  private readonly store: StudioStore;
  private readonly provider: ModelProvider;
  private readonly logger: SafeLogger;
  private readonly sockets = new Map<string, Set<StudioSocket>>();
  private readonly controllers = new Map<StudioRequestId, AbortController>();
  private readonly activeSessions = new Map<string, StudioRequestId>();
  private readonly cancelled = new Set<StudioRequestId>();
  private server?: Bun.Server<StudioSocketData>;

  constructor(readonly config: StudioGatewayConfig, options: { provider?: ModelProvider; logger?: SafeLogger } = {}) {
    this.store = new StudioStore(config.databasePath, config.eventEncryptionKey);
    this.provider = options.provider ?? new OpenAICompatibleProvider({
      id: "studio-deepseek",
      catalogId: "deepseek",
      baseUrl: config.providerBaseUrl,
      apiKey: config.providerApiKey,
      timeoutMs: config.providerTimeoutMs,
    });
    this.logger = options.logger ?? createMarcusFileLogger("marcus-studio-gateway", { logsDir: config.logsDir });
  }

  start(): Bun.Server<StudioSocketData> {
    if (this.server !== undefined) return this.server;
    this.server = Bun.serve<StudioSocketData>({
      hostname: this.config.host,
      port: this.config.port,
      idleTimeout: 120,
      maxRequestBodySize: STUDIO_LIMITS.sourceBytes + STUDIO_LIMITS.promptCharacters + 8_192,
      fetch: (request, server) => this.fetch(request, server),
      websocket: {
        maxPayloadLength: 16 * 1_024,
        backpressureLimit: 256 * 1_024,
        closeOnBackpressureLimit: true,
        open: (socket) => { void this.openSocket(socket); },
        message: (socket, message) => { void this.handleSocketMessage(socket, message); },
        close: (socket) => this.closeSocket(socket),
      },
    });
    this.logger.info("studio.ready", { host: this.config.host, port: this.server.port, model: this.config.providerModel });
    return this.server;
  }

  async stop(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    for (const group of this.sockets.values()) for (const socket of group) socket.terminate();
    this.sockets.clear();
    this.controllers.clear();
    this.activeSessions.clear();
    await Bun.sleep(0);
    if (this.server !== undefined) {
      const shutdown = this.server.stop(true);
      await Promise.race([shutdown, Bun.sleep(250)]);
      void shutdown.catch(() => undefined);
    }
    this.server = undefined;
    this.store.close();
    this.logger.info("studio.stopped");
  }

  private async fetch(request: Request, server: Bun.Server<StudioSocketData>): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname === "/health/live" && request.method === "GET") {
      return Response.json({ ok: true, service: "marcus-studio-gateway" }, { headers: securityHeaders() });
    }
    const origin = request.headers.get("origin");
    if (!this.originAllowed(origin)) return new Response("Origin not allowed", { status: 403, headers: securityHeaders() });
    if (request.method === "OPTIONS") return this.cors(new Response(null, { status: 204 }), origin!);
    if (url.pathname === "/api/studio/sessions" && request.method === "POST") {
      return this.cors(await this.createSession(request, server), origin!);
    }
    if (url.pathname === "/api/studio/ws" && request.method === "GET") {
      const sessionId = await this.authenticate(request);
      if (sessionId === undefined) return this.cors(new Response("Studio session required", { status: 401 }), origin!);
      const upgraded = server.upgrade(request, { data: { sessionId } });
      if (upgraded) return undefined;
      return this.cors(new Response("WebSocket upgrade failed", { status: 400 }), origin!);
    }
    if (url.pathname === "/api/studio/requests" && request.method === "POST") {
      return this.cors(await this.acceptGeneration(request), origin!);
    }
    return this.cors(new Response("Not found", { status: 404 }), origin!);
  }

  private async createSession(request: Request, server: Bun.Server<StudioSocketData>): Promise<Response> {
    const now = Date.now();
    const sessionId = `sts_${Bun.randomUUIDv7().replaceAll("-", "")}`;
    const ipFingerprint = await this.fingerprintIp(this.clientIp(request, server));
    this.store.createSession(sessionId, ipFingerprint, now, now + this.config.sessionTtlMs);
    const token = await this.signSession(sessionId);
    const cookie = [
      `${STUDIO_SESSION_COOKIE}=${token}`,
      "Path=/api/studio",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${Math.floor(this.config.sessionTtlMs / 1_000)}`,
      ...(this.config.secureCookies ? ["Secure"] : []),
    ].join("; ");
    return new Response(null, { status: 204, headers: { ...securityHeaders(), "Set-Cookie": cookie } });
  }

  private async acceptGeneration(request: Request): Promise<Response> {
    const sessionId = await this.authenticate(request);
    if (sessionId === undefined) return new Response("Studio session required", { status: 401, headers: securityHeaders() });
    if ((this.sockets.get(sessionId)?.size ?? 0) === 0) return new Response("A ready WebSocket is required", { status: 409, headers: securityHeaders() });
    const requestId = request.headers.get(STUDIO_REQUEST_ID_HEADER);
    const idempotencyKey = request.headers.get(STUDIO_IDEMPOTENCY_HEADER);
    if (!isRequestId(requestId) || !isIdempotencyKey(idempotencyKey)) {
      return new Response("Studio correlation headers are invalid", { status: 400, headers: securityHeaders() });
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > STUDIO_LIMITS.sourceBytes + STUDIO_LIMITS.promptCharacters + 8_192) {
      return new Response("Payload too large", { status: 413, headers: securityHeaders() });
    }
    const text = await request.text();
    const inputHash = hashText(text);
    const now = Date.now();
    const begun = this.store.beginRequest({
      requestId,
      sessionId,
      idempotencyKey,
      inputHash,
      now,
      expiresAt: now + this.config.replayTtlMs,
    });
    if (begun.kind === "conflict") {
      this.sendEphemeral(sessionId, {
        protocol: STUDIO_PROTOCOL,
        type: "generation.failed",
        requestId,
        sequence: 0,
        emittedAt: new Date().toISOString(),
        data: { code: "STUDIO_IDEMPOTENCY_CONFLICT", message: "La clave de idempotencia ya pertenece a otra solicitud.", retryable: false },
      });
      return new Response(null, { status: 202, headers: securityHeaders() });
    }
    if (begun.kind === "replay") {
      this.sendEphemeral(sessionId, {
        protocol: STUDIO_PROTOCOL,
        type: "request.replayed",
        requestId,
        sequence: 0,
        emittedAt: new Date().toISOString(),
        data: { status: begun.status },
      });
      void this.replay(sessionId, requestId, 0);
      return new Response(null, { status: 202, headers: securityHeaders() });
    }
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(text); }
    catch { parsedJson = undefined; }
    const parsed = parseStudioGenerationRequest(parsedJson);
    if (!parsed.success || parsed.data.requestId !== requestId || parsed.data.idempotencyKey !== idempotencyKey) {
      void this.fail(sessionId, requestId, "STUDIO_INVALID_REQUEST", parsed.success ? "Los headers no coinciden con el payload." : parsed.message, false);
      return new Response(null, { status: 202, headers: securityHeaders() });
    }
    if (this.activeSessions.has(sessionId)) {
      void this.fail(sessionId, parsed.data.requestId, "STUDIO_PROVIDER_BUSY", "Esta sesión ya tiene una generación activa. Esperá el resultado o cancelala.", true);
      return new Response(null, { status: 202, headers: securityHeaders() });
    }
    this.activeSessions.set(sessionId, parsed.data.requestId);
    void this.generate(sessionId, parsed.data);
    return new Response(null, { status: 202, headers: securityHeaders() });
  }

  private async generate(sessionId: string, request: StudioGenerationRequest): Promise<void> {
    try {
      await this.runGeneration(sessionId, request);
    } finally {
      this.controllers.delete(request.requestId);
      this.cancelled.delete(request.requestId);
      if (this.activeSessions.get(sessionId) === request.requestId) this.activeSessions.delete(sessionId);
    }
  }

  private async runGeneration(sessionId: string, request: StudioGenerationRequest): Promise<void> {
    const session = this.store.getSession(sessionId, Date.now());
    if (session === undefined) {
      await this.fail(sessionId, request.requestId, "STUDIO_SESSION_EXPIRED", "La sesión venció. Conservamos tus versiones locales para que puedas continuar.", true);
      return;
    }
    await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "request.accepted", data: { format: request.format } });
    await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.stage", data: { stage: "request-accepted", message: "Solicitud aceptada y correlacionada." } });
    const controller = new AbortController();
    this.controllers.set(request.requestId, controller);
    if (this.cancelled.has(request.requestId)) controller.abort();
    if (controller.signal.aborted) {
      await this.fail(sessionId, request.requestId, "STUDIO_CANCELLED", "Generación cancelada antes de llamar al proveedor.", true);
      return;
    }
    if (this.activeSessions.size > this.config.maxConcurrentGenerations) {
      await this.fail(sessionId, request.requestId, "STUDIO_PROVIDER_BUSY", "El Studio alcanzó su concurrencia segura. Reintentá en unos segundos.", true);
      return;
    }
    const reservation = this.store.reserveRateLimit({
      requestId: request.requestId,
      sessionId,
      ipFingerprint: session.ip_fingerprint,
      now: Date.now(),
      limit: STUDIO_LIMITS.requestsPerMinute,
      windowMs: STUDIO_LIMITS.windowMs,
      dailyLimit: this.config.dailyLlmCallLimit,
    });
    if (!reservation.allowed) {
      const message = reservation.reason === "daily"
        ? "El presupuesto diario del Studio se agotó. Volvé a intentarlo mañana."
        : "Llegaste a 10 generaciones en 60 segundos.";
      await this.emit(sessionId, request.requestId, {
        protocol: STUDIO_PROTOCOL,
        type: "generation.rate_limited",
        data: { retryAfterMs: reservation.quota.retryAfterMs, quota: reservation.quota },
      });
      await this.fail(sessionId, request.requestId, "STUDIO_RATE_LIMITED", message, true);
      return;
    }
    await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "quota.updated", data: { quota: reservation.quota } });
    await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.stage", data: { stage: "quota-reserved", message: "Cuota reservada: esta llamada cuenta dentro de 10 por minuto." } });
    if (controller.signal.aborted) {
      this.store.releaseRateLimit(request.requestId);
      await this.fail(sessionId, request.requestId, "STUDIO_CANCELLED", "Generación cancelada antes de llamar al proveedor.", true);
      return;
    }
    let thinkingAnnounced = false;
    let answeringAnnounced = false;
    let usage: StudioUsage | undefined;
    try {
      await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.stage", data: { stage: "provider-connecting", message: "Conectando con DeepSeek V4 Flash." } });
      if (controller.signal.aborted) {
        this.store.releaseRateLimit(request.requestId);
        await this.fail(sessionId, request.requestId, "STUDIO_CANCELLED", "Generación cancelada antes de llamar al proveedor.", true);
        return;
      }
      const response = await this.provider.generateStream<ProviderStudioOutput>({
        model: this.config.providerModel,
        userId: `studio_${(await hmacHex(this.config.sessionKey, sessionId)).slice(0, 48)}`,
        messages: studioMessages(request),
        outputSchema: STUDIO_OUTPUT_SCHEMA,
        outputExample: STUDIO_OUTPUT_EXAMPLE as unknown as JsonValue,
        allowStructuredOutputFallback: false,
        thinking: true,
        reasoningEffort: "high",
        maxOutputTokens: this.config.maxOutputTokens,
        signal: controller.signal,
      }, async (event) => {
        if (event.type === "reasoning-delta" && !thinkingAnnounced) {
          thinkingAnnounced = true;
          await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.stage", data: { stage: "provider-thinking", message: "DeepSeek está diseñando el contrato. El razonamiento interno permanece privado." } });
        }
        if (event.type === "content-delta" && !answeringAnnounced) {
          answeringAnnounced = true;
          await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.stage", data: { stage: "provider-answering", message: "DeepSeek está construyendo la fuente estructurada." } });
        }
        if (event.type === "usage") usage = event.usage;
      });
      await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.stage", data: { stage: "marcus-validating", message: "Marcus valida la fuente sin ejecutarla." } });
      const output = await validateStudioOutput(response.output, request.format);
      await this.emit(sessionId, request.requestId, { protocol: STUDIO_PROTOCOL, type: "generation.validation", data: { diagnostics: output.diagnostics, valid: output.valid } });
      await this.emit(sessionId, request.requestId, {
        protocol: STUDIO_PROTOCOL,
        type: "generation.completed",
        data: { output, ...(usage === undefined ? {} : { usage }) },
      });
      this.store.markRequest(request.requestId, "completed");
      this.logger.info("studio.generation.completed", {
        requestId: request.requestId,
        format: request.format,
        valid: output.valid,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      });
    } catch (error) {
      const mapped = this.mapError(error, request.requestId);
      await this.fail(sessionId, request.requestId, mapped.code, mapped.message, mapped.retryable);
      this.logger.warn("studio.generation.failed", { requestId: request.requestId, code: mapped.code, errorName: error instanceof Error ? error.name : "unknown" });
    }
  }

  private async openSocket(socket: StudioSocket): Promise<void> {
    const group = this.sockets.get(socket.data.sessionId) ?? new Set<StudioSocket>();
    group.add(socket);
    this.sockets.set(socket.data.sessionId, group);
    const session = this.store.getSession(socket.data.sessionId, Date.now());
    if (session === undefined) {
      socket.close(4001, "Session expired");
      return;
    }
    this.send(socket, {
      protocol: STUDIO_PROTOCOL,
      type: "session.ready",
      sequence: 0,
      emittedAt: new Date().toISOString(),
      data: {
        sessionExpiresAt: new Date(session.expires_at).toISOString(),
        quota: this.store.quota(session.session_id, session.ip_fingerprint, Date.now(), STUDIO_LIMITS.requestsPerMinute, STUDIO_LIMITS.windowMs),
        model: this.config.providerModel,
      },
    });
  }

  private async handleSocketMessage(socket: StudioSocket, raw: string | Buffer): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")); }
    catch { return; }
    const message = parseStudioClientMessage(value);
    if (message === undefined) return;
    if (message.type === "ping") {
      this.send(socket, { protocol: STUDIO_PROTOCOL, type: "pong", sequence: 0, emittedAt: new Date().toISOString(), data: { at: new Date().toISOString() } });
      return;
    }
    if (!this.store.requestBelongsToSession(message.requestId, socket.data.sessionId)) return;
    if (message.type === "resume") await this.replay(socket.data.sessionId, message.requestId, message.afterSequence);
    else this.cancel(message);
  }

  private cancel(message: Extract<StudioClientMessage, { type: "generation.cancel" }>): void {
    this.cancelled.add(message.requestId);
    this.controllers.get(message.requestId)?.abort();
  }

  private closeSocket(socket: StudioSocket): void {
    const group = this.sockets.get(socket.data.sessionId);
    group?.delete(socket);
    if (group?.size === 0) this.sockets.delete(socket.data.sessionId);
  }

  private async replay(sessionId: string, requestId: StudioRequestId, sequence: number): Promise<void> {
    if (!this.store.requestBelongsToSession(requestId, sessionId)) return;
    for (const event of await this.store.eventsAfter(requestId, sequence)) this.broadcast(sessionId, event);
  }

  private async emit(sessionId: string, requestId: StudioRequestId, event: PendingEvent): Promise<StudioServerEvent> {
    const stored = await this.store.appendEvent(requestId, event as Omit<StudioServerEvent, "sequence" | "emittedAt">);
    this.broadcast(sessionId, stored);
    return stored;
  }

  private async fail(
    sessionId: string,
    requestId: StudioRequestId,
    code: StudioErrorCode,
    message: string,
    retryable: boolean,
    mark = true,
  ): Promise<void> {
    await this.emit(sessionId, requestId, { protocol: STUDIO_PROTOCOL, type: "generation.failed", data: { code, message, retryable } });
    if (mark) this.store.markRequest(requestId, "failed");
  }

  private broadcast(sessionId: string, event: StudioServerEvent): void {
    for (const socket of this.sockets.get(sessionId) ?? []) this.send(socket, event);
  }

  private sendEphemeral(sessionId: string, event: StudioServerEvent): void {
    this.broadcast(sessionId, event);
  }

  private send(socket: StudioSocket, event: StudioServerEvent): void {
    if (!isStudioServerEvent(event)) return;
    socket.send(JSON.stringify(event));
  }

  private mapError(error: unknown, requestId: StudioRequestId): { code: StudioErrorCode; message: string; retryable: boolean } {
    if (this.cancelled.has(requestId)) return { code: "STUDIO_CANCELLED", message: "Generación cancelada. La llamada ya reservada conserva su consumo.", retryable: true };
    if (error instanceof DOMException && error.name === "AbortError") return { code: "STUDIO_PROVIDER_TIMEOUT", message: "DeepSeek no respondió dentro del tiempo seguro. Podés reintentar.", retryable: true };
    if (error instanceof MarcusError) {
      if (error.code === "PROVIDER_STRUCTURED_OUTPUT_INVALID" || error.code === "PROVIDER_STRUCTURED_OUTPUT_SCHEMA_INVALID") {
        return { code: "STUDIO_OUTPUT_INVALID", message: "DeepSeek no devolvió el contrato JSON completo. Reformulá el pedido o reintentá.", retryable: true };
      }
      if (error.code === "STUDIO_OUTPUT_INVALID") return { code: "STUDIO_OUTPUT_INVALID", message: error.message, retryable: false };
      if (error.code === "PROVIDER_HTTP_ERROR") return { code: "STUDIO_PROVIDER_FAILED", message: "DeepSeek rechazó temporalmente la generación. Reintentá más tarde.", retryable: true };
    }
    return { code: "STUDIO_PROVIDER_FAILED", message: "No pudimos completar la generación. Tu brief y versiones locales siguen disponibles.", retryable: true };
  }

  private originAllowed(origin: string | null): origin is string {
    if (origin === null) return false;
    try { return this.config.allowedOrigins.includes(new URL(origin).origin); }
    catch { return false; }
  }

  private cors(response: Response, origin: string): Response {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", `Content-Type, ${STUDIO_REQUEST_ID_HEADER}, ${STUDIO_IDEMPOTENCY_HEADER}`);
    headers.set("Access-Control-Max-Age", "600");
    headers.set("Vary", "Origin");
    for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  private async authenticate(request: Request): Promise<string | undefined> {
    const token = parseCookie(request.headers.get("cookie"), STUDIO_SESSION_COOKIE);
    if (token === undefined) return undefined;
    const separator = token.lastIndexOf(".");
    if (separator < 0) return undefined;
    const sessionId = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!await verifyHmac(this.config.sessionKey, sessionId, signature)) return undefined;
    return this.store.getSession(sessionId, Date.now())?.session_id;
  }

  private async signSession(sessionId: string): Promise<string> {
    return `${sessionId}.${await hmacBase64Url(this.config.sessionKey, sessionId)}`;
  }

  private clientIp(request: Request, server: Bun.Server<StudioSocketData>): string {
    if (this.config.trustProxy) {
      const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (forwarded !== undefined && forwarded.length > 0 && forwarded.length <= 64) return forwarded;
    }
    return server.requestIP(request)?.address ?? "unknown";
  }

  private fingerprintIp(ip: string): Promise<string> {
    return hmacHex(this.config.sessionKey, `ip:${ip}`);
  }
}

function securityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-site",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function parseCookie(header: string | null, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function isRequestId(value: string | null): value is StudioRequestId {
  return value !== null && /^streq_[a-zA-Z0-9_-]{12,96}$/u.test(value);
}

function isIdempotencyKey(value: string | null): value is string {
  return value !== null && value.length >= 16 && value.length <= 160 && /^[a-zA-Z0-9._~-]+$/u.test(value);
}

function hashText(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

async function hmacBase64Url(key: Uint8Array, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
  return Buffer.from(signature).toString("base64url");
}

async function hmacHex(key: Uint8Array, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value))).toString("hex");
}

async function verifyHmac(key: Uint8Array, value: string, signature: string): Promise<boolean> {
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", cryptoKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(value));
  } catch {
    return false;
  }
}
