import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { JsonValue } from "@marcus/contracts";
import type { MnpRequest } from "@marcus/protocol";
import { API_SERVICE_TOKEN_SCOPES, MarcusDaemon, defaultMarcusdConfig } from "./daemon";

type ActivityResult = {
  activityId: string;
  status: "running" | "completed" | "failed";
  result?: JsonValue;
  error?: { code: string; message: string };
};

async function waitForActivity(
  route: (operation: string, payload: JsonValue, projectId?: string) => Promise<JsonValue>,
  activityId: string,
  projectId?: string,
): Promise<ActivityResult> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const activity = await route("agentActivities.get", { activityId }, projectId) as ActivityResult;
    if (activity.status !== "running") return activity;
    await Bun.sleep(5);
  }
  throw new Error(`Activity ${activityId} did not complete`);
}

test("daemon creates stable protected service credentials and releases its authority lock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-service-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  config.bootstrap = { token: "test-bootstrap-token" };
  let daemon = await MarcusDaemon.start(config);
  let apiToken = "";
  try {
    const key = (await Bun.file(config.secrets.keyFile).text()).trim();
    expect(Buffer.from(key, "base64").byteLength).toBe(32);
    if (process.platform !== "win32") expect((await stat(config.secrets.keyFile)).mode & 0o777).toBe(0o600);

    const apiTokenFile = resolve(directory, "api.token");
    apiToken = (await Bun.file(apiTokenFile).text()).trim();
    expect(apiToken).toStartWith("marcus_");
    if (process.platform !== "win32") expect((await stat(apiTokenFile)).mode & 0o777).toBe(0o600);
    const authenticated = await daemon.authentication.authenticate({ method: "service-account-token", token: apiToken }, "daemon-test");
    expect(authenticated.principal.scopes).toEqual(API_SERVICE_TOKEN_SCOPES);
  } finally {
    await daemon.close();
  }
  expect(await Bun.file(resolve(directory, "marcusd.lock")).exists()).toBe(false);

  daemon = await MarcusDaemon.start(config);
  try {
    expect((await Bun.file(resolve(directory, "api.token")).text()).trim()).toBe(apiToken);
    daemon.database.raw.query("UPDATE access_tokens SET scopes_json = ? WHERE token_id = ?").run(JSON.stringify(["*"]), "tok_marcus_api");
  } finally {
    await daemon.close();
  }

  daemon = await MarcusDaemon.start(config);
  try {
    const repairedToken = (await Bun.file(resolve(directory, "api.token")).text()).trim();
    expect(repairedToken).not.toBe(apiToken);
    const authenticated = await daemon.authentication.authenticate({ method: "service-account-token", token: repairedToken }, "daemon-test-repaired");
    expect(authenticated.principal.scopes).toEqual(API_SERVICE_TOKEN_SCOPES);
  } finally {
    await daemon.close();
  }
  await rm(directory, { recursive: true, force: true });
});

test("Project deletion removes managed files and allows recreating the slug", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-delete-project-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  config.bootstrap = { token: "delete-bootstrap-token" };
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "delete-admin", password: "delete-test-passwordA!", roles: ["system_admin"] });
    const session = {
      sessionId: "session-delete",
      connectionId: "connection-delete",
      principal,
      authenticatedAt: new Date().toISOString(),
      client: { name: "test", version: "1", platform: process.platform },
    };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(),
      operation,
      protocolVersion: 1,
      ...(projectId === undefined ? {} : { projectId }),
      payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    const project = await route("projects.create", { slug: "delete-me", name: "Delete me" }) as { projectId: string };
    await route("files.write", { path: "project:/notes/value.md", content: "delete this" }, project.projectId);
    const home = daemon.repositories.getProjectHome(project.projectId)!;
    expect(await Bun.file(resolve(home.physicalPath, "notes/value.md")).exists()).toBeTrue();

    const deleted = await route("projects.delete", {}, project.projectId) as { deleted: boolean; homeDeleted: boolean };
    expect(deleted).toMatchObject({ deleted: true, homeDeleted: true });
    expect(daemon.repositories.getProject(project.projectId)).toBeUndefined();
    expect(await Bun.file(home.physicalPath).exists()).toBeFalse();
    expect(daemon.database.raw.query<{ value: number }, [string]>("SELECT COUNT(*) AS value FROM audit_events WHERE project_id IS NULL AND operation='projects.delete' AND resource_json LIKE ?")
      .get(`%${project.projectId}%`)?.value).toBe(1);
    expect(await route("projects.create", { slug: "delete-me", name: "Recreated" })).toMatchObject({ slug: "delete-me" });
  } finally {
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Project deletion preserves a linked external directory", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-delete-linked-"));
  const linkedHome = await mkdtemp(resolve(tmpdir(), "marcus-linked-project-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "linked-admin", password: "linked-test-passwordA!", roles: ["system_admin"] });
    const session = { sessionId: "session-linked", connectionId: "connection-linked", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    const project = await route("projects.create", { slug: "linked-delete", name: "Linked", mode: "linked", physicalPath: linkedHome }) as { projectId: string };
    await Bun.write(resolve(linkedHome, "owner-file.txt"), "must survive");

    expect(await route("projects.delete", {}, project.projectId)).toMatchObject({ deleted: true, projectHome: "linked", homeDeleted: false });
    expect(await Bun.file(resolve(linkedHome, "owner-file.txt")).text()).toBe("must survive");
  } finally {
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
    await rm(linkedHome, { recursive: true, force: true });
  }
});

test("administrators manage passwords and Project users with the shared password policy", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-user-management-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    await expect(daemon.authentication.createUser({ username: "weak-admin", password: "weak", roles: ["system_admin"] }))
      .rejects.toMatchObject({ code: "AUTH_PASSWORD_POLICY" });
    const principal = await daemon.authentication.createUser({ username: "users-admin", password: "InitialA!", roles: ["system_admin"] });
    const session = { sessionId: "session-users", connectionId: "connection-users", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    const project = await route("projects.create", { slug: "managed-users", name: "Managed Users" }) as { projectId: string };
    expect(await route("projectMembers.list", {}, project.projectId)).toEqual([]);

    await route("users.create", { username: "second-admin", password: "SecondA!", systemAdmin: true });
    expect(await route("users.list", {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ username: "second-admin", roles: ["system_admin"] }),
    ]));

    const member = await route("projectMembers.create", {
      username: "project-user",
      password: "ProjectA!",
      role: "project_viewer",
    }, project.projectId) as { userId: string };
    expect(await route("projectMembers.list", {}, project.projectId)).toEqual([
      expect.objectContaining({ userId: member.userId, username: "project-user", role: "project_viewer", status: "active", systemAdmin: false }),
    ]);

    await route("projectMembers.update", {
      user: member.userId,
      username: "project-operator",
      password: "UpdatedA!",
      role: "project_operator",
    }, project.projectId);
    await expect(daemon.authentication.authenticate({ method: "username-password", username: "project-user", password: "ProjectA!" }, "old-project-user"))
      .rejects.toMatchObject({ code: "AUTH_CREDENTIALS_INVALID" });
    const updatedAuthentication = await daemon.authentication.authenticate({ method: "username-password", username: "project-operator", password: "UpdatedA!" }, "updated-project-user");
    const memberSession = { ...session, sessionId: "session-member", connectionId: "connection-member", principal: updatedAuthentication.principal };
    const memberProjects = await daemon.router.route(memberSession, {
      requestId: Bun.randomUUIDv7(), operation: "projects.list", protocolVersion: 1, payload: {},
    }, "daemon-test") as Array<{ projectId: string }>;
    expect(memberProjects.map((item) => item.projectId)).toEqual([project.projectId]);

    await expect(route("users.password.change", { currentPassword: "wrong", password: "ChangedA!" }))
      .rejects.toMatchObject({ code: "AUTH_CURRENT_PASSWORD_INVALID" });
    await route("users.password.change", { currentPassword: "InitialA!", password: "ChangedA!" });
    await expect(daemon.authentication.authenticate({ method: "username-password", username: "users-admin", password: "InitialA!" }, "old-admin"))
      .rejects.toMatchObject({ code: "AUTH_CREDENTIALS_INVALID" });
    expect((await daemon.authentication.authenticate({ method: "username-password", username: "users-admin", password: "ChangedA!" }, "new-admin")).principal.id).toBe(principal.id);

    await route("projectMembers.remove", { user: member.userId }, project.projectId);
    expect(await route("projectMembers.list", {}, project.projectId)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: member.userId }),
    ]));
    const noProjects = await daemon.router.route(memberSession, {
      requestId: Bun.randomUUIDv7(), operation: "projects.list", protocolVersion: 1, payload: {},
    }, "daemon-test") as unknown[];
    expect(noProjects).toEqual([]);
  } finally {
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Markdown API access creates Project-scoped invocation tokens and dashboard metrics", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-project-api-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "api-admin", password: "ProjectApiA!", roles: ["system_admin"] });
    const session = { sessionId: "session-project-api", connectionId: "connection-project-api", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    const project = await route("projects.create", { slug: "project-api", name: "Project API" }) as { projectId: string };
    const otherProject = await route("projects.create", { slug: "other-project", name: "Other Project" }) as { projectId: string };
    const source = `---
schema: marcus.agent/v1
id: api-agent
name: API Agent
kind: prompt-task
cli-enabled: true
---
# Objective
Answer.
# System
Be concise.
# Prompt
Answer the input.
# Input
\`\`\`yaml schema
object:
  message:
    type: string
required: [message]
additional-properties: false
\`\`\`
# Output
\`\`\`yaml schema
object:
  text:
    type: string
required: [text]
additional-properties: false
\`\`\``;
    await route("files.write", { path: "project:/agents/api-agent.agent.md", content: source }, project.projectId);
    const builtAgent = await route("agents.createFromProjectSource", { sourcePath: "project:/agents/api-agent.agent.md", sourceKind: "markdown", activate: true }, project.projectId) as { agentVersionId: string };
    const compiled = await route("agents.compiled", { agent: "api-agent", agentVersionId: builtAgent.agentVersionId }, project.projectId) as {
      agentVersionId: string;
      manifest: { identity: { id: string } };
      generatedTypeScript: string;
      runtimeJavaScript: string;
    };
    expect(compiled.agentVersionId).toBe(builtAgent.agentVersionId);
    expect(compiled.manifest.identity.id).toBe("api-agent");
    expect(compiled.generatedTypeScript).toContain("const manifest=");
    expect(compiled.runtimeJavaScript).toContain("api-agent");
    await expect(route("projectTokens.create", { label: "Before API" }, project.projectId)).rejects.toMatchObject({ code: "PROJECT_API_UNAVAILABLE" });

    const changed = await route("agents.setApiAccess", { agent: "api-agent", enabled: true }, project.projectId) as { apiEnabled: boolean };
    expect(changed.apiEnabled).toBeTrue();
    expect(await route("agents.contract", { agent: "api-agent" }, project.projectId)).toMatchObject({ entrypoints: { api: { enabled: true, authentication: { type: "marcus-token" } } } });
    expect(await route("agents.generateInputExample", { agent: "api-agent" }, project.projectId)).toEqual({
      input: { message: "Necesito ayuda con mi cuenta." },
      source: "schema",
    });
    const stored = await route("files.read", { path: "project:/agents/api-agent.agent.md" }, project.projectId) as { data: string };
    expect(Buffer.from(stored.data, "base64").toString("utf8")).toContain("api-enabled: true");

    const created = await route("projectTokens.create", { label: "CRM production" }, project.projectId) as { tokenId: string; token: string };
    expect(created.token).toStartWith("marcus_");
    const tokenMetadata = await route("projectTokens.get", { tokenId: created.tokenId }, project.projectId) as Record<string, JsonValue>;
    expect(tokenMetadata).toMatchObject({
      tokenId: created.tokenId,
      label: "CRM production",
      status: "active",
      scopes: ["runs.invoke", "runs.read"],
    });
    expect(tokenMetadata).not.toHaveProperty("token");
    await expect(route("projectTokens.get", { tokenId: created.tokenId }, otherProject.projectId)).rejects.toMatchObject({ code: "TOKEN_NOT_FOUND" });
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    expect(await route("projectTokens.update", { tokenId: created.tokenId, label: "CRM rotated", expiresAt }, project.projectId)).toMatchObject({
      tokenId: created.tokenId,
      label: "CRM rotated",
      expiresAt,
      status: "active",
    });
    expect(await route("projectTokens.update", { tokenId: created.tokenId, expiresAt: null }, project.projectId)).not.toHaveProperty("expiresAt");
    expect(await route("projectTokens.list", {}, project.projectId)).toEqual([
      expect.objectContaining({ tokenId: created.tokenId, label: "CRM rotated", status: "active", scopes: ["runs.invoke", "runs.read"] }),
    ]);
    const tokenPrincipal = (await daemon.authentication.authenticate({ method: "personal-access-token", token: created.token }, "project-token")).principal;
    expect(tokenPrincipal.claims?.tokenProjectId).toBe(project.projectId);
    const tokenSession = { ...session, sessionId: "session-project-token", connectionId: "connection-project-token", principal: tokenPrincipal };
    const tokenRoute = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(tokenSession, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test-token");
    expect(await tokenRoute("runs.list", {}, project.projectId)).toEqual([]);
    await expect(tokenRoute("runs.list", {}, otherProject.projectId)).rejects.toMatchObject({ code: "RBAC_FORBIDDEN" });
    await expect(tokenRoute("projects.list", {})).rejects.toMatchObject({ code: "RBAC_FORBIDDEN" });

    expect(await route("projects.dashboard", {}, project.projectId)).toMatchObject({ files: 1, agents: 1, activeAgents: 1, apiAgents: 1, runs: 0 });
    await route("projectTokens.revoke", { tokenId: created.tokenId }, project.projectId);
    expect(await route("projectTokens.list", {}, project.projectId)).toEqual([expect.objectContaining({ status: "revoked" })]);
    expect(await route("projectTokens.get", { tokenId: created.tokenId }, project.projectId)).toMatchObject({ status: "revoked" });
    await expect(route("projectTokens.update", { tokenId: created.tokenId, label: "Cannot edit" }, project.projectId)).rejects.toMatchObject({ code: "TOKEN_REVOKED" });
  } finally {
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("global MCP administrator tokens expose control-plane discovery and revoke immediately", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-mcp-admin-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "mcp-admin", password: "McpAdmin!", roles: ["system_admin"] });
    const session = { sessionId: "session-mcp", connectionId: "connection-mcp", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");

    const project = await route("projects.create", { slug: "mcp-project", name: "MCP Project" }) as { projectId: string };
    await route("files.write", { path: "project:/agents/needle.ts", content: "export const MarcusNeedle = true;" }, project.projectId);
    expect(await route("system.overview", {})).toMatchObject({ totals: { projects: 1, files: 1, agents: 0 } });
    expect(await route("documentation.list", {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "SDK.md" }),
      expect.objectContaining({ name: "MARKDOWN.md" }),
      expect.objectContaining({ name: "RUNTIME.md" }),
      expect.objectContaining({ name: "SECURITY.md" }),
    ]));
    expect(await route("documentation.read", { name: "sdk" })).toMatchObject({ name: "SDK.md", content: expect.stringContaining("SDK") });
    expect(await route("documentation.read", { name: "markdown" })).toMatchObject({ name: "MARKDOWN.md", content: expect.stringContaining("Markdown agents") });
    expect(await route("system.search", { query: "marcusneedle" })).toMatchObject({
      results: expect.arrayContaining([expect.objectContaining({ kind: "file", projectId: project.projectId, path: "project:/agents/needle.ts" })]),
    });

    const created = await route("mcpTokens.create", { label: "Codex workstation" }) as { tokenId: string; token: string; scopes: string[] };
    expect(created.token).toStartWith("marcus_");
    expect(created.scopes).toEqual(["*"]);
    expect(await route("mcpTokens.list", {})).toEqual([
      expect.objectContaining({ tokenId: created.tokenId, label: "Codex workstation", status: "active", scopes: ["*"] }),
    ]);
    const authenticated = await daemon.authentication.authenticate({ method: "personal-access-token", token: created.token }, "mcp-test");
    expect(authenticated.permissions).toEqual(["*"]);
    expect(authenticated.principal.claims?.tokenPurpose).toBe("mcp-admin");

    await route("mcpTokens.revoke", { tokenId: created.tokenId });
    expect(await route("mcpTokens.list", {})).toEqual([expect.objectContaining({ status: "revoked" })]);
    await expect(daemon.authentication.authenticate({ method: "personal-access-token", token: created.token }, "mcp-test-revoked"))
      .rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  } finally {
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("configures and verifies the global default LLM while writing daemon logs", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-default-llm-"));
  let authorization = "";
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/v1/models": (request) => {
        authorization = request.headers.get("authorization") ?? "";
        if (authorization === "Bearer rejected-private-key") return new Response("unauthorized", { status: 401 });
        return Response.json({ data: [{ id: "test-model" }] });
      },
    },
  });
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "llm-admin", password: "llm-test-passwordA!", roles: ["system_admin"] });
    const session = { sessionId: "session-llm", connectionId: "connection-llm", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");

    expect(await route("configuration.defaultLlm.get", {})).toEqual({ configured: false });
    expect(await route("providers.catalog", {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "openai", name: "OpenAI" }),
      expect.objectContaining({ id: "deepseek", name: "DeepSeek", capabilities: expect.objectContaining({ thinking: true }) }),
    ]));
    const configured = await route("configuration.defaultLlm.set", {
      catalogId: "deepseek",
      provider: "deepseek",
      baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      apiKey: "provider-private-key",
      model: "test-model",
    });
    expect(configured).toMatchObject({ configured: true, role: { role: "agent.default", model: "test-model", configuration: { thinking: true, reasoningEffort: "high" } }, provider: { catalogId: "deepseek" }, probe: { healthy: true } });
    expect(await route("configuration.defaultLlm.get", {})).toMatchObject({ configured: true, provider: { name: "deepseek", status: "healthy", catalogId: "deepseek" } });
    expect(await daemon.secrets.resolve("providers.deepseek")).toBe("provider-private-key");
    expect(authorization).toBe("Bearer provider-private-key");

    await expect(route("configuration.defaultLlm.set", {
      catalogId: "deepseek",
      provider: "deepseek",
      baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      apiKey: "rejected-private-key",
      model: "broken-model",
    })).rejects.toMatchObject({ code: "PROVIDER_PROBE_FAILED" });
    expect(await route("configuration.defaultLlm.get", {})).toMatchObject({ configured: true, role: { model: "test-model" }, provider: { status: "healthy" } });
    expect(await daemon.secrets.resolve("providers.deepseek")).toBe("provider-private-key");

    await Bun.sleep(50);
    const log = await Bun.file(resolve(directory, "logs", "all.log")).text();
    expect(log).toContain('"source":"marcusd"');
    expect(log).toContain('"message":"command.mutation"');
    expect(log).not.toContain("provider-private-key");
  } finally {
    await daemon.close();
    provider.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Tool Runtime enforces AgentVersion allowlists, idempotency, audit and critical approval", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-tool-runtime-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "tool-admin", password: "ToolRuntimeA!", roles: ["system_admin"] });
    const session = { sessionId: "session-tools", connectionId: "connection-tools", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    const project = await route("projects.create", { slug: "tool-runtime", name: "Tool Runtime" }) as { projectId: string };
    const sdkPath = resolve(import.meta.dir, "../../sdk/src/index.ts");
    const sourcePath = "project:/agents/tool-operator/index.ts";
    const source = `import { defineAgent, defineTool, m, tools } from ${JSON.stringify(sdkPath)};

const delayedEcho = defineTool({
  id: "delayed-echo",
  description: "Returns one value after a cooperative delay.",
  input: m.object({ value: m.string(), delayMs: m.integer({ minimum: 0 }) }),
  output: m.object({ value: m.string() }),
  timeout: "500ms",
  cancellable: true,
  sideEffects: false,
  risk: "medium",
  idempotency: { strategy: "input-hash", scope: "run" },
  async execute(context, input) {
    await new Promise((resolveDelay, rejectDelay) => {
      const timer = setTimeout(resolveDelay, input.delayMs);
      context.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        rejectDelay(context.signal.reason);
      }, { once: true });
    });
    return { value: input.value };
  },
});

export default defineAgent({
  id: "tool-operator",
  name: "Tool Operator",
  input: m.object({ action: m.enum(["write", "delete", "custom", "timeout", "cancel", "blocked"]), path: m.string() }),
  output: m.object({
    revision: m.optional(m.integer()),
    replayRevision: m.optional(m.integer()),
    count: m.optional(m.integer()),
    deleted: m.optional(m.boolean()),
    custom: m.optional(m.string()),
  }),
  entrypoints: { cli: { enabled: true } },
  tools: [...tools.load(["marcus/files.write", "marcus/files.list", "marcus/files.delete"]), delayedEcho],
  async onRun(context, input) {
    if (input.action === "delete") {
      const deleted = await context.tools.call("marcus/files.delete", { path: input.path }, { idempotencyKey: "delete:" + input.path });
      return { deleted: deleted.deleted };
    }
    if (input.action === "custom" || input.action === "timeout" || input.action === "cancel") {
      const custom = await context.tools.call("delayed-echo", { value: input.path, delayMs: input.action === "timeout" ? 700 : input.action === "cancel" ? 400 : 1 });
      return { custom: custom.value };
    }
    if (input.action === "blocked") {
      await context.tools.call("marcus/runs.get", { runId: context.run.id });
      return {};
    }
    const call = { path: input.path, content: "one durable write", encoding: "utf8" };
    const first = await context.tools.call("marcus/files.write", call, { idempotencyKey: "write:" + input.path });
    const replay = await context.tools.call("marcus/files.write", call, { idempotencyKey: "write:" + input.path });
    const listed = await context.tools.call("marcus/files.list", { path: "project:/data" });
    return { revision: first.revision, replayRevision: replay.revision, count: listed.length };
  },
});`;
    await route("files.write", { path: sourcePath, content: source }, project.projectId);
    const built = await route("agents.createFromProjectSource", { sourcePath, sourceKind: "sdk", activate: true }, project.projectId) as { agentVersionId: string };

    const discovery = await route("tools.list", { agent: "tool-operator" }, project.projectId) as { agentVersionId: string; tools: Array<{ id: string; version: string; source: string; risk: string; inputSchema: JsonValue }> };
    expect(discovery.agentVersionId).toBe(built.agentVersionId);
    expect(discovery.tools.map((tool) => tool.id)).toEqual(["marcus/files.write", "marcus/files.list", "marcus/files.delete", "delayed-echo"]);
    expect(discovery.tools.find((tool) => tool.id === "marcus/files.delete")).toMatchObject({ version: "1.0.0", risk: "critical" });
    expect(discovery.tools.find((tool) => tool.id === "delayed-echo")).toMatchObject({ source: "agent", risk: "medium" });
    expect(discovery.tools.find((tool) => tool.id === "delayed-echo")?.version).toHaveLength(64);

    const waitForRun = async (runId: string, states: readonly string[]) => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const run = await route("runs.get", { runId }, project.projectId) as { state: string; output?: JsonValue; error?: JsonValue };
        if (states.includes(run.state)) return run;
        await Bun.sleep(10);
      }
      throw new Error(`Run ${runId} did not reach ${states.join(", ")}`);
    };

    const writeHandle = await route("runs.invoke", { agent: "tool-operator", input: { action: "write", path: "project:/data/value.txt" } }, project.projectId) as { runId: string };
    const written = await waitForRun(writeHandle.runId, ["completed", "failed"]);
    expect(written).toMatchObject({ state: "completed", output: { revision: 1, replayRevision: 1, count: 1 } });
    expect((await route("files.stat", { path: "project:/data/value.txt" }, project.projectId) as { revision: number }).revision).toBe(1);
    const writeCalls = daemon.database.raw.query<{ state: string; cached_from_call_id: string | null }, [string]>("SELECT state, cached_from_call_id FROM tool_calls WHERE run_id=? ORDER BY created_at, tool_call_id").all(writeHandle.runId);
    expect(writeCalls).toHaveLength(3);
    expect(writeCalls.filter((row) => row.cached_from_call_id !== null)).toHaveLength(1);
    expect(daemon.database.raw.query<{ value: number }, [string]>("SELECT COUNT(*) AS value FROM audit_events WHERE operation='tools.call' AND resource_json LIKE ?").get(`%${writeHandle.runId}%`)?.value).toBe(3);

    const deleteHandle = await route("runs.invoke", { agent: "tool-operator", input: { action: "delete", path: "project:/data/value.txt" } }, project.projectId) as { runId: string };
    expect((await waitForRun(deleteHandle.runId, ["waiting_for_approval", "failed"])).state).toBe("waiting_for_approval");
    const approvals = await route("approvals.list", { status: "pending" }, project.projectId) as Array<{ approvalId: string; runId: string; action: string }>;
    const approval = approvals.find((candidate) => candidate.runId === deleteHandle.runId);
    expect(approval).toMatchObject({ action: "tool:marcus/files.delete" });
    await route("approvals.decide", { approvalId: approval!.approvalId, decision: "approve" }, project.projectId);
    expect(await waitForRun(deleteHandle.runId, ["completed", "failed"])).toMatchObject({ state: "completed", output: { deleted: true } });
    await expect(route("files.stat", { path: "project:/data/value.txt" }, project.projectId)).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(daemon.database.raw.query<{ approval_id: string | null; state: string }, [string]>("SELECT approval_id, state FROM tool_calls WHERE run_id=?").get(deleteHandle.runId))
      .toMatchObject({ approval_id: approval!.approvalId, state: "completed" });

    const customHandle = await route("runs.invoke", { agent: "tool-operator", input: { action: "custom", path: "custom-output" } }, project.projectId) as { runId: string };
    expect(await waitForRun(customHandle.runId, ["completed", "failed"])).toMatchObject({ state: "completed", output: { custom: "custom-output" } });
    expect(daemon.database.raw.query<{ state: string; tool_version: string }, [string]>("SELECT state, tool_version FROM tool_calls WHERE run_id=?").get(customHandle.runId))
      .toMatchObject({ state: "completed", tool_version: expect.stringMatching(/^[a-f0-9]{64}$/u) });

    const timeoutHandle = await route("runs.invoke", { agent: "tool-operator", input: { action: "timeout", path: "too-late" } }, project.projectId) as { runId: string };
    expect(await waitForRun(timeoutHandle.runId, ["completed", "failed"])).toMatchObject({ state: "failed", error: { code: "TOOL_TIMEOUT" } });
    expect(daemon.database.raw.query<{ state: string; error_json: string | null }, [string]>("SELECT state, error_json FROM tool_calls WHERE run_id=?").get(timeoutHandle.runId))
      .toMatchObject({ state: "failed", error_json: expect.stringContaining("TOOL_TIMEOUT") });

    const cancelHandle = await route("runs.invoke", { agent: "tool-operator", input: { action: "cancel", path: "cancel-me" } }, project.projectId) as { runId: string };
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const runningCall = daemon.database.raw.query<{ state: string }, [string]>("SELECT state FROM tool_calls WHERE run_id=?").get(cancelHandle.runId);
      if (runningCall?.state === "running") break;
      await Bun.sleep(2);
    }
    expect(daemon.database.raw.query<{ state: string }, [string]>("SELECT state FROM tool_calls WHERE run_id=?").get(cancelHandle.runId)?.state).toBe("running");
    await route("runs.cancel", { runId: cancelHandle.runId }, project.projectId);
    expect(await waitForRun(cancelHandle.runId, ["cancelled", "failed"])).toMatchObject({ state: "cancelled" });
    expect(daemon.database.raw.query<{ state: string; error_json: string | null }, [string]>("SELECT state, error_json FROM tool_calls WHERE run_id=?").get(cancelHandle.runId))
      .toMatchObject({ state: "failed", error_json: expect.stringContaining("TOOL_CANCELLED") });

    const blockedHandle = await route("runs.invoke", { agent: "tool-operator", input: { action: "blocked", path: "unused" } }, project.projectId) as { runId: string };
    expect(await waitForRun(blockedHandle.runId, ["completed", "failed"])).toMatchObject({ state: "failed", error: { code: "TOOL_NOT_ALLOWED" } });
    expect(daemon.database.raw.query<{ state: string; tool_id: string; error_json: string | null }, [string]>("SELECT state, tool_id, error_json FROM tool_calls WHERE run_id=?").get(blockedHandle.runId))
      .toMatchObject({ state: "failed", tool_id: "marcus/runs.get", error_json: expect.stringContaining("TOOL_NOT_ALLOWED") });
  } finally {
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Markdown generation canonicalizes marcus.agent/v1 and reports operational progress", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-agent-generation-"));
  const generatedSource = `---
schema: agent/v1
id: generated-assistant
name: Generated Assistant
kind: assistant
cli-enabled: true
---
# Objective
Answer a short message.
# System
Be concise.
# Input
\`\`\`yaml schema
object:
  message:
    type: string
required: [message]
additional-properties: false
\`\`\`
# Output
\`\`\`yaml schema
object:
  text:
    type: string
required: [text]
additional-properties: false
\`\`\``;
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/v1/models": () => Response.json({ data: [{ id: "generation-model" }] }),
      "/v1/chat/completions": {
        POST: async (request) => {
          const body = await request.json() as { messages?: Array<{ role?: string; content?: unknown }> };
          const inputExample = body.messages?.some((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("Generate one realistic JSON request body"));
          return Response.json({ choices: [{ message: { content: inputExample
            ? JSON.stringify({ message: "Mi usuario quedó bloqueado después de varios intentos." })
            : JSON.stringify({
              slug: "generated-assistant",
              name: "Generated Assistant",
              summary: "Generated during the daemon test.",
              source: generatedSource,
            }) }, finish_reason: "stop" }] });
        },
      },
    },
  });
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "generation-admin", password: "generation-test-passwordA!", roles: ["system_admin"] });
    const session = { sessionId: "session-generation", connectionId: "connection-generation", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    await route("configuration.defaultLlm.set", {
      catalogId: "openai",
      provider: "generation-provider",
      baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      apiKey: "generation-provider-key",
      model: "generation-model",
    });
    const project = await route("projects.create", { slug: "generation-project", name: "Generation Project" }) as { projectId: string };
    const accepted = await route("agents.generateMarkdown", {
      prompt: "Create an assistant that answers a short message.",
      progressId: "generation_test-progress",
    }, project.projectId) as { activityId: string; progressId: string; status: string };
    expect(accepted).toEqual({ activityId: "generation_test-progress", progressId: "generation_test-progress", status: "accepted" });
    const completed = await waitForActivity(route, accepted.activityId, project.projectId);
    const generated = completed.result as unknown as { manifest: { identity: { id: string } }; sourcePath: string };

    expect(generated.manifest.identity.id).toBe("generated-assistant");
    const stored = await route("files.read", { path: generated.sourcePath }, project.projectId) as { data: string };
    expect(Buffer.from(stored.data, "base64").toString("utf8")).toContain("schema: marcus.agent/v1");
    const progress = await route("agents.generationProgress", { progressId: "generation_test-progress" }, project.projectId) as { status: string; stage: string; message: string; events: Array<{ operation: string; provider?: string; model?: string }> };
    expect(progress).toMatchObject({
      status: "completed",
      stage: "completed",
      message: "Agente creado y activado.",
    });
    expect(progress.events.map((event) => event.operation)).toEqual(expect.arrayContaining(["requirements.analyze", "provider.chat.completions", "markdown.compile", "files.write", "agents.build", "agents.activate"]));
    expect(progress.events.find((event) => event.operation === "provider.chat.completions")).toMatchObject({ provider: "generation-provider", model: "generation-model" });

    const failedAccepted = await route("agents.generateMarkdown", {
      prompt: "Create another assistant with the same generated identifier.",
      progressId: "generation_failed-progress",
    }, project.projectId) as { activityId: string; status: string };
    expect(await waitForActivity(route, failedAccepted.activityId, project.projectId)).toMatchObject({ status: "failed", error: { code: "AGENT_ALREADY_EXISTS" } });
    const failedProgress = await route("agents.generationProgress", { progressId: "generation_failed-progress" }, project.projectId) as { status: string; stage: string; error?: { code: string; message: string }; events: Array<{ kind: string; operation: string; message: string }> };
    expect(failedProgress).toMatchObject({ status: "failed", stage: "failed", error: { code: "AGENT_ALREADY_EXISTS" } });
    expect(failedProgress.events.at(-1)).toMatchObject({ kind: "error", operation: "agents.generateMarkdown" });
    expect(await route("agents.generateInputExample", { agent: "generated-assistant" }, project.projectId)).toMatchObject({
      input: { message: "Mi usuario quedó bloqueado después de varios intentos." },
      source: "llm",
      model: "generation-model",
    });
  } finally {
    await daemon.close();
    provider.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Marcus AI preserves DeepSeek reasoning across tool rounds without exposing it", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-assistant-thinking-"));
  const completionBodies: Array<{ thinking?: { type?: string }; reasoning_effort?: string; messages?: Array<{ role?: string; reasoning_content?: string }> }> = [];
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/v1/models": () => Response.json({ data: [{ id: "deepseek-v4-pro" }] }),
      "/v1/chat/completions": {
        POST: async (request) => {
          const body = await request.json() as typeof completionBodies[number] & { tools?: unknown[] };
          completionBodies.push(body);
          if (completionBodies.length === 1) {
            return Response.json({ choices: [{ message: { content: null, reasoning_content: "private tool reasoning", tool_calls: [{ id: "call_projects", type: "function", function: { name: "projects_list", arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
          }
          return Response.json({ choices: [{ message: { content: completionBodies.length === 2 ? "Primera respuesta" : "Segunda respuesta", reasoning_content: "private final reasoning" }, finish_reason: "stop" }] });
        },
      },
    },
  });
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "assistant-admin", password: "assistant-test-passwordA!", roles: ["system_admin"] });
    const session = { sessionId: "session-assistant", connectionId: "connection-assistant", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, projectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(projectId === undefined ? {} : { projectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    await route("configuration.defaultLlm.set", {
      catalogId: "deepseek",
      provider: "deepseek",
      baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      apiKey: "assistant-provider-key",
      model: "deepseek-v4-pro",
    });

    const firstAccepted = await route("assistant.chat", { messages: [{ role: "user", content: "Listá los proyectos" }] }) as { activityId: string };
    const firstActivity = await waitForActivity(route, firstAccepted.activityId);
    const first = firstActivity.result as unknown as { conversationId: string; message: string; actions: Array<{ tool: string }> };
    expect(first).toMatchObject({ message: "Primera respuesta", actions: [{ tool: "projects_list" }] });
    expect(first.conversationId).toStartWith("conv_");
    expect(JSON.stringify(first)).not.toContain("private");

    const secondAccepted = await route("assistant.chat", {
      conversationId: first.conversationId,
      messages: [
        { role: "user", content: "Listá los proyectos" },
        { role: "assistant", content: first.message },
        { role: "user", content: "¿Y ahora?" },
      ],
    }) as { activityId: string };
    const secondActivity = await waitForActivity(route, secondAccepted.activityId);
    const second = secondActivity.result as unknown as { conversationId: string; message: string };
    expect(second).toEqual(expect.objectContaining({ conversationId: first.conversationId, message: "Segunda respuesta" }));
    expect(JSON.stringify(second)).not.toContain("private");
    expect(completionBodies).toHaveLength(3);
    expect(completionBodies.every((body) => body.thinking?.type === "enabled" && body.reasoning_effort === "high")).toBeTrue();
    expect(completionBodies[1]?.messages?.some((message) => message.role === "assistant" && message.reasoning_content === "private tool reasoning")).toBeTrue();
    expect(completionBodies[2]?.messages?.some((message) => message.role === "assistant" && message.reasoning_content === "private tool reasoning")).toBeTrue();
  } finally {
    await daemon.close();
    provider.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Marcus AI agent-file edits validate, version and activate the updated Markdown", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-assistant-agent-edit-"));
  const editPath = "project:/agents/editable.agent.md";
  let projectId = "";
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/v1/models": () => Response.json({ data: [{ id: "deepseek-v4-pro" }] }),
      "/v1/chat/completions": {
        POST: async (request) => {
          const body = await request.json() as {
            messages?: Array<{ role?: string; content?: unknown }>;
            tools?: Array<{ function?: { name?: string } }>;
          };
          expect(body.tools?.map((entry) => entry.function?.name).sort()).toEqual(["files_read", "files_write"]);
          const toolMessages = body.messages?.filter((message) => message.role === "tool") ?? [];
          if (toolMessages.length === 0) {
            return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "edit-read", type: "function", function: { name: "files_read", arguments: JSON.stringify({ projectId, path: editPath }) } }] }, finish_reason: "tool_calls" }] });
          }
          if (toolMessages.length === 1) {
            const raw = toolMessages[0]?.content;
            const result = typeof raw === "string" ? JSON.parse(raw) as { content?: string } : raw as { content?: string };
            const content = String(result?.content ?? "").replace("cli-enabled: true", "cli-enabled: true\napi-enabled: true");
            return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "edit-write", type: "function", function: { name: "files_write", arguments: JSON.stringify({ projectId, path: editPath, content }) } }] }, finish_reason: "tool_calls" }] });
          }
          return Response.json({ choices: [{ message: { content: "Actualicé y activé el agente." }, finish_reason: "stop" }] });
        },
      },
    },
  });
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  const daemon = await MarcusDaemon.start(config);
  try {
    const principal = await daemon.authentication.createUser({ username: "agent-editor-admin", password: "AgentEditorA!", roles: ["system_admin"] });
    const session = { sessionId: "session-agent-editor", connectionId: "connection-agent-editor", principal, authenticatedAt: new Date().toISOString(), client: { name: "test", version: "1" } };
    const route = (operation: string, payload: JsonValue, scopedProjectId?: string) => daemon.router.route(session, {
      requestId: Bun.randomUUIDv7(), operation, protocolVersion: 1, ...(scopedProjectId === undefined ? {} : { projectId: scopedProjectId }), payload,
    } satisfies MnpRequest<JsonValue>, "daemon-test");
    await route("configuration.defaultLlm.set", {
      catalogId: "deepseek",
      provider: "deepseek",
      baseUrl: "http://127.0.0.1:" + provider.port + "/v1",
      apiKey: "assistant-agent-edit-key",
      model: "deepseek-v4-pro",
    });
    const project = await route("projects.create", { slug: "agent-edit", name: "Agent edit" }) as { projectId: string };
    projectId = project.projectId;
    const source = [
      "---",
      "schema: marcus.agent/v1",
      "id: editable",
      "name: Editable",
      "kind: prompt-task",
      "cli-enabled: true",
      "---",
      "# Objective",
      "Answer.",
      "# System",
      "Be concise.",
      "# Prompt",
      "Answer the input.",
      "# Input",
      "```yaml schema",
      "object:",
      "  message:",
      "    type: string",
      "required: [message]",
      "additional-properties: false",
      "```",
      "# Output",
      "```yaml schema",
      "object:",
      "  text:",
      "    type: string",
      "required: [text]",
      "additional-properties: false",
      "```",
    ].join("\n");
    await route("files.write", { path: editPath, content: source }, projectId);
    await route("agents.createFromProjectSource", { sourcePath: editPath, sourceKind: "markdown", activate: true }, projectId);

    const editedAccepted = await route("assistant.chat", {
      projectId,
      mode: "agent-file-edit",
      path: editPath,
      messages: [{ role: "user", content: "Habilitá la API. CONFIRMAR SOBRESCRIBIR " + editPath }],
    }) as { activityId: string };
    const editedActivity = await waitForActivity(route, editedAccepted.activityId, projectId);
    const edited = editedActivity.result as unknown as { actions: Array<{ tool: string; result: JsonValue }> };
    expect(edited.actions).toHaveLength(2);
    expect(edited.actions[1]).toMatchObject({
      tool: "files_write",
      result: { activated: true, agentId: expect.stringContaining("agt_"), agentVersionId: expect.stringContaining("av_") },
    });
    expect(await route("agents.versions", { agent: "editable" }, projectId)).toEqual([
      expect.objectContaining({ status: "active" }),
      expect.objectContaining({ status: "superseded" }),
    ]);
    expect(await route("agents.get", { agent: "editable" }, projectId)).toMatchObject({ sourceState: "clean" });
    expect(await route("agents.contract", { agent: "editable" }, projectId)).toMatchObject({ entrypoints: { api: { enabled: true } } });
  } finally {
    await daemon.close();
    provider.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
