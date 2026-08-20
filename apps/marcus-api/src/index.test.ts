import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { JsonValue } from "@marcus/contracts";
import { JsonLineFileLogSink, SafeLogger } from "@marcus/observability";
import type { MnpAuthentication } from "@marcus/protocol";
import type { MnpEvent } from "@marcus/protocol";
import { DEFAULT_BACKOFFICE_ORIGINS, loadMarcusApiConfig, MARCUS_API_HOST, MARCUS_API_PORT, MARCUS_API_SYNC_WAIT_MS, MarcusApi, SecureRouteControllers, type ApiUpstreamClient } from "./index";
import { createBundledModuleControllers } from "./modules/bundled";

class FakeClient implements ApiUpstreamClient {
  async connect() { return { principal: { id: "user_admin", type: "user", claims: { username: "admin", systemRoles: "system_admin" } } }; }
  close() {}
  async request<T>(operation: string): Promise<T> {
    if (operation === "system.health") return { status: "ok" } as T;
    if (operation === "projects.list") return [] as T;
    throw new Error(`unexpected ${operation}`);
  }
}

test("API has a fixed loopback listener", () => {
  expect(MARCUS_API_HOST).toBe("127.0.0.1");
  expect(MARCUS_API_PORT).toBe(5724);
});

test("browser WebSocket subscriptions are read-only and refresh only after upstream EVENT frames", async () => {
  class RealtimeClient implements ApiUpstreamClient {
    readonly listeners = new Set<(event: MnpEvent) => void>();
    healthRequests = 0;
    async connect() { return { principal: { id: "user_admin", type: "user", claims: { username: "admin", systemRoles: "system_admin" } } }; }
    close() {}
    subscribe(listener: (event: MnpEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    async request<T>(operation: string): Promise<T> {
      if (operation === "system.health") return { status: "ok", sequence: ++this.healthRequests } as T;
      throw new Error(`unexpected ${operation}`);
    }
    emit(event: MnpEvent) { for (const listener of this.listeners) listener(event); }
  }
  const clients: RealtimeClient[] = [];
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("Bun did not allocate a WebSocket test port");
  const origin = `http://127.0.0.1:${port}`;
  const api = new MarcusApi(
    { port, allowedOrigins: [origin], secureCookies: false, upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "service" } } },
    () => { const client = new RealtimeClient(); clients.push(client); return client; },
  );
  await api.start();
  try {
    const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "admin", password: "password" }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toStartWith("marcus_session=");
    const ws = new WebSocket(`${origin.replace("http", "ws")}/api/v1/ws`, { headers: { Cookie: cookie!, Origin: origin } });
    await new Promise<void>((resolveOpen, rejectOpen) => { ws.addEventListener("open", () => resolveOpen(), { once: true }); ws.addEventListener("error", () => rejectOpen(new Error("WebSocket did not open")), { once: true }); });
    try {
      const forbiddenPromise = nextWebSocketJson(ws);
      ws.send(JSON.stringify({ type: "request", requestId: "mutation", operation: "projects.create", payload: { slug: "forbidden" } }));
      expect(await forbiddenPromise).toMatchObject({ type: "error", error: { code: "WS_MESSAGE_INVALID" } });

      const snapshotPromise = nextWebSocketJson(ws);
      ws.send(JSON.stringify({ type: "subscribe", requestId: "health", operation: "system.health", payload: {} }));
      expect(await snapshotPromise).toMatchObject({ type: "snapshot", requestId: "health", data: { status: "ok", sequence: 1 } });
      const loginClient = clients.at(-1)!;
      await Bun.sleep(40);
      expect(loginClient.healthRequests).toBe(1);

      const updatePromise = nextWebSocketJson(ws);
      loginClient.emit({ subscriptionId: "realtime", topic: "run.completed", timestamp: new Date().toISOString(), payload: { data: { runId: "run_test" } } });
      expect(await updatePromise).toMatchObject({ type: "update", requestId: "health", data: { status: "ok", sequence: 2 } });
      expect(loginClient.healthRequests).toBe(2);
    } finally {
      ws.close();
    }
  } finally {
    await api.stop();
  }
});

function nextWebSocketJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => rejectMessage(new Error("Timed out waiting for WebSocket message")), 2_000);
    ws.addEventListener("message", (event) => { clearTimeout(timer); resolveMessage(JSON.parse(String(event.data)) as Record<string, unknown>); }, { once: true });
  });
}

test("API writes redacted request activity to the unified JSONL log", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-api-logs-"));
  try {
    const path = resolve(directory, "all.log");
    const sink = new JsonLineFileLogSink(path);
    const api = new MarcusApi(
      { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
      () => new FakeClient(),
      new SafeLogger({ source: "marcus-api", sink }),
    );
    const response = await (await api.createRouteControllers()).getCallback([])(new Request("http://localhost/health/live?token=must-not-be-logged"));
    expect(response.status).toBe(200);
    await sink.flush();
    const log = await Bun.file(path).text();
    expect(log).toContain('"message":"http.request.completed"');
    expect(log).not.toContain("must-not-be-logged");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("S42-Core modules expose explicit HTTP controllers with standalone parity", async () => {
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new FakeClient(),
  );
  const routes = (await api.createRouteControllers()).getRoutes([]);
  expect(routes["/api/v1/*"]).toBeUndefined();
  expect(routes["/api/v1/projects/:project/agents/:agent/invoke"]?.POST).toBeFunction();
  expect(routes["/api/v1/projects/:project/files/content"]?.GET).toBeFunction();
  expect(routes["/api/v1/projects/:project"]?.DELETE).toBeFunction();
  expect(routes["/api/v1/projects/:project/agents/generate"]?.POST).toBeFunction();
  expect(routes["/api/v1/projects/:project/agents/generations/:progressId"]?.GET).toBeFunction();
  expect(routes["/api/v1/projects/:project/members/users"]?.POST).toBeFunction();
  expect(routes["/api/v1/projects/:project/members/:user"]?.PUT).toBeFunction();
  expect(routes["/api/v1/projects/:project/dashboard"]?.GET).toBeFunction();
  expect(routes["/api/v1/projects/:project/tools"]?.GET).toBeFunction();
  expect(routes["/api/v1/projects/:project/tokens"]?.GET).toBeFunction();
  expect(routes["/api/v1/projects/:project/tokens"]?.POST).toBeFunction();
  expect(routes["/api/v1/projects/:project/tokens/:token"]?.DELETE).toBeFunction();
  expect(routes["/api/v1/projects/:project/agents/:agent/api-access"]?.PATCH).toBeFunction();
  expect(routes["/api/v1/projects/:project/agents/:agent/input-example"]?.POST).toBeFunction();
  expect(routes["/api/v1/projects/:project/agents/:agent/versions/:version/compiled"]?.GET).toBeFunction();
  expect(routes["/api/v1/users/me/password"]?.PATCH).toBeFunction();
  expect(routes["/api/v1/assistant/chat"]?.POST).toBeFunction();
  expect(routes["/api/v1/config/default-llm"]?.GET).toBeFunction();
  expect(routes["/api/v1/config/default-llm"]?.PUT).toBeFunction();
  expect(routes["/api/v1/providers/catalog"]?.GET).toBeFunction();
  expect(routes["/api/v1/system/overview"]?.GET).toBeFunction();
  expect(routes["/api/v1/system/logs"]?.GET).toBeFunction();
  expect(routes["/api/v1/system/search"]?.GET).toBeFunction();
  expect(routes["/api/v1/mcp/tokens"]?.GET).toBeFunction();
  expect(routes["/api/v1/mcp/tokens"]?.POST).toBeFunction();
  expect(routes["/api/v1/mcp/tokens/:token"]?.DELETE).toBeFunction();
  expect(routes["/api/v1/projects/:project/agents/plan"]?.POST).toBeFunction();
  expect(routes["/api/v1/documentation"]?.GET).toBeFunction();
  expect(routes["/api/v1/documentation/search"]?.GET).toBeFunction();
  expect(routes["/api/v1/documentation/:name"]?.GET).toBeFunction();
  expect(routes["/mcp"]?.POST).toBeFunction();
  expect(routes["/mcp"]?.GET).toBeFunction();
  expect(routes["/mcp"]?.DELETE).toBeFunction();
  const bundled = createBundledModuleControllers();
  expect(bundled).toHaveLength(126);
  expect(bundled.some((controller) => controller.getPath() === "/api/v1/*")).toBe(false);
});

test("Marcus MCP requires a dedicated global administrator token and exposes the development tool catalog", async () => {
  const calls: string[] = [];
  const projectTokenCalls: Array<{ operation: string; payload: JsonValue; projectId?: string }> = [];
  class McpClient implements ApiUpstreamClient {
    constructor(private readonly tokenPurpose?: string) {}
    async connect() {
      return {
        principal: {
          id: "user_admin",
          type: "user",
          claims: {
            username: "admin",
            systemRoles: "system_admin",
            ...(this.tokenPurpose === undefined ? {} : { tokenPurpose: this.tokenPurpose }),
          },
        },
        permissions: ["*"],
      };
    }
    close() {}
    async request<T>(operation: string, payload: JsonValue = {}, options?: { projectId?: string }): Promise<T> {
      calls.push(operation);
      if (operation.startsWith("projectTokens.")) {
        projectTokenCalls.push({ operation, payload, ...(options?.projectId === undefined ? {} : { projectId: options.projectId }) });
        if (operation === "projectTokens.list") return [{ tokenId: "tok_project", label: "Production", status: "active", scopes: ["runs.invoke", "runs.read"] }] as T;
        if (operation === "projectTokens.get") return { tokenId: "tok_project", label: "Production", status: "active", scopes: ["runs.invoke", "runs.read"] } as T;
        if (operation === "projectTokens.create") return { tokenId: "tok_created", token: "one-time-token", label: "Automation", scopes: ["runs.invoke", "runs.read"] } as T;
        if (operation === "projectTokens.update") return { tokenId: "tok_project", label: "Production rotated", status: "active", scopes: ["runs.invoke", "runs.read"] } as T;
        if (operation === "projectTokens.revoke") return { tokenId: "tok_project", revoked: true } as T;
      }
      if (operation === "system.health") return { status: "ok" } as T;
      if (operation === "projects.list") return [] as T;
      if (operation === "documentation.list") return [{ name: "SDK.md" }, { name: "MARKDOWN.md" }] as T;
      if (operation === "documentation.read") {
        const name = typeof payload === "object" && payload !== null && !Array.isArray(payload) && typeof payload.name === "string" ? payload.name : "UNKNOWN.md";
        return { name, content: `# ${name}\nOfficial Marcus documentation for ${name}.` } as T;
      }
      if (operation === "agents.plan") return { activityId: "activity_mcp", status: "accepted" } as T;
      if (operation === "agentActivities.get") return { activityId: "activity_mcp", status: "completed", result: { title: "Plan MCP", sourceKind: "markdown" } } as T;
      throw new Error(`unexpected ${operation}`);
    }
  }
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "service" } } },
    (authentication) => new McpClient(authentication.method === "personal-access-token" && authentication.token === "global-mcp" ? "mcp-admin" : undefined),
  );
  const callback = (await api.createRouteControllers()).getCallback([]);
  const request = (body: JsonValue, token = "global-mcp") => callback(new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify(body),
  }));

  const missing = await callback(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  expect(missing.status).toBe(401);
  expect(missing.headers.get("www-authenticate")).toContain("Bearer");

  const ordinary = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "ordinary-admin");
  expect(ordinary.status).toBe(403);

  const initialized = await request({
    jsonrpc: "2.0",
    id: 3,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "api-test", version: "1" } },
  });
  expect(initialized.status).toBe(200);
  expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "marcus" } } });

  const listed = await request({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
  expect(listed.status).toBe(200);
  const catalog = await listed.json() as { result: { tools: Array<{ name: string; annotations?: { destructiveHint?: boolean } }> } };
  expect(catalog.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
    "documentation_read",
    "documentation_bundle",
    "agents_plan",
    "agent_tools_list",
    "files_write",
    "agents_build",
    "runs_invoke",
    "system_logs",
    "project_tokens_list",
    "project_tokens_get",
    "project_tokens_create",
    "project_tokens_update",
    "project_tokens_delete",
  ]));
  expect(catalog.result.tools).toHaveLength(59);
  expect(catalog.result.tools.find((tool) => tool.name === "projects_delete")?.annotations?.destructiveHint).toBeTrue();
  expect(catalog.result.tools.find((tool) => tool.name === "project_tokens_delete")?.annotations?.destructiveHint).toBeTrue();

  const tokenToolCalls = [
    { id: 8, name: "project_tokens_list", arguments: { projectId: "prj_mcp" } },
    { id: 9, name: "project_tokens_get", arguments: { projectId: "prj_mcp", tokenId: "tok_project" } },
    { id: 10, name: "project_tokens_create", arguments: { projectId: "prj_mcp", label: "Automation" } },
    { id: 11, name: "project_tokens_update", arguments: { projectId: "prj_mcp", tokenId: "tok_project", label: "Production rotated", expiresAt: null } },
    { id: 12, name: "project_tokens_delete", arguments: { projectId: "prj_mcp", tokenId: "tok_project" } },
  ] as const;
  for (const tool of tokenToolCalls) {
    const response = await request({ jsonrpc: "2.0", id: tool.id, method: "tools/call", params: { name: tool.name, arguments: tool.arguments } });
    expect(response.status).toBe(200);
  }
  expect(projectTokenCalls).toEqual([
    { operation: "projectTokens.list", payload: {}, projectId: "prj_mcp" },
    { operation: "projectTokens.get", payload: { tokenId: "tok_project" }, projectId: "prj_mcp" },
    { operation: "projectTokens.create", payload: { label: "Automation" }, projectId: "prj_mcp" },
    { operation: "projectTokens.update", payload: { tokenId: "tok_project", label: "Production rotated", expiresAt: null }, projectId: "prj_mcp" },
    { operation: "projectTokens.revoke", payload: { tokenId: "tok_project" }, projectId: "prj_mcp" },
  ]);

  const health = await request({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "system_health", arguments: {} } });
  expect(health.status).toBe(200);
  const healthPayload = await health.json() as { result: { content: Array<{ text: string }> } };
  expect(JSON.parse(healthPayload.result.content[0]!.text)).toEqual({ status: "ok" });
  expect(calls).toContain("system.health");

  const documentation = await request({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "documentation_bundle", arguments: { bundle: "sdk" } } });
  expect(documentation.status).toBe(200);
  const documentationPayload = await documentation.json() as { result: { content: Array<{ text: string }> } };
  expect(documentationPayload.result.content.map((entry) => entry.text)).toEqual(expect.arrayContaining([
    expect.stringContaining('<document name="SDK.md">'),
    expect.stringContaining('<document name="TOOLS.md">'),
    expect.stringContaining('<document name="RUNTIME.md">'),
    expect.stringContaining('<document name="SECURITY.md">'),
    expect.stringContaining('<document name="DEVELOPMENT.md">'),
  ]));
  expect(calls.filter((operation) => operation === "documentation.read")).toHaveLength(5);

  const plan = await request({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "agents_plan", arguments: { projectId: "prj_mcp", prompt: "Planificá un agente de soporte", sourceKind: "markdown" } } });
  expect(plan.status).toBe(200);
  const planPayload = await plan.json() as { result: { content: Array<{ text: string }> } };
  expect(JSON.parse(planPayload.result.content[0]!.text)).toEqual({ title: "Plan MCP", sourceKind: "markdown" });
  expect(calls).toEqual(expect.arrayContaining(["agents.plan", "agentActivities.get"]));
});

test("native Bun routes preserve dynamic parameters through request preparation", async () => {
  const calls: Array<{ operation: string; payload: JsonValue; projectId?: string }> = [];
  class ProjectClient implements ApiUpstreamClient {
    async connect() {}
    close() {}
    async request<T>(operation: string, payload: JsonValue, options?: { projectId?: string }): Promise<T> {
      calls.push({ operation, payload, ...(options?.projectId === undefined ? {} : { projectId: options.projectId }) });
      return [] as T;
    }
  }
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new ProjectClient(),
  );
  const routes = (await api.createRouteControllers()).getRoutes([]);
  const request = new Request("http://localhost/api/v1/projects/prj_native/files", {
    headers: { Authorization: "Bearer test" },
  });
  Object.defineProperty(request, "params", { value: { project: "prj_native" } });

  const response = await routes["/api/v1/projects/:project/files"]!.GET!(request);

  expect(response.status).toBe(200);
  expect(calls).toContainEqual({ operation: "files.list", payload: { path: "project:/" }, projectId: "prj_native" });

  const deleteRequest = new Request("http://localhost/api/v1/projects/prj_native", {
    method: "DELETE",
    headers: { Authorization: "Bearer test" },
  });
  Object.defineProperty(deleteRequest, "params", { value: { project: "prj_native" } });
  const deleted = await routes["/api/v1/projects/:project"]!.DELETE!(deleteRequest);
  expect(deleted.status).toBe(200);
  expect(calls).toContainEqual({ operation: "projects.delete", payload: {}, projectId: "prj_native" });

  const inputExampleRequest = new Request("http://localhost/api/v1/projects/prj_native/agents/support-summary/input-example", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  });
  Object.defineProperty(inputExampleRequest, "params", { value: { project: "prj_native", agent: "support-summary" } });
  const inputExample = await routes["/api/v1/projects/:project/agents/:agent/input-example"]!.POST!(inputExampleRequest);
  expect(inputExample.status).toBe(200);
  expect(calls).toContainEqual({ operation: "agents.generateInputExample", payload: { agent: "support-summary" }, projectId: "prj_native" });

  const compiledRequest = new Request("http://localhost/api/v1/projects/prj_native/agents/support-summary/versions/av_native/compiled", {
    headers: { Authorization: "Bearer test" },
  });
  Object.defineProperty(compiledRequest, "params", { value: { project: "prj_native", agent: "support-summary", version: "av_native" } });
  const compiled = await routes["/api/v1/projects/:project/agents/:agent/versions/:version/compiled"]!.GET!(compiledRequest);
  expect(compiled.status).toBe(200);
  expect(calls).toContainEqual({ operation: "agents.compiled", payload: { agent: "support-summary", agentVersionId: "av_native" }, projectId: "prj_native" });

  const configurationRequest = new Request("http://localhost/api/v1/config/default-llm", {
    method: "PUT",
    headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-5" }),
  });
  const configured = await routes["/api/v1/config/default-llm"]!.PUT!(configurationRequest);
  expect(configured.status).toBe(200);
  expect(calls).toContainEqual({
    operation: "configuration.defaultLlm.set",
    payload: { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-5" },
  });

  const search = await routes["/api/v1/system/search"]!.GET!(new Request("http://localhost/api/v1/system/search?q=Browser+Runner&limit=25", {
    headers: { Authorization: "Bearer test" },
  }));
  expect(search.status).toBe(200);
  expect(calls).toContainEqual({ operation: "system.search", payload: { query: "Browser Runner", limit: 25 } });
});

test("browser session status is public and does not probe a protected resource", async () => {
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], secureCookies: false, upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new FakeClient(),
  );
  const callback = (await api.createRouteControllers()).getCallback([]);
  const anonymous = await callback(new Request("http://localhost/api/v1/auth/session"));
  expect(anonymous.status).toBe(200);
  expect(await anonymous.json()).toEqual({ ok: true, data: { authenticated: false } });

  const login = await callback(new Request("http://localhost/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "password" }),
  }));
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toStartWith("marcus_session=");
  const authenticated = await callback(new Request("http://localhost/api/v1/auth/session", {
    headers: { Cookie: cookie! },
  }));
  expect(await authenticated.json()).toEqual({ ok: true, data: { authenticated: true, principal: { id: "user_admin", username: "admin", roles: ["system_admin"] } } });
  await api.stop();
});

test("S42-Core routes replace wildcard credentialed CORS with the configured origin", async () => {
  const api = new MarcusApi(
    { port: 0, allowedOrigins: ["https://console.example"], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    (_authentication: MnpAuthentication) => new FakeClient(),
  );
  const routes: SecureRouteControllers = await api.createRouteControllers();
  const response = await routes.getCallback([])(new Request("http://localhost/health/live", { headers: { Origin: "https://console.example" } }));
  expect(response.headers.get("access-control-allow-origin")).toBe("https://console.example");
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

test("disallowed origins never receive an allow-origin header", async () => {
  const api = new MarcusApi(
    { port: 0, allowedOrigins: ["https://console.example"], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new FakeClient(),
  );
  const response = await (await api.createRouteControllers()).getCallback([])(new Request("http://localhost/health/live", { headers: { Origin: "https://evil.example" } }));
  expect(response.status).toBe(403);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
});

test("same-origin browser requests work without a manual origin allowlist", async () => {
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new FakeClient(),
  );
  const response = await (await api.createRouteControllers()).getCallback([])(new Request("http://127.0.0.1:5724/health/live", {
    headers: { Origin: "http://127.0.0.1:5724" },
  }));
  expect(response.status).toBe(200);
});

test("runtime defaults discover the managed token", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "marcus-api-defaults-"));
  const home = resolve(root, "home");
  const configPath = resolve(root, "marcus-api.json");
  try {
    await mkdir(resolve(home, ".marcus"), { recursive: true });
    await Bun.write(resolve(home, ".marcus/api.token"), "managed-api-token");
    await Bun.write(configPath, JSON.stringify({}));

    const config = await loadMarcusApiConfig(["--config", configPath], {
      environment: {},
      homeDirectory: home,
      tokenWaitMs: 0,
    });
    expect(config.port).toBe(5724);
    expect(config.allowedOrigins).toEqual(DEFAULT_BACKOFFICE_ORIGINS);
    expect(config.logsDir).toBe(resolve(home, ".marcus", "logs"));
    expect(config.upstream).toMatchObject({
      hostname: "127.0.0.1",
      port: 4242,
      authentication: { method: "service-account-token", token: "managed-api-token" },
    });

    const overridden = await loadMarcusApiConfig(["--config", configPath], {
      environment: { PORT: "6724" },
      homeDirectory: home,
      tokenWaitMs: 0,
    });
    expect(overridden.port).toBe(6724);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit API credentials retain priority over the managed default", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "marcus-api-token-priority-"));
  const home = resolve(root, "home");
  const configuredTokenFile = resolve(root, "configured.token");
  const embeddedConfigPath = resolve(root, "embedded.json");
  const fileConfigPath = resolve(root, "file.json");
  try {
    await mkdir(resolve(home, ".marcus"), { recursive: true });
    await Bun.write(resolve(home, ".marcus/api.token"), "managed-api-token");
    await Bun.write(configuredTokenFile, "configured-file-token");
    await Bun.write(embeddedConfigPath, JSON.stringify({
      upstream: { authentication: { method: "service-account-token", token: "embedded-token" } },
    }));
    await Bun.write(fileConfigPath, JSON.stringify({
      serviceTokenFile: configuredTokenFile,
      upstream: { authentication: { method: "service-account-token", token: "embedded-token" } },
    }));

    const embedded = await loadMarcusApiConfig(["--config", embeddedConfigPath], {
      environment: {}, homeDirectory: home, tokenWaitMs: 0,
    });
    expect(embedded.upstream.authentication).toEqual({ method: "service-account-token", token: "embedded-token" });

    const configuredFile = await loadMarcusApiConfig(["--config", fileConfigPath], {
      environment: {}, homeDirectory: home, tokenWaitMs: 0,
    });
    expect(configuredFile.upstream.authentication).toEqual({ method: "service-account-token", token: "configured-file-token" });

    const environment = await loadMarcusApiConfig(["--config", fileConfigPath], {
      environment: { MARCUS_API_SERVICE_TOKEN: "environment-token" }, homeDirectory: home, tokenWaitMs: 0,
    });
    expect(environment.upstream.authentication).toEqual({ method: "service-account-token", token: "environment-token" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("anonymous agent routes reach daemon-side authentication without a Marcus session", async () => {
  const operations: string[] = [];
  class PublicClient implements ApiUpstreamClient {
    async connect() {}
    close() {}
    async request<T>(operation: string): Promise<T> {
      operations.push(operation);
      if (operation === "agents.contract") return {
        entrypoints: { api: { enabled: true, response: { mode: "sync", waitMs: 50 }, authentication: { type: "none", public: true } } },
        contract: { inputSchema: { type: "object" }, outputSchema: { type: "object" } },
        build: { sourceHash: "test" },
      } as T;
      if (operation === "agents.invokeExternal") return { runId: "run_public" } as T;
      if (operation === "runs.get") return { state: "completed", output: { answer: "ok" } } as T;
      throw new Error(`unexpected ${operation}`);
    }
  }
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new PublicClient(),
  );
  const response = await (await api.createRouteControllers()).getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/agents/public-agent/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "hello" }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, data: { answer: "ok" } });
  expect(operations).toContain("agents.invokeExternal");
});

test("pending agent invocations expose an actionable project-scoped status contract", async () => {
  class PendingClient implements ApiUpstreamClient {
    async connect() {}
    close() {}
    async request<T>(operation: string): Promise<T> {
      if (operation === "agents.contract") return {
        entrypoints: { api: { enabled: true, response: { mode: "async" }, authentication: { type: "none", public: true } } },
        contract: { inputSchema: { type: "object" }, outputSchema: { type: "object" } },
        build: { sourceHash: "test" },
      } as T;
      if (operation === "agents.invokeExternal") return {
        runId: "run_pending",
        state: "queued",
        agentVersionId: "av_pending",
        idempotentReplay: false,
      } as T;
      throw new Error(`unexpected ${operation}`);
    }
  }
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "test" } } },
    () => new PendingClient(),
  );
  const response = await (await api.createRouteControllers()).getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/agents/slow-agent/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "hello" }),
  }));

  expect(MARCUS_API_SYNC_WAIT_MS).toBe(30_000);
  expect(response.status).toBe(202);
  expect(response.headers.get("location")).toBe("/api/v1/projects/prj_test/runs/run_pending");
  expect(response.headers.get("retry-after")).toBe("1");
  expect(await response.json()).toEqual({
    ok: true,
    data: {
      runId: "run_pending",
      state: "queued",
      agentVersionId: "av_pending",
      idempotentReplay: false,
      status: "processing",
      resultAvailable: false,
      statusUrl: "/api/v1/projects/prj_test/runs/run_pending",
      pollAfterMs: 1_000,
      message: "The Run was accepted and is still processing. Read statusUrl until state is completed or failed.",
    },
  });
});

test("validator lifecycle routes preserve project scope and transient credentials", async () => {
  const calls: Array<{ operation: string; payload: JsonValue; projectId?: string }> = [];
  class ValidatorClient implements ApiUpstreamClient {
    async connect() {}
    close() {}
    async request<T>(operation: string, payload: JsonValue, options?: { projectId?: string }): Promise<T> {
      calls.push({ operation, payload, ...(options?.projectId === undefined ? {} : { projectId: options.projectId }) });
      return (operation === "authValidators.list" ? [] : { authenticated: true, principal: { id: "operator-test" } }) as T;
    }
  }
  const client = new ValidatorClient();
  const api = new MarcusApi(
    { port: 0, allowedOrigins: [], upstream: { hostname: "127.0.0.1", port: 1, authentication: { method: "service-account-token", token: "service" } } },
    () => client,
  );
  const routes = await api.createRouteControllers();
  const list = await routes.getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/validators", {
    headers: { Authorization: "Bearer operator" },
  }));
  expect(list.status).toBe(200);
  const build = await routes.getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/validators/builds", {
    method: "POST",
    headers: { Authorization: "Bearer operator", "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath: "project:/validators/project-token/index.ts", activate: true }),
  }));
  expect(build.status).toBe(201);
  await routes.getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/validators/project-token/versions", { headers: { Authorization: "Bearer operator" } }));
  await routes.getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/validators/project-token/activate", {
    method: "POST",
    headers: { Authorization: "Bearer operator", "Content-Type": "application/json" },
    body: JSON.stringify({ validatorVersionId: "valv_test" }),
  }));
  await routes.getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/validators/project-token/disable", {
    method: "POST",
    headers: { Authorization: "Bearer operator", "Content-Type": "application/json" },
    body: "{}",
  }));
  const tested = await routes.getCallback([])(new Request("http://localhost/api/v1/projects/prj_test/validators/project-token/test", {
    method: "POST",
    headers: { Authorization: "Bearer operator", "Content-Type": "application/json" },
    body: JSON.stringify({ credential: "transient-value" }),
  }));
  expect(tested.status).toBe(200);
  expect(calls).toContainEqual({ operation: "authValidators.list", payload: {}, projectId: "prj_test" });
  expect(calls).toContainEqual({ operation: "authValidators.createFromProjectSource", payload: { sourcePath: "project:/validators/project-token/index.ts", activate: true }, projectId: "prj_test" });
  expect(calls).toContainEqual({ operation: "authValidators.versions", payload: { validator: "project-token" }, projectId: "prj_test" });
  expect(calls).toContainEqual({ operation: "authValidators.activate", payload: { validator: "project-token", validatorVersionId: "valv_test" }, projectId: "prj_test" });
  expect(calls).toContainEqual({ operation: "authValidators.disable", payload: { validator: "project-token" }, projectId: "prj_test" });
  expect(calls).toContainEqual({ operation: "authValidators.test", payload: { validator: "project-token", credential: "transient-value" }, projectId: "prj_test" });
});
