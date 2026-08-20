import {
  Controller,
  Dependencies,
  Modules,
  RouteControllers,
  Server,
  WebSocketController,
  WebSocketControllers,
  type StaticRoutes,
  type WebSocketData,
} from "s42-core";
import { MarcusError, type AgentManifest, type JsonValue, type Principal } from "@marcus/contracts";
import { createMarcusFileLogger, type SafeLogger } from "@marcus/observability";
import { MnpClient, type MnpClientOptions } from "@marcus/protocol-client";
import type { MnpEvent } from "@marcus/protocol";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { securityHeaders } from "./http/security";
import { handleMarcusMcp } from "./mcp/server";
import { createBundledModuleControllers } from "./modules/bundled";

export type S42Request = {
  headers: Headers;
  realIp: string;
  query: Record<string, string>;
  body: Record<string, JsonValue>;
  url: string;
  method: string;
  params: Record<string, string>;
};

export interface ApiUpstreamClient {
  connect(): Promise<unknown>;
  request<T = JsonValue>(operation: string, payload: JsonValue, options?: { projectId?: string; idempotencyKey?: string; timeoutMs?: number }): Promise<T>;
  subscribe?(listener: (event: MnpEvent) => void): () => void;
  close(): void;
}

export interface MarcusApiConfig {
  port: number;
  logsDir?: string;
  allowedOrigins: readonly string[];
  upstream: MnpClientOptions;
  maxRequestBodyBytes?: number;
  syncWaitMs?: number;
  secureCookies?: boolean;
  sessionTtlMs?: number;
}

export const MARCUS_API_HOST = "127.0.0.1";
export const MARCUS_API_PORT = 5724;
export const MARCUS_API_SYNC_WAIT_MS = 30_000;
export const DEFAULT_BACKOFFICE_ORIGINS = ["http://127.0.0.1:6636", "http://localhost:6636"] as const;

const RUN_POLL_INTERVAL_MS = 100;
const RUN_POLL_AFTER_MS = 1_000;

type BrowserSession = { client: ApiUpstreamClient; csrf: string; createdAt: number; principal?: PublicSessionPrincipal };
type PublicSessionPrincipal = { id: string; username?: string; roles: string[] };
type SocketData = WebSocketData & { sessionId: string };
type SocketSubscription = {
  requestId: string;
  operation: RealtimeOperation;
  payload: JsonValue;
  projectId?: string;
  refreshing: boolean;
  refreshQueued: boolean;
};

const REALTIME_OPERATIONS = new Set([
  "agentActivities.get",
  "agents.generationProgress",
  "agents.get",
  "agents.list",
  "agents.versions",
  "approvals.list",
  "files.list",
  "files.stat",
  "logs.list",
  "processes.list",
  "projects.dashboard",
  "projects.list",
  "runs.attach",
  "runs.get",
  "runs.list",
  "schedules.list",
  "system.health",
  "system.logs",
  "system.overview",
] as const);
type RealtimeOperation = typeof REALTIME_OPERATIONS extends Set<infer Operation> ? Operation & string : never;

export class MarcusApi {
  private readonly server = new Server();
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly serviceClient: ApiUpstreamClient;
  private readonly clientFactory: (authentication: MnpClientOptions["authentication"]) => ApiUpstreamClient;
  private readonly socketSubscriptions = new Map<Bun.ServerWebSocket<SocketData>, Map<string, SocketSubscription>>();
  private readonly socketListeners = new Map<Bun.ServerWebSocket<SocketData>, () => void>();
  private modules?: Modules;
  private staticRoutes?: StaticRoutes;

  constructor(
    readonly config: MarcusApiConfig,
    clientFactory?: (authentication: MnpClientOptions["authentication"]) => ApiUpstreamClient,
    private readonly logger?: SafeLogger,
  ) {
    this.clientFactory = clientFactory ?? ((authentication) => new MnpClient({ ...config.upstream, authentication }));
    this.serviceClient = this.clientFactory(config.upstream.authentication);
  }

  async start(): Promise<void> {
    const routeControllers = await this.createRouteControllers();
    await this.server.start({
      hostname: MARCUS_API_HOST,
      port: this.config.port,
      idleTimeout: 30,
      maxRequestBodySize: this.config.maxRequestBodyBytes ?? 1024 * 1024,
      RouteControllers: routeControllers,
      StaticRoutes: this.staticRoutes,
      WebSocketControllers: this.createWebSocketControllers(),
      hooks: this.modules?.getHooks(),
      development: false,
      error: () => this.response({ ok: false, error: { code: "HTTP_INTERNAL_ERROR", message: "Internal Server Error", retryable: false } }, 500),
    });
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.socketListeners.values()) unsubscribe();
    this.socketListeners.clear();
    this.socketSubscriptions.clear();
    for (const session of this.sessions.values()) session.client.close();
    this.serviceClient.close();
    if (Dependencies.get<MarcusApi>("app") === this) Dependencies.remove("app");
    this.server.closeWebSockets();
    await this.server.stop(true);
    this.logger?.info("api.stopped", { host: MARCUS_API_HOST, port: this.config.port });
  }

  async createRouteControllers(): Promise<SecureRouteControllers> {
    Dependencies.remove("app");
    Dependencies.add("app", this);
    let controllers: Controller[];
    if (import.meta.dir.startsWith("/$bunfs/")) {
      controllers = createBundledModuleControllers();
    } else {
      const modules = new Modules(resolve(import.meta.dir, "modules"));
      await modules.load();
      this.modules = modules;
      controllers = [...modules.getControllers()];
    }
    this.staticRoutes = this.modules?.getStaticRoutes();
    return new SecureRouteControllers(controllers, this.config.allowedOrigins);
  }

  async dispatchHttp(request: S42Request, route: ApiRoute): Promise<Response> {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-request-id") ?? Bun.randomUUIDv7();
    try {
      let response: Response;
      if (route.operation === "health.live") {
        response = this.response({ ok: true, data: { status: "live" } });
      } else if (route.operation === "health.ready") {
        try {
          const data = await this.serviceClient.request("system.health", {});
          response = this.response({ ok: true, data });
        } catch (error) {
          response = this.errorResponse(error, 503);
        }
      } else if (route.operation === "auth.session") response = this.sessionStatus(request);
      else if (route.operation === "auth.login") response = await this.login(request);
      else if (route.operation === "auth.logout") response = this.logout(request);
      else response = await this.handle(request, route);
      this.logger?.info("http.request.completed", {
        requestId,
        method: request.method,
        path: requestLogPath(request.url),
        operation: route.operation,
        ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      this.notifyLocalLogsChanged();
      return response;
    } catch (error) {
      this.logger?.error("http.request.failed", {
        requestId,
        method: request.method,
        path: requestLogPath(request.url),
        operation: route.operation,
        ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
        durationMs: Math.round(performance.now() - startedAt),
        error,
      });
      this.notifyLocalLogsChanged();
      throw error;
    }
  }

  async dispatchMcp(request: S42Request): Promise<Response> {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-request-id") ?? Bun.randomUUIDv7();
    let client: ApiUpstreamClient | undefined;
    try {
      const authorization = request.headers.get("authorization");
      if (authorization?.startsWith("Bearer ") !== true) throw apiError("AUTH_REQUIRED", "Marcus MCP requires a global MCP bearer token");
      client = this.clientFactory({ method: "personal-access-token", token: authorization.slice(7) });
      const connected = await client.connect();
      if (!isMcpAdministratorSession(connected)) throw apiError("RBAC_FORBIDDEN", "The bearer token is not an active global MCP administrator token");
      const response = await handleMarcusMcp(request, client);
      this.logger?.info("mcp.request.completed", {
        requestId,
        method: request.method,
        path: requestLogPath(request.url),
        mcpMethod: typeof request.body.method === "string" ? request.body.method : "unknown",
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return response;
    } catch (error) {
      const value = error instanceof MarcusError ? error : apiError("MCP_INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
      const status = errorStatus(value.code);
      this.logger?.error("mcp.request.failed", {
        requestId,
        method: request.method,
        path: requestLogPath(request.url),
        status,
        durationMs: Math.round(performance.now() - startedAt),
        error: value,
      });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.body.id ?? null, error: { code: status === 401 ? -32_001 : status === 403 ? -32_003 : -32_603, message: value.message } }), {
        status,
        headers: {
          ...securityHeaders("application/json; charset=utf-8"),
          ...(status === 401 ? { "WWW-Authenticate": "Bearer realm=\"Marcus MCP\"" } : {}),
        },
      });
    } finally {
      client?.close();
    }
  }

  private async login(request: S42Request): Promise<Response> {
    const username = request.body.username;
    const password = request.body.password;
    if (typeof username !== "string" || typeof password !== "string") return this.errorResponse(apiError("AUTH_CREDENTIALS_REQUIRED", "Username and password are required"), 400);
    const client = this.clientFactory({ method: "username-password", username, password });
    try {
      const connected = await client.connect();
      const principal = publicSessionPrincipal(connected);
      const sessionId = `web_${Bun.randomUUIDv7().replaceAll("-", "")}`;
      const csrf = Bun.randomUUIDv7().replaceAll("-", "");
      this.sessions.set(sessionId, { client, csrf, createdAt: Date.now(), ...(principal === undefined ? {} : { principal }) });
      return this.response(
        { ok: true, data: { authenticated: true, csrf, ...(principal === undefined ? {} : { principal }) } },
        200,
        { "Set-Cookie": sessionCookie(sessionId, this.config.secureCookies ?? true, this.config.sessionTtlMs ?? 28_800_000) },
      );
    } catch (error) {
      client.close();
      return this.errorResponse(error, 401);
    }
  }

  private sessionStatus(request: S42Request): Response {
    const sessionId = cookie(request.headers, "marcus_session");
    if (sessionId === undefined) return this.response({ ok: true, data: { authenticated: false } });
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.response({ ok: true, data: { authenticated: false } });
    if (Date.now() - session.createdAt > (this.config.sessionTtlMs ?? 28_800_000)) {
      session.client.close();
      this.sessions.delete(sessionId);
      return this.response({ ok: true, data: { authenticated: false } });
    }
    return this.response({ ok: true, data: { authenticated: true, ...(session.principal === undefined ? {} : { principal: session.principal }) } });
  }

  private logout(request: S42Request): Response {
    const sessionId = cookie(request.headers, "marcus_session");
    if (sessionId !== undefined) {
      const session = this.sessions.get(sessionId);
      if (session !== undefined && request.headers.get("x-marcus-csrf") !== session.csrf) return this.errorResponse(apiError("CSRF_INVALID", "CSRF token is missing or invalid"), 403);
      session?.client.close();
      this.sessions.delete(sessionId);
    }
    return this.response({ ok: true, data: { authenticated: false } }, 200, {
      "Set-Cookie": `marcus_session=; HttpOnly; SameSite=Strict; Path=/; ${(this.config.secureCookies ?? true) ? "Secure; " : ""}Max-Age=0`,
    });
  }

  private async handle(request: S42Request, route: ApiRoute): Promise<Response> {
    try {
      if (route.public === true) {
        if (route.operation === "openapi") return this.openapi(request.query.projectId);
        if (route.operation === "docs") return this.docs();
      }
      if (route.operation === "agent.invoke") return this.invokeAgent(request, route);
      const auth = await this.authenticateControl(request);
      try {
        if (!isSafeMethod(request.method)) this.assertCsrf(request, auth.session);
        const data = await auth.client.request(route.operation, route.payload, {
          ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
          ...(request.headers.get("idempotency-key") === null ? {} : { idempotencyKey: request.headers.get("idempotency-key")! }),
          ...(route.timeoutMs === undefined ? {} : { timeoutMs: route.timeoutMs }),
        });
        if (route.binary === true) return binaryResponse(data, request.headers.get("range"), route.operation === "artifacts.read");
        return this.response({ ok: true, data, meta: { requestId: request.headers.get("x-request-id") ?? Bun.randomUUIDv7(), timestamp: new Date().toISOString() } }, route.status ?? 200);
      } finally {
        if (auth.transient) auth.client.close();
      }
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private async invokeAgent(request: S42Request, route: ApiRoute): Promise<Response> {
    const projectId = route.projectId!;
    const agent = String((route.payload as { agent: string }).agent);
    const contract = await this.serviceClient.request<AgentManifest>("agents.contract", { agent }, { projectId });
    if (contract.entrypoints.api?.enabled !== true) throw apiError("ENTRYPOINT_DISABLED", "Agent API entrypoint is disabled");
    const policy = contract.entrypoints.api.authentication;
    let client = this.serviceClient;
    let transient = false;
    let handle: { runId: string; state?: string; agentVersionId?: string; idempotentReplay?: boolean };
    const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
    try {
      if (policy.type === "marcus-token") {
        const auth = await this.authenticateControl(request);
        client = auth.client;
        transient = auth.transient;
        this.assertCsrf(request, auth.session);
        handle = await client.request("runs.invoke", { agent, input: request.body, entrypoint: "api", ...(typeof request.body.chatId === "string" ? { chatId: request.body.chatId } : {}) },
          { projectId, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
      } else {
        handle = await this.serviceClient.request("agents.invokeExternal", {
          agent,
          input: request.body,
          method: request.method,
          path: request.url,
          bodySha256: request.headers.get("x-marcus-internal-body-sha256") ?? sha256(""),
          headers: forwardedCredentialHeaders(request.headers),
          remoteAddress: request.realIp,
          ...(typeof request.body.chatId === "string" ? { chatId: request.body.chatId } : {}),
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        }, { projectId });
      }
      if (request.headers.get("prefer")?.includes("respond-async") || contract.entrypoints.api.response.mode === "async") {
        return this.runAcceptedResponse(projectId, handle);
      }
      const waitMs = Math.min(contract.entrypoints.api.response.waitMs ?? this.config.syncWaitMs ?? MARCUS_API_SYNC_WAIT_MS, MARCUS_API_SYNC_WAIT_MS);
      const deadline = Date.now() + waitMs;
      let latestState = handle.state ?? "queued";
      while (Date.now() < deadline) {
        const run = await client.request<{ state: string; output?: JsonValue; error?: JsonValue }>("runs.get", { runId: handle.runId }, { projectId });
        latestState = run.state;
        if (run.state === "completed") return this.response({ ok: true, data: run.output ?? null });
        if (["failed", "cancelled", "timed_out", "killed"].includes(run.state)) return this.response({ ok: false, error: run.error ?? { code: "RUN_FAILED", message: `Run ${run.state}`, retryable: false } }, 422);
        await Bun.sleep(RUN_POLL_INTERVAL_MS);
      }
      return this.runAcceptedResponse(projectId, handle, latestState);
    } finally {
      if (transient) client.close();
    }
  }

  private runAcceptedResponse(
    projectId: string,
    handle: { runId: string; state?: string; agentVersionId?: string; idempotentReplay?: boolean },
    state = handle.state ?? "queued",
  ): Response {
    const statusUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(handle.runId)}`;
    return this.response({
      ok: true,
      data: {
        ...handle,
        state,
        status: "processing",
        resultAvailable: false,
        statusUrl,
        pollAfterMs: RUN_POLL_AFTER_MS,
        message: "The Run was accepted and is still processing. Read statusUrl until state is completed or failed.",
      },
    }, 202, { Location: statusUrl, "Retry-After": String(RUN_POLL_AFTER_MS / 1_000) });
  }

  private async authenticateControl(request: S42Request): Promise<{ client: ApiUpstreamClient; session?: BrowserSession; transient: boolean }> {
    const sessionId = cookie(request.headers, "marcus_session");
    if (sessionId !== undefined) {
      const session = this.sessions.get(sessionId);
      if (session !== undefined && Date.now() - session.createdAt <= (this.config.sessionTtlMs ?? 28_800_000)) return { client: session.client, session, transient: false };
      session?.client.close();
      this.sessions.delete(sessionId);
    }
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer ") !== true) throw apiError("AUTH_REQUIRED", "Authentication is required");
    const token = authorization.slice(7);
    const client = this.clientFactory({ method: "personal-access-token", token });
    try {
      await client.connect();
    } catch (error) {
      client.close();
      throw error;
    }
    return { client, transient: true };
  }

  private assertCsrf(request: S42Request, session: BrowserSession | undefined): void {
    if (session === undefined) return;
    if (request.headers.get("x-marcus-csrf") !== session.csrf) throw apiError("CSRF_INVALID", "CSRF token is missing or invalid");
  }

  private async openapi(projectId: string | undefined): Promise<Response> {
    const paths: Record<string, unknown> = {
      "/health/live": { get: { operationId: "healthLive", responses: { "200": { description: "Live" } } } },
      "/api/v1/projects": { get: { operationId: "projectsList" }, post: { operationId: "projectsCreate" } },
    };
    if (projectId !== undefined) {
      try {
        const agents = await this.serviceClient.request<Array<{ slug: string }>>("agents.list", {}, { projectId });
        for (const agent of agents) {
          const manifest = await this.serviceClient.request<AgentManifest>("agents.contract", { agent: agent.slug }, { projectId });
          if (manifest.entrypoints.api?.enabled !== true) continue;
          paths[`/api/v1/projects/{project}/agents/${agent.slug}/invoke`] = {
            post: {
              operationId: `invoke_${agent.slug.replaceAll("-", "_")}`,
              requestBody: { content: { "application/json": { schema: manifest.contract.inputSchema } } },
              responses: { "200": { description: "Completed", content: { "application/json": { schema: manifest.contract.outputSchema } } }, "202": { description: "Accepted" } },
              "x-marcus-agent-version": manifest.build.sourceHash,
              ...(manifest.conversation === undefined ? {} : { "x-marcus-conversation": manifest.conversation }),
            },
          };
        }
      } catch {
        // Baseline OpenAPI remains usable while upstream metadata is unavailable.
      }
    }
    return this.response({ openapi: "3.1.0", info: { title: "Marcus API", version: "0.1.0" }, paths, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" }, cookieAuth: { type: "apiKey", in: "cookie", name: "marcus_session" } } } });
  }

  private docs(): Response {
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Marcus API</title></head><body><main><h1>Marcus API</h1><p><a href="/api/v1/openapi.json">OpenAPI 3.1</a></p></main></body></html>`, { headers: securityHeaders("text/html; charset=utf-8") });
  }

  private createWebSocketControllers(): WebSocketControllers {
    const controller = new WebSocketController<SocketData>({
      path: "/api/v1/ws",
      upgrade: ({ request }) => {
        if (!originAllowed(request, this.config.allowedOrigins)) return this.response({ ok: false, error: { code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed", retryable: false } }, 403);
        const sessionId = cookie(request.headers, "marcus_session");
        if (sessionId === undefined || !this.sessions.has(sessionId)) return this.response({ ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication is required", retryable: false } }, 401);
        return { data: { sessionId } };
      },
      message: (ws, message) => {
        void this.websocketMessage(ws, typeof message === "string" ? message : new TextDecoder().decode(message as Uint8Array));
      },
      close: (ws) => {
        this.socketListeners.get(ws)?.();
        this.socketListeners.delete(ws);
        this.socketSubscriptions.delete(ws);
      },
    });
    return new WebSocketControllers([controller], { maxPayloadLength: 64 * 1024, backpressureLimit: 1024 * 1024, closeOnBackpressureLimit: true });
  }

  private async websocketMessage(ws: Bun.ServerWebSocket<SocketData>, message: string): Promise<void> {
    try {
      const input = JSON.parse(message) as { type: string; requestId?: string; operation?: string; payload?: JsonValue; projectId?: string };
      if (input.type === "ping") { ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() })); return; }
      if (input.type === "unsubscribe") {
        if (input.requestId === undefined) throw apiError("WS_MESSAGE_INVALID", "unsubscribe requires requestId");
        this.socketSubscriptions.get(ws)?.delete(input.requestId);
        ws.send(JSON.stringify({ type: "unsubscribed", requestId: input.requestId }));
        return;
      }
      if (input.type !== "subscribe") throw apiError("WS_MESSAGE_INVALID", "Expected subscribe, unsubscribe, or ping; mutations and one-shot requests use HTTP");
      if (input.requestId === undefined) throw apiError("WS_MESSAGE_INVALID", "subscribe requires requestId");
      const session = this.sessions.get(ws.data.sessionId);
      if (session === undefined) throw apiError("SESSION_EXPIRED", "Session expired");
      if (input.operation === undefined || !REALTIME_OPERATIONS.has(input.operation as RealtimeOperation)) {
        throw apiError("WS_OPERATION_FORBIDDEN", `Operation ${input.operation ?? "undefined"} is not an allowed realtime read`);
      }
      const subscription: SocketSubscription = {
        requestId: input.requestId,
        operation: input.operation as RealtimeOperation,
        payload: input.payload ?? {},
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        refreshing: false,
        refreshQueued: false,
      };
      let subscriptions = this.socketSubscriptions.get(ws);
      if (subscriptions === undefined) {
        subscriptions = new Map();
        this.socketSubscriptions.set(ws, subscriptions);
      }
      subscriptions.set(subscription.requestId, subscription);
      if (!this.socketListeners.has(ws)) {
        if (session.client.subscribe === undefined) throw apiError("WS_REALTIME_UNAVAILABLE", "The upstream MNP client does not support EVENT frames");
        this.socketListeners.set(ws, session.client.subscribe((event) => this.handleUpstreamRealtime(ws, event)));
      }
      await this.refreshSocketSubscription(ws, subscription, "snapshot");
    } catch (error) {
      const value = error instanceof MarcusError ? error.toJSON() : { code: "WS_ERROR", message: error instanceof Error ? error.message : String(error), retryable: false };
      ws.send(JSON.stringify({ type: "error", error: value }));
    }
  }

  private handleUpstreamRealtime(ws: Bun.ServerWebSocket<SocketData>, event: MnpEvent): void {
    const projectId = realtimeProjectId(event);
    for (const subscription of this.socketSubscriptions.get(ws)?.values() ?? []) {
      if (!realtimeAffects(subscription, event, projectId)) continue;
      void this.refreshSocketSubscription(ws, subscription, "update");
    }
  }

  private notifyLocalLogsChanged(): void {
    if (this.logger === undefined) return;
    for (const [ws, subscriptions] of this.socketSubscriptions) {
      for (const subscription of subscriptions.values()) {
        if (subscription.operation === "system.logs") void this.refreshSocketSubscription(ws, subscription, "update");
      }
    }
  }

  private async refreshSocketSubscription(ws: Bun.ServerWebSocket<SocketData>, subscription: SocketSubscription, type: "snapshot" | "update"): Promise<void> {
    if (subscription.refreshing) {
      subscription.refreshQueued = true;
      return;
    }
    subscription.refreshing = true;
    try {
      const session = this.sessions.get(ws.data.sessionId);
      if (session === undefined) throw apiError("SESSION_EXPIRED", "Session expired");
      const data = await session.client.request(subscription.operation, subscription.payload, subscription.projectId === undefined ? {} : { projectId: subscription.projectId });
      ws.send(JSON.stringify({ type, requestId: subscription.requestId, data, eventAt: new Date().toISOString() }));
    } catch (error) {
      const value = error instanceof MarcusError ? error.toJSON() : { code: "WS_SUBSCRIPTION_FAILED", message: error instanceof Error ? error.message : String(error), retryable: true };
      ws.send(JSON.stringify({ type: "error", requestId: subscription.requestId, error: value }));
    } finally {
      subscription.refreshing = false;
      if (subscription.refreshQueued) {
        subscription.refreshQueued = false;
        void this.refreshSocketSubscription(ws, subscription, "update");
      }
    }
  }

  private response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...securityHeaders("application/json; charset=utf-8"), ...headers } });
  }

  private errorResponse(error: unknown, status?: number): Response {
    const value = error instanceof MarcusError ? error : apiError("HTTP_INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
    return this.response({ ok: false, error: value.toJSON() }, status ?? errorStatus(value.code));
  }
}

export class SecureRouteControllers extends RouteControllers {
  constructor(controllers: Controller[], private readonly allowedOrigins: readonly string[]) { super(controllers); }

  override getRoutes(hooks: Parameters<RouteControllers["getRoutes"]>[0]): ReturnType<RouteControllers["getRoutes"]> {
    const routes = super.getRoutes(hooks);
    for (const handlers of Object.values(routes)) {
      for (const [method, handler] of Object.entries(handlers)) {
        handlers[method] = async (request) => {
          const forbidden = forbiddenOrigin(request, this.allowedOrigins);
          if (forbidden !== undefined) return forbidden;
          const prepared = await prepareRequest(request);
          return secure(await handler(prepared), request, this.allowedOrigins);
        };
      }
    }
    return routes;
  }

  override getCallback(hooks: Parameters<RouteControllers["getCallback"]>[0]): ReturnType<RouteControllers["getCallback"]> {
    const callback = super.getCallback(hooks);
    return async (request) => {
      const forbidden = forbiddenOrigin(request, this.allowedOrigins);
      if (forbidden !== undefined) return forbidden;
      return secure(await callback(await prepareRequest(request)), request, this.allowedOrigins);
    };
  }
}

export type ApiRoute = { operation: string; payload: JsonValue; projectId?: string; status?: number; public?: boolean; binary?: boolean; timeoutMs?: number };

function secure(response: Response, request: Request, allowedOrigins: readonly string[]): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Credentials");
  const origin = request.headers.get("origin");
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Accept,Authorization,Content-Type,Idempotency-Key,MCP-Protocol-Version,MCP-Session-Id,Mcp-Method,Mcp-Name,X-Marcus-CSRF,X-Signature,X-Timestamp,X-Nonce");
  }
  for (const [key, value] of Object.entries(securityHeaders(headers.get("content-type") ?? undefined))) if (!headers.has(key)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function cookie(headers: Headers, name: string): string | undefined {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
async function prepareRequest(request: Request): Promise<Request> {
  const body = request.method === "GET" || request.method === "HEAD" ? new Uint8Array() : new Uint8Array(await request.clone().arrayBuffer());
  const headers = new Headers(request.headers);
  headers.set("x-marcus-internal-body-sha256", new Bun.CryptoHasher("sha256").update(body).digest("hex"));
  const prepared = new Request(request, { headers });
  const params = (request as Request & { params?: Record<string, string> }).params;
  if (params !== undefined) Object.defineProperty(prepared, "params", { value: params });
  return prepared;
}
function forbiddenOrigin(request: Request, allowedOrigins: readonly string[]): Response | undefined {
  if (originAllowed(request, allowedOrigins)) return undefined;
  return new Response(JSON.stringify({ ok: false, error: { code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed", retryable: false } }), {
    status: 403,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}
function originAllowed(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || allowedOrigins.includes(origin)) return true;
  try { return origin === new URL(request.url).origin; }
  catch { return false; }
}
function sha256(value: string): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
function sessionCookie(sessionId: string, secure: boolean, ttlMs: number): string {
  return `marcus_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; ${secure ? "Secure; " : ""}Max-Age=${Math.max(1, Math.floor(ttlMs / 1_000))}`;
}
function forwardedCredentialHeaders(headers: Headers): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [key, value] of headers) {
    const normalized = key.toLowerCase();
    if (["cookie", "x-marcus-csrf", "x-marcus-internal-body-sha256"].includes(normalized)) continue;
    if (normalized === "authorization" || normalized.startsWith("x-")) forwarded[normalized] = value;
  }
  return forwarded;
}
function binaryResponse(value: unknown, rangeHeader: string | null, attachment: boolean): Response {
  if (typeof value !== "object" || value === null || typeof (value as { data?: unknown }).data !== "string") throw apiError("BINARY_RESPONSE_INVALID", "Upstream binary response is invalid");
  const record = value as { data: string; mediaType?: string; name?: string; sha256?: string };
  const bytes = new Uint8Array(Buffer.from(record.data, "base64"));
  let start = 0;
  let end = Math.max(0, bytes.byteLength - 1);
  let status = 200;
  if (rangeHeader !== null) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/u);
    if (match === null || bytes.byteLength === 0) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
    if (match[1] === "") {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
      start = Math.max(0, bytes.byteLength - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? end : Number(match[2]);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
    end = Math.min(end, bytes.byteLength - 1);
    status = 206;
  }
  const body = bytes.slice(start, end + 1);
  const headers: Record<string, string> = {
    ...securityHeaders(record.mediaType ?? "application/octet-stream"),
    "Accept-Ranges": "bytes",
    "Content-Length": String(body.byteLength),
    ...(record.sha256 === undefined ? {} : { ETag: `"${record.sha256}"` }),
    ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}` } : {}),
    ...(attachment ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeDownloadName(record.name ?? "artifact.bin"))}` } : { "Cache-Control": "public, max-age=31536000, immutable" }),
  };
  return new Response(body, { status, headers });
}
function safeDownloadName(value: string): string { return value.replace(/[\r\n]/gu, "_").split(/[\\/]/u).at(-1) || "artifact.bin"; }
function isSafeMethod(method: string): boolean { return ["GET", "HEAD", "OPTIONS"].includes(method); }
function publicSessionPrincipal(value: unknown): PublicSessionPrincipal | undefined {
  if (typeof value !== "object" || value === null || !("principal" in value)) return undefined;
  const principal = (value as { principal?: Principal }).principal;
  if (principal === undefined || typeof principal.id !== "string") return undefined;
  const username = typeof principal.claims?.username === "string" ? principal.claims.username : undefined;
  const roles = typeof principal.claims?.systemRoles === "string"
    ? principal.claims.systemRoles.split(",").filter(Boolean)
    : [];
  return { id: principal.id, ...(username === undefined ? {} : { username }), roles };
}
function realtimeProjectId(event: MnpEvent): string | undefined {
  const payload = realtimeObject(event.payload);
  return typeof payload?.projectId === "string" ? payload.projectId : undefined;
}
function realtimeAffects(subscription: SocketSubscription, event: MnpEvent, projectId: string | undefined): boolean {
  if (subscription.projectId !== undefined && projectId !== subscription.projectId) return false;
  const eventPayload = realtimeObject(realtimeObject(event.payload)?.data);
  const requested = realtimeObject(subscription.payload);
  if (subscription.operation === "agentActivities.get") return eventPayload?.activityId === requested?.activityId;
  if (subscription.operation === "agents.generationProgress") return eventPayload?.progressId === requested?.progressId || eventPayload?.activityId === requested?.progressId;
  if (subscription.operation === "runs.get" || subscription.operation === "runs.attach") return eventPayload?.runId === requested?.runId;
  if (subscription.operation === "agents.get" || subscription.operation === "agents.versions") {
    return eventPayload?.agentId === requested?.agent || eventPayload?.agent === requested?.agent || event.topic.startsWith("agent.");
  }
  return true;
}
function realtimeObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function isMcpAdministratorSession(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const session = value as { principal?: Principal; permissions?: unknown };
  return session.principal?.claims?.tokenPurpose === "mcp-admin"
    && Array.isArray(session.permissions)
    && session.permissions.includes("*");
}
function apiError(code: string, message: string): MarcusError { return new MarcusError({ code, message, retryable: false }); }
function errorStatus(code: string): number {
  if (code === "AUTH_PASSWORD_POLICY" || code === "AUTH_USERNAME_INVALID") return 400;
  if (code === "AUTH_USERNAME_TAKEN" || code === "PROJECT_MEMBER_SHARED_IDENTITY") return 409;
  if (code.startsWith("AUTH_") || code === "SESSION_EXPIRED") return 401;
  if (code.startsWith("RBAC_") || code === "CSRF_INVALID" || code === "ORIGIN_FORBIDDEN") return 403;
  if (code.endsWith("NOT_FOUND") || code === "HTTP_ROUTE_NOT_FOUND") return 404;
  if (code.includes("RATE_LIMIT")) return 429;
  if (code.includes("CONFLICT") || code.includes("IDEMPOTENCY")) return 409;
  if (code.includes("INVALID") || code.includes("REQUIRED") || code.includes("DISABLED")) return 400;
  return 500;
}

export async function runMarcusApi(config: MarcusApiConfig): Promise<MarcusApi> {
  const logger = createMarcusFileLogger("marcus-api", { logsDir: config.logsDir });
  const api = new MarcusApi(config, undefined, logger);
  try {
    await api.start();
    logger.info("api.started", { host: MARCUS_API_HOST, port: config.port, upstreamHost: config.upstream.hostname, upstreamPort: config.upstream.port });
    return api;
  } catch (error) {
    logger.error("api.start.failed", { host: MARCUS_API_HOST, port: config.port, error });
    throw error;
  }
}

export interface MarcusApiLoadOptions {
  environment?: Record<string, string | undefined>;
  homeDirectory?: string;
  tokenWaitMs?: number;
}

type ApiFileConfig = Omit<Partial<MarcusApiConfig>, "upstream"> & {
  serviceTokenFile?: string;
  upstream?: Partial<Omit<MnpClientOptions, "authentication">> & { authentication?: MnpClientOptions["authentication"] };
};

export async function loadMarcusApiConfig(argv = process.argv.slice(2), options: MarcusApiLoadOptions = {}): Promise<MarcusApiConfig> {
  const environment = options.environment ?? process.env;
  const configPath = argumentValue(argv, "--config");
  const fileConfig = configPath === undefined ? {} : await Bun.file(resolve(configPath)).json() as ApiFileConfig;
  const defaultTokenFile = resolve(options.homeDirectory ?? homedir(), ".marcus", "api.token");
  const tokenFile = fileConfig.serviceTokenFile === undefined ? defaultTokenFile : resolve(fileConfig.serviceTokenFile);
  const embeddedToken = fileConfig.upstream?.authentication !== undefined && "token" in fileConfig.upstream.authentication
    ? fileConfig.upstream.authentication.token
    : undefined;
  let token = environment.MARCUS_API_SERVICE_TOKEN;
  if (token === undefined && fileConfig.serviceTokenFile !== undefined) {
    token = await readTokenFile(tokenFile, options.tokenWaitMs ?? 5_000);
  }
  token ??= embeddedToken;
  if (token === undefined && fileConfig.serviceTokenFile === undefined) {
    token = await readTokenFile(tokenFile, options.tokenWaitMs ?? 5_000);
  }
  if (token === undefined || token === "") throw new Error(`Marcus API service token not found at ${tokenFile}; start marcusd first or configure serviceTokenFile`);
  const { serviceTokenFile: _serviceTokenFile, upstream, ...apiConfig } = fileConfig;
  return {
    ...apiConfig,
    port: Number(environment.PORT ?? fileConfig.port ?? MARCUS_API_PORT),
    logsDir: fileConfig.logsDir ?? resolve(options.homeDirectory ?? homedir(), ".marcus", "logs"),
    allowedOrigins: environment.MARCUS_ALLOWED_ORIGINS === undefined ? (fileConfig.allowedOrigins ?? DEFAULT_BACKOFFICE_ORIGINS) : environment.MARCUS_ALLOWED_ORIGINS.split(",").filter(Boolean),
    upstream: {
      ...upstream,
      hostname: environment.MARCUSD_HOST ?? upstream?.hostname ?? "127.0.0.1",
      port: Number(environment.MARCUSD_PORT ?? upstream?.port ?? 4242),
      authentication: { method: "service-account-token", token },
    },
  };
}

if (import.meta.main) {
  await runMarcusApi(await loadMarcusApiConfig());
}

function argumentValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function requestLogPath(value: string): string {
  try { return new URL(value, "http://127.0.0.1").pathname; }
  catch { return value.split("?", 1)[0] ?? "/"; }
}

async function readTokenFile(path: string, waitMs: number): Promise<string | undefined> {
  const deadline = Date.now() + Math.max(0, waitMs);
  do {
    try { return (await Bun.file(path).text()).trim(); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      if (Date.now() >= deadline) return undefined;
      await Bun.sleep(100);
    }
  } while (true);
}
