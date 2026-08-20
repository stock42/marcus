import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MnpClient } from "@marcus/protocol-client";
import { MarcusCli } from "@marcus/cli";
import { AuthenticationService, AuthorizationService, CommandRouter, MarcusDaemon, MnpServer, defaultMarcusdConfig, restoreMarcusBackup, verifyMarcusBackup } from "@marcus/service";
import { MarcusSqliteDatabase, MarcusRepositories } from "@marcus/storage-sqlite";

const resources: Array<{ server: MnpServer; clients: MnpClient[]; database: MarcusSqliteDatabase }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    for (const client of resource.clients) client.close();
    resource.server.stop();
    resource.database.close();
  }
});

test("runs the full MNP to Kernel to Runtime Host to Worker path", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-daemon-e2e-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  config.bootstrap = { token: "one-time-bootstrap-token" };
  const daemon = await MarcusDaemon.start(config);
  const address = daemon.address();
  const bootstrap = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "bootstrap-token", token: "one-time-bootstrap-token" } });
  let admin: MnpClient | undefined;
  try {
    await bootstrap.request("bootstrap.setup", { username: "root-admin", password: "root-admin-passwordA!" });
    bootstrap.close();
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "root-admin", password: "root-admin-passwordA!" } });
    const project = await admin.request<{ projectId: string }>("projects.create", { slug: "e2e", name: "E2E" });
    const localSyncRoot = resolve(directory, "local-sync");
    await Bun.write(resolve(localSyncRoot, "hello.txt"), "sync-one");
    await Bun.write(resolve(localSyncRoot, "delete-me.txt"), "delete-me");
    await Bun.write(resolve(localSyncRoot, "ignored.txt"), "ignored");
    await Bun.write(resolve(localSyncRoot, ".marcusignore"), "ignored.txt\n");
    const syncCli = new MarcusCli(admin, { output: { write() {} } });
    syncCli.context.projectId = project.projectId;
    syncCli.context.projectSlug = "e2e";
    const initialSync = await syncCli.execute(`sync push local:${localSyncRoot} project:/synced --delete --ignore local:${resolve(localSyncRoot, ".marcusignore")}`) as { syncId: string; summary: { uploaded: number }; session: { status: string } };
    expect(initialSync).toMatchObject({ summary: { uploaded: 2 }, session: { status: "completed" } });
    expect(Buffer.from((await admin.request<{ data: string }>("files.read", { path: "synced/hello.txt" }, { projectId: project.projectId })).data, "base64").toString()).toBe("sync-one");
    await expect(admin.request("files.stat", { path: "synced/ignored.txt" }, { projectId: project.projectId })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });

    const watch = syncCli.execute(`sync push local:${localSyncRoot} project:/synced --watch --delete --no-initial --debounce 10 --ignore local:${resolve(localSyncRoot, ".marcusignore")}`);
    await Bun.sleep(25);
    await Bun.write(resolve(localSyncRoot, "hello.txt"), "sync-two");
    await rm(resolve(localSyncRoot, "delete-me.txt"));
    let synced = false;
    let deleted = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const remote = await admin.request<{ data: string }>("files.read", { path: "synced/hello.txt" }, { projectId: project.projectId });
      synced = Buffer.from(remote.data, "base64").toString() === "sync-two";
      try {
        await admin.request("files.stat", { path: "synced/delete-me.txt" }, { projectId: project.projectId });
      } catch (error) {
        deleted = error instanceof Error && "code" in error && error.code === "FILE_NOT_FOUND";
      }
      if (synced && deleted) break;
      await Bun.sleep(10);
    }
    expect(synced).toBe(true);
    expect(deleted).toBe(true);
    const sessions = await admin.request<Array<{ syncId: string; status: string }>>("files.sync.list", {}, { projectId: project.projectId });
    const openSync = sessions.find((session) => session.status === "open");
    expect(openSync).toBeDefined();
    await admin.request("files.sync.stop", { syncId: openSync!.syncId }, { projectId: project.projectId });
    expect(await Promise.race([watch, Bun.sleep(2_000).then(() => { throw new Error("sync watcher did not stop"); })])).toMatchObject({ session: { status: "stopped" } });
    await admin.request("files.write", { path: "notes/original.txt", content: "recoverable" }, { projectId: project.projectId });
    expect(await admin.request("files.stat", { path: "notes/original.txt" }, { projectId: project.projectId })).toMatchObject({ size: 11, revision: 1 });
    await admin.request("files.copy", { from: "notes/original.txt", to: "notes/copied.txt" }, { projectId: project.projectId });
    await admin.request("files.move", { from: "notes/copied.txt", to: "notes/moved.txt" }, { projectId: project.projectId });
    const trash = await admin.request<{ trashId: string }>("files.trash", { path: "notes/moved.txt" }, { projectId: project.projectId });
    await admin.request("files.restore", { trashId: trash.trashId }, { projectId: project.projectId });
    const restoredFile = await admin.request<{ data: string }>("files.read", { path: "notes/moved.txt" }, { projectId: project.projectId });
    expect(Buffer.from(restoredFile.data, "base64").toString("utf8")).toBe("recoverable");
    await Bun.write(resolve(config.projectsDir, "e2e", "external.txt"), "outside service");
    const watched = await admin.request<{ changes: Array<{ path: string; source: string }> }>("files.watch", { path: "project:/", cursor: "1970-01-01T00:00:00.000Z" }, { projectId: project.projectId });
    expect(watched.changes).toContainEqual(expect.objectContaining({ path: "project:/external.txt", source: "external-watcher" }));
    const sdkPath = fileURLToPath(import.meta.resolve("@marcus/sdk"));
    const source = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};\nexport default defineAgent({ id: "e2e-echo", name: "E2E Echo", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), async onRun(_context, input) { return { text: input.text.toUpperCase() }; } });\n`;
    await admin.request("files.write", { path: "agents/e2e.agent.ts", content: source }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/e2e.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const handle = await admin.request<{ runId: string }>("runs.invoke", { agent: "e2e-echo", input: { text: "marcus" } }, { projectId: project.projectId });

    let run: { state: string; output?: unknown } | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      run = await admin.request<{ state: string; output?: unknown }>("runs.get", { runId: handle.runId }, { projectId: project.projectId });
      if (["completed", "failed", "cancelled", "timed_out", "killed"].includes(run.state)) break;
      await Bun.sleep(20);
    }
    expect(run?.state).toBe("completed");
    expect(run?.output).toEqual({ text: "MARCUS" });

    const updatedSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};\nexport default defineAgent({ id: "e2e-echo", name: "E2E Echo", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), async onRun(_context, input) { return { text: input.text.toLowerCase() }; } });\n`;
    await admin.request("files.write", { path: "agents/e2e.agent.ts", content: updatedSource }, { projectId: project.projectId });
    expect(await admin.request("agents.diff", { agent: "e2e-echo" }, { projectId: project.projectId })).toMatchObject({ state: "dirty" });
    const applied = await admin.request<{ agentVersionId: string }>("agents.apply", { agent: "e2e-echo" }, { projectId: project.projectId });
    expect(await admin.request("agents.diff", { agent: "e2e-echo" }, { projectId: project.projectId })).toMatchObject({ state: "clean" });
    const versions = await admin.request<Array<{ agentVersionId: string; sourceHash: string }>>("agents.versions", { agent: "e2e-echo" }, { projectId: project.projectId });
    expect(versions).toHaveLength(2);
    expect(new Set(versions.map((version) => version.sourceHash)).size).toBe(2);
    expect(versions.some((version) => version.agentVersionId === applied.agentVersionId)).toBe(true);

    const updatedHandle = await admin.request<{ runId: string }>("runs.invoke", { agent: "e2e-echo", input: { text: "MARCUS" } }, { projectId: project.projectId });
    expect(await waitForRun(admin, project.projectId, updatedHandle.runId)).toMatchObject({ state: "completed", output: { text: "marcus" } });
  } finally {
    bootstrap.close();
    admin?.close();
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("runs a declarative agent through encrypted provider credentials and a model role", async () => {
  let authorization = "";
  let completionBody: { response_format?: { type?: string }; thinking?: { type?: string }; reasoning_effort?: string; temperature?: number } | undefined;
  const provider = Bun.serve({
    port: 0,
    async fetch(request) {
      authorization = request.headers.get("authorization") ?? "";
      const path = new URL(request.url).pathname;
      if (path === "/v1/models") return Response.json({ data: [{ id: "marcus-test-model" }] });
      if (path === "/v1/chat/completions") {
        completionBody = await request.json() as typeof completionBody;
        return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: "model-ok" }), reasoning_content: "private runtime reasoning" }, finish_reason: "stop" }], usage: { total_tokens: 7 } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-model-e2e-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  config.bootstrap = { token: "provider-bootstrap-token" };
  const daemon = await MarcusDaemon.start(config);
  const address = daemon.address();
  const bootstrap = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "bootstrap-token", token: "provider-bootstrap-token" } });
  let admin: MnpClient | undefined;
  try {
    await bootstrap.request("bootstrap.setup", { username: "provider-admin", password: "provider-admin-passwordA!" });
    bootstrap.close();
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "provider-admin", password: "provider-admin-passwordA!" } });
    await admin.request("secrets.set", { name: "providers.test", value: "provider-key" });
    const registered = await admin.request<{ providerId: string }>("providers.add", { name: "local-test", type: "deepseek", catalogId: "deepseek", baseUrl: `http://127.0.0.1:${provider.port}/v1`, secretRefs: ["providers.test"] });
    const probe = await admin.request<{ probe: { healthy: boolean } }>("providers.test", { provider: registered.providerId });
    expect(probe.probe.healthy).toBe(true);
    await admin.request("modelRoles.set", { role: "agent.default", provider: registered.providerId, model: "marcus-test-model" });

    const project = await admin.request<{ projectId: string }>("projects.create", { slug: "model-e2e", name: "Model E2E" });
    const sdkPath = fileURLToPath(import.meta.resolve("@marcus/sdk"));
    const source = `import { definePromptTask, m } from ${JSON.stringify(sdkPath)};\nexport default definePromptTask({ id: "model-agent", name: "Model Agent", input: m.object({ question: m.string() }), output: m.object({ answer: m.string() }), system: "Answer concisely.", prompt: ({ input }) => input.question });\n`;
    await admin.request("files.write", { path: "agents/model.agent.ts", content: source }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/model.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const handle = await admin.request<{ runId: string }>("runs.invoke", { agent: "model-agent", input: { question: "status?" } }, { projectId: project.projectId });
    const run = await waitForRun(admin, project.projectId, handle.runId);
    expect(run).toMatchObject({ state: "completed", output: { answer: "model-ok" } });
    expect(JSON.stringify(run)).not.toContain("private runtime reasoning");
    expect(completionBody).toMatchObject({ response_format: { type: "json_object" }, thinking: { type: "enabled" }, reasoning_effort: "high" });
    expect(completionBody?.temperature).toBeUndefined();
    expect(authorization).toBe("Bearer provider-key");
    let processes: Array<{ state: string }> = [];
    for (let attempt = 0; attempt < 100 && !processes.some((process) => process.state === "stopped"); attempt += 1) {
      processes = await admin.request<Array<{ state: string }>>("processes.list", { includeTerminal: true }, { projectId: project.projectId });
      if (!processes.some((process) => process.state === "stopped")) await Bun.sleep(10);
    }
    expect(processes.some((process) => process.state === "stopped")).toBe(true);
    const audit = await admin.request<Array<{ operation: string }>>("audit.list", {}, { projectId: project.projectId });
    expect(audit.some((event) => event.operation === "runs.invoke")).toBe(true);
  } finally {
    bootstrap.close();
    admin?.close();
    await daemon.close();
    provider.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists uploads, external authentication, conversations, artifacts, messages, assets, and approvals", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-operational-e2e-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  config.bootstrap = { token: "operational-bootstrap-token" };
  const daemon = await MarcusDaemon.start(config);
  const address = daemon.address();
  const bootstrap = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "bootstrap-token", token: "operational-bootstrap-token" } });
  let admin: MnpClient | undefined;
  try {
    await bootstrap.request("bootstrap.setup", { username: "operations-admin", password: "operations-admin-passwordA!" });
    bootstrap.close();
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "operations-admin", password: "operations-admin-passwordA!" } });
    const project = await admin.request<{ projectId: string }>("projects.create", { slug: "operational-e2e", name: "Operational E2E" });
    const sdkPath = fileURLToPath(import.meta.resolve("@marcus/sdk"));
    await admin.request("secrets.set", { name: "agents.bearer", value: "bearer-value" }, { projectId: project.projectId });
    await admin.request("secrets.set", { name: "agents.hmac", value: "hmac-value" }, { projectId: project.projectId });

    const validatorSource = `import { defineAuthValidator } from ${JSON.stringify(sdkPath)};
export default defineAuthValidator({ id: "project-token", scheme: "bearer", async validate(_context, credential) { return credential.token === "registered-ok" ? { authenticated: true, principal: { id: "registered-user", type: "external", claims: { source: "registered-validator" } } } : { authenticated: false, code: "AUTH_REGISTERED_REJECTED" }; } });
`;
    await admin.request("files.write", { path: "validators/project-token/index.ts", content: validatorSource }, { projectId: project.projectId });
    const registeredValidator = await admin.request<{ validatorId: string; validatorVersionId: string }>("authValidators.createFromProjectSource", { sourcePath: "validators/project-token/index.ts", activate: true }, { projectId: project.projectId });
    expect(await admin.request("authValidators.list", {}, { projectId: project.projectId })).toMatchObject([{ validatorId: registeredValidator.validatorId, slug: "project-token", status: "active" }]);
    await expect(admin.request("authValidators.test", { validator: "project/project-token", credential: "wrong" }, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_REGISTERED_REJECTED" });
    expect(await admin.request("authValidators.test", { validator: "project/project-token", credential: "registered-ok" }, { projectId: project.projectId })).toMatchObject({ authenticated: true, principal: { id: "registered-user" } });

    const registeredMarkdown = `---
schema: marcus.agent/v1
id: registered-auth-agent
name: Registered Auth Agent
kind: prompt-task
cli-enabled: false
api-enabled: true
api:
  authentication:
    type: validator
    scheme: bearer
    validator: project/project-token
---
# Objective
Echo the input.
# Input
\`\`\`yaml schema
object:
  text:
    type: string
required: [text]
additional-properties: false
\`\`\`
# Output
\`\`\`yaml schema
object:
  text:
    type: string
required: [text]
additional-properties: false
\`\`\`
`;
    await admin.request("files.write", { path: "agents/registered.agent.md", content: registeredMarkdown }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/registered.agent.md", sourceKind: "markdown", activate: true }, { projectId: project.projectId });
    const registeredRequest = { agent: "registered-auth-agent", input: { text: "registered" }, method: "POST", path: "/agents/registered-auth-agent", bodySha256: new Bun.CryptoHasher("sha256").update("registered").digest("hex") };
    await expect(admin.request("agents.invokeExternal", { ...registeredRequest, headers: { authorization: "Bearer wrong" } }, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_REGISTERED_REJECTED" });
    const registeredHandle = await admin.request<{ runId: string }>("agents.invokeExternal", { ...registeredRequest, headers: { authorization: "Bearer registered-ok" } }, { projectId: project.projectId });
    expect(await admin.request("runs.get", { runId: registeredHandle.runId }, { projectId: project.projectId })).toMatchObject({ principalId: "registered-user" });
    expect(await admin.request("authValidators.get", { validator: "project-token" }, { projectId: project.projectId })).toMatchObject({
      scheme: "bearer",
      timeoutMs: 3_000,
      dependentAgents: ["registered-auth-agent"],
    });
    expect(await admin.request("authValidators.disable", { validator: "project-token" }, { projectId: project.projectId })).toMatchObject({ status: "disabled" });
    await expect(admin.request("agents.invokeExternal", { ...registeredRequest, headers: { authorization: "Bearer registered-ok" } }, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_SCHEME_UNAVAILABLE" });
    expect(await admin.request("authValidators.activate", { validator: "project-token", validatorVersionId: registeredValidator.validatorVersionId }, { projectId: project.projectId })).toMatchObject({ status: "active" });

    const bearerSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({
  id: "bearer-agent", name: "Bearer Agent",
  input: m.object({ chatId: m.string(), text: m.string() }), output: m.object({ text: m.string(), artifactId: m.string() }),
  entrypoints: { api: { enabled: true, authentication: { type: "bearer-secret", secret: "agents.bearer" } } },
  conversation: { enabled: true, chatIdPath: "input.chatId", scope: "principal+chat", injection: "manual" },
  assets: { staticDir: "assets", expose: true },
  async onRun(context, input) {
    await context.conversation?.appendMessage({ kind: "observed", text: input.text });
    const artifact = await context.artifacts.fromBytes({ name: "answer.txt", mediaType: "text/plain", bytes: new TextEncoder().encode(input.text) });
    return { text: input.text.toUpperCase(), artifactId: artifact.artifactId };
  }
});
`;
    const bearerBytes = new TextEncoder().encode(bearerSource);
    const sourceHash = new Bun.CryptoHasher("sha256").update(bearerBytes).digest("hex");
    const upload = await admin.request<{ uploadId: string }>("uploads.open", {
      fileName: "bearer.agent.ts", destination: "agents/bearer.agent.ts", purpose: "agent-source", size: bearerBytes.byteLength, sha256: sourceHash,
    }, { projectId: project.projectId });
    await admin.request("uploads.chunk", { uploadId: upload.uploadId, offset: 0, data: bearerBytes.toBase64(), sha256: sourceHash }, { projectId: project.projectId });
    await admin.request("uploads.commit", { uploadId: upload.uploadId }, { projectId: project.projectId });
    await admin.request("files.write", { path: "agents/assets/hello.txt", content: "immutable asset" }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/bearer.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });

    await expect(admin.request("agents.invokeExternal", {
      agent: "bearer-agent", input: { chatId: "chat-1", text: "marcus" }, chatId: "chat-1", method: "POST", path: "/agents/bearer-agent", bodySha256: sourceHash,
      headers: { authorization: "Bearer wrong-value" },
    }, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_CREDENTIALS_INVALID" });
    const bearerHandle = await admin.request<{ runId: string }>("agents.invokeExternal", {
      agent: "bearer-agent", input: { chatId: "chat-1", text: "marcus" }, chatId: "chat-1", method: "POST", path: "/agents/bearer-agent", bodySha256: sourceHash,
      headers: { authorization: "Bearer bearer-value" },
    }, { projectId: project.projectId });
    const bearerRun = await waitForRun(admin, project.projectId, bearerHandle.runId);
    expect(bearerRun).toMatchObject({ state: "completed", output: { text: "MARCUS" } });

    const conversations = await admin.request<Array<{ conversationId: string }>>("conversations.list", {}, { projectId: project.projectId });
    expect(conversations).toHaveLength(1);
    const conversationMessages = await admin.request<Array<{ role: string }>>("conversations.messages", { conversationId: conversations[0]!.conversationId }, { projectId: project.projectId });
    expect(conversationMessages.map((message) => message.role)).toEqual(["user", "event", "assistant"]);
    const artifacts = await admin.request<Array<{ artifactId: string; sha256: string }>>("artifacts.list", { runId: bearerHandle.runId }, { projectId: project.projectId });
    expect(artifacts).toHaveLength(1);
    const artifact = await admin.request<{ data: string; sha256: string }>("artifacts.read", { artifactId: artifacts[0]!.artifactId }, { projectId: project.projectId });
    expect(Buffer.from(artifact.data, "base64").toString("utf8")).toBe("marcus");
    expect(artifact.sha256).toBe(new Bun.CryptoHasher("sha256").update("marcus").digest("hex"));
    const importedBytes = new TextEncoder().encode("imported artifact");
    const importedHash = new Bun.CryptoHasher("sha256").update(importedBytes).digest("hex");
    const importedUpload = await admin.request<{ uploadId: string }>("uploads.open", { fileName: "imported.txt", purpose: "artifact-import", size: importedBytes.byteLength, sha256: importedHash }, { projectId: project.projectId });
    await admin.request("uploads.chunk", { uploadId: importedUpload.uploadId, offset: 0, data: importedBytes.toBase64(), sha256: importedHash }, { projectId: project.projectId });
    const importedArtifact = await admin.request<{ result: { runId: string; sha256: string } }>("uploads.commit", { uploadId: importedUpload.uploadId, runId: bearerHandle.runId, mediaType: "text/plain" }, { projectId: project.projectId });
    expect(importedArtifact.result).toMatchObject({ runId: bearerHandle.runId, sha256: importedHash });
    const asset = await admin.request<{ data: string }>("agents.asset", { agent: "bearer-agent", path: "hello.txt" }, { projectId: project.projectId });
    expect(Buffer.from(asset.data, "base64").toString("utf8")).toBe("immutable asset");

    const message = await admin.request<{ messageId: string }>("messages.send", { recipient: "backoffice", type: "notice", payload: { text: "ready" } }, { projectId: project.projectId });
    expect(await admin.request<Array<{ messageId: string; state: string }>>("messages.list", { address: "backoffice" }, { projectId: project.projectId })).toMatchObject([{ messageId: message.messageId, state: "available" }]);
    await admin.request("messages.ack", { messageId: message.messageId }, { projectId: project.projectId });

    const messageSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "message-agent", name: "Message Agent", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), entrypoints: { messages: { enabled: true } }, async onRun(_context, input) { return { text: input.text.toUpperCase() }; } });
`;
    await admin.request("files.write", { path: "agents/message.agent.ts", content: messageSource }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/message.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const delivered = await admin.request<{ messageId: string; triggeredRunId: string }>("messages.send", { recipient: "agent:message-agent", type: "command", payload: { text: "deliver" } }, { projectId: project.projectId });
    expect(await waitForRun(admin, project.projectId, delivered.triggeredRunId)).toMatchObject({ state: "completed", output: { text: "DELIVER" } });
    let deliveredMessages: Array<{ messageId: string; state: string }> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      deliveredMessages = await admin.request<typeof deliveredMessages>("messages.list", { address: "agent:message-agent" }, { projectId: project.projectId });
      if (deliveredMessages[0]?.state === "acknowledged") break;
      await Bun.sleep(10);
    }
    expect(deliveredMessages).toMatchObject([{ messageId: delivered.messageId, state: "acknowledged" }]);

    const hmacSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "hmac-agent", name: "HMAC Agent", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), entrypoints: { api: { enabled: true, authentication: { type: "hmac", secret: "agents.hmac", replayWindow: "5m" } } }, async onRun(_context, input) { return input; } });
`;
    await admin.request("files.write", { path: "agents/hmac.agent.ts", content: hmacSource }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/hmac.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const timestamp = String(Date.now());
    const nonce = "nonce-1";
    const method = "POST";
    const path = "/agents/hmac-agent";
    const bodySha256 = new Bun.CryptoHasher("sha256").update(JSON.stringify({ text: "signed" })).digest("hex");
    const signature = new Bun.CryptoHasher("sha256", "hmac-value").update(`${timestamp}\n${nonce}\n${method}\n${path}\n${bodySha256}`).digest("hex");
    const signedRequest = { agent: "hmac-agent", input: { text: "signed" }, method, path, bodySha256, headers: { "x-timestamp": timestamp, "x-nonce": nonce, "x-signature": signature } };
    const hmacHandle = await admin.request<{ runId: string }>("agents.invokeExternal", signedRequest, { projectId: project.projectId });
    expect(await waitForRun(admin, project.projectId, hmacHandle.runId)).toMatchObject({ state: "completed", output: { text: "signed" } });
    await expect(admin.request("agents.invokeExternal", signedRequest, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_HMAC_REPLAY" });

    const customSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "custom-auth-agent", name: "Custom Auth Agent", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), entrypoints: { api: { enabled: true, authentication: { type: "custom", scheme: "custom-test", validate: async (_context, credential) => credential.token === "custom-ok" ? { authenticated: true, principal: { id: "custom-principal", type: "external" } } : { authenticated: false, code: "AUTH_CUSTOM_REJECTED" } } } }, async onStart() { throw new Error("normal lifecycle executed"); }, async onRun(_context, input) { return input; } });
`;
    await admin.request("files.write", { path: "agents/custom.agent.ts", content: customSource }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/custom.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    await expect(admin.request("agents.invokeExternal", { agent: "custom-auth-agent", input: { text: "custom" }, method: "POST", path: "/agents/custom-auth-agent", bodySha256, headers: { authorization: "Bearer rejected" } }, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_CUSTOM_REJECTED" });
    const customHandle = await admin.request<{ runId: string }>("agents.invokeExternal", { agent: "custom-auth-agent", input: { text: "custom" }, method: "POST", path: "/agents/custom-auth-agent", bodySha256, headers: { authorization: "Bearer custom-ok" } }, { projectId: project.projectId });
    expect(await waitForRun(admin, project.projectId, customHandle.runId)).toMatchObject({ state: "failed" });

    const scheduledSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "scheduled-agent", name: "Scheduled Agent", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), entrypoints: { schedules: [{ id: "every-minute", cron: "* * * * *", timezone: "UTC", input: { text: "tick" } }] }, async onRun(_context, input) { return input; } });
`;
    await admin.request("files.write", { path: "agents/scheduled.agent.ts", content: scheduledSource }, { projectId: project.projectId });
    const scheduledAgent = await admin.request<{ agentId: string }>("agents.createFromProjectSource", { sourcePath: "agents/scheduled.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    let scheduledRuns: Array<{ runId: string; agentId: string; entrypoint: string; state: string }> = [];
    for (let attempt = 0; attempt < 150; attempt += 1) {
      scheduledRuns = (await admin.request<typeof scheduledRuns>("runs.list", {}, { projectId: project.projectId })).filter((run) => run.agentId === scheduledAgent.agentId && run.entrypoint === "schedule");
      if (scheduledRuns.length > 0 && scheduledRuns.every((run) => ["completed", "failed"].includes(run.state))) break;
      await Bun.sleep(20);
    }
    expect(scheduledRuns.some((run) => run.state === "completed")).toBe(true);

    const approvalSource = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "approval-agent", name: "Approval Agent", input: m.object({ value: m.string() }), output: m.object({ approved: m.boolean() }), async onRun(context) { const resolution = await context.approvals.request({ action: "release", prompt: "Release result?" }); return { approved: resolution.approved === true }; } });
`;
    await admin.request("files.write", { path: "agents/approval.agent.ts", content: approvalSource }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/approval.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const approvalHandle = await admin.request<{ runId: string }>("runs.invoke", { agent: "approval-agent", input: { value: "release" } }, { projectId: project.projectId });
    let pending: Array<{ approvalId: string }> = [];
    for (let attempt = 0; attempt < 100 && pending.length === 0; attempt += 1) {
      pending = await admin.request<Array<{ approvalId: string }>>("approvals.list", { status: "pending" }, { projectId: project.projectId });
      if (pending.length === 0) await Bun.sleep(20);
    }
    expect(pending).toHaveLength(1);
    await admin.request("approvals.decide", { approvalId: pending[0]!.approvalId, decision: "approve", resolution: { approved: true } }, { projectId: project.projectId });
    expect(await waitForRun(admin, project.projectId, approvalHandle.runId)).toMatchObject({ state: "completed", output: { approved: true } });
    const auditJson = JSON.stringify(await admin.request("audit.list", { limit: 1000 }, { projectId: project.projectId }));
    expect(auditJson).not.toContain("bearer-value");
    expect(auditJson).not.toContain("custom-ok");
    expect(auditJson).not.toContain("registered-ok");
    expect(auditJson).not.toContain(signature);
  } finally {
    bootstrap.close();
    admin?.close();
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists HMAC replay protection across daemon restarts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-hmac-replay-e2e-"));
  const config = defaultMarcusdConfig(directory);
  config.listen.port = 0;
  config.bootstrap = { token: "hmac-replay-bootstrap-token" };
  let daemon: MarcusDaemon | undefined;
  let bootstrap: MnpClient | undefined;
  let admin: MnpClient | undefined;
  try {
    daemon = await MarcusDaemon.start(config);
    let address = daemon.address();
    bootstrap = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "bootstrap-token", token: "hmac-replay-bootstrap-token" } });
    await bootstrap.request("bootstrap.setup", { username: "hmac-admin", password: "hmac-admin-passwordA!" });
    bootstrap.close();
    bootstrap = undefined;
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "hmac-admin", password: "hmac-admin-passwordA!" } });
    const project = await admin.request<{ projectId: string }>("projects.create", { slug: "hmac-replay", name: "HMAC Replay" });
    await admin.request("secrets.set", { name: "agents.hmac", value: "restart-secret" }, { projectId: project.projectId });
    const sdkPath = fileURLToPath(import.meta.resolve("@marcus/sdk"));
    const source = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "restart-hmac", name: "Restart HMAC", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), entrypoints: { api: { enabled: true, authentication: { type: "hmac", secret: "agents.hmac", replayWindow: "5m" } } }, async onRun(_context, input) { return input; } });
`;
    await admin.request("files.write", { path: "agents/restart-hmac.agent.ts", content: source }, { projectId: project.projectId });
    await admin.request("agents.createFromProjectSource", { sourcePath: "agents/restart-hmac.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const timestamp = String(Date.now());
    const nonce = "restart-nonce";
    const method = "POST";
    const path = "/agents/restart-hmac";
    const bodySha256 = new Bun.CryptoHasher("sha256").update(JSON.stringify({ text: "once" })).digest("hex");
    const signature = new Bun.CryptoHasher("sha256", "restart-secret").update(`${timestamp}\n${nonce}\n${method}\n${path}\n${bodySha256}`).digest("hex");
    const replayKeyHash = new Bun.CryptoHasher("sha256").update("marcus:hmac-replay:v1\0").update(nonce).update("\0").update(signature).digest("hex");
    daemon.database.raw.query("INSERT INTO hmac_replay_entries(project_id, replay_key_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(project.projectId, replayKeyHash, Date.now() - 1, Date.now() - 10_000);
    const request = { agent: "restart-hmac", input: { text: "once" }, method, path, bodySha256, headers: { "x-timestamp": timestamp, "x-nonce": nonce, "x-signature": signature } };
    const handle = await admin.request<{ runId: string }>("agents.invokeExternal", request, { projectId: project.projectId });
    expect(await waitForRun(admin, project.projectId, handle.runId)).toMatchObject({ state: "completed", output: { text: "once" } });
    admin.close();
    admin = undefined;
    await daemon.close();
    daemon = undefined;

    daemon = await MarcusDaemon.start(config);
    address = daemon.address();
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "hmac-admin", password: "hmac-admin-passwordA!" } });
    await expect(admin.request("agents.invokeExternal", {
      ...request,
      headers: { ...request.headers, "x-signature": `sha256=${signature}` },
    }, { projectId: project.projectId })).rejects.toMatchObject({ code: "AUTH_HMAC_REPLAY" });
    const entries = daemon.database.raw.query<{ replay_key_hash: string; expires_at: number }, [string]>("SELECT replay_key_hash, expires_at FROM hmac_replay_entries WHERE project_id=?").all(project.projectId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.replay_key_hash).toBe(replayKeyHash);
    expect(entries[0]?.expires_at).toBeGreaterThan(Date.now());
    expect(JSON.stringify(entries)).not.toContain(nonce);
    expect(JSON.stringify(entries)).not.toContain(signature);
  } finally {
    bootstrap?.close();
    admin?.close();
    await daemon?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("creates, verifies, and restores a consistent offline backup", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "marcus-backup-e2e-"));
  const dataDirectory = resolve(root, "data");
  const backupDirectory = resolve(root, "backup-v1");
  const config = defaultMarcusdConfig(dataDirectory);
  config.listen.port = 0;
  config.bootstrap = { token: "backup-bootstrap-token" };
  let daemon = await MarcusDaemon.start(config);
  let address = daemon.address();
  const bootstrap = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "bootstrap-token", token: "backup-bootstrap-token" } });
  let admin: MnpClient | undefined;
  try {
    await bootstrap.request("bootstrap.setup", { username: "backup-admin", password: "backup-admin-passwordA!" });
    bootstrap.close();
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "backup-admin", password: "backup-admin-passwordA!" } });
    const project = await admin.request<{ projectId: string }>("projects.create", { slug: "backup-project", name: "Backup Project" });
    await admin.request("files.write", { path: "state/value.txt", content: "before-backup" }, { projectId: project.projectId });
    await admin.request("secrets.set", { name: "backup.secret", value: "encrypted-value" }, { projectId: project.projectId });
    const backup = await admin.request<{ destination: string; status: string }>("backups.create", { destination: `server:${backupDirectory}` });
    expect(backup).toMatchObject({ destination: backupDirectory, status: "completed" });
    expect((await verifyMarcusBackup(`server:${backupDirectory}`)).schemaVersion).toBe("marcus.backup/v1");
    await admin.request("files.write", { path: "state/value.txt", content: "after-backup" }, { projectId: project.projectId });
    admin.close();
    admin = undefined;
    await daemon.close();

    const restored = await restoreMarcusBackup(config, `server:${backupDirectory}`);
    expect(restored.restoredFrom).toBe(backupDirectory);
    daemon = await MarcusDaemon.start(config);
    address = daemon.address();
    admin = new MnpClient({ hostname: address.hostname, port: address.port, authentication: { method: "username-password", username: "backup-admin", password: "backup-admin-passwordA!" } });
    const restoredProjects = await admin.request<Array<{ projectId: string; slug: string }>>("projects.list", {});
    const restoredProject = restoredProjects.find((candidate) => candidate.slug === "backup-project");
    expect(restoredProject).toBeDefined();
    const restoredFile = await admin.request<{ data: string }>("files.read", { path: "state/value.txt" }, { projectId: restoredProject!.projectId });
    expect(Buffer.from(restoredFile.data, "base64").toString("utf8")).toBe("before-backup");
    expect(await daemon.secrets.resolve("backup.secret", restoredProject!.projectId)).toBe("encrypted-value");
  } finally {
    bootstrap.close();
    admin?.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reuses and recovers an explicitly restartable resident instance after daemon crash", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "marcus-resident-recovery-"));
  const dataDirectory = resolve(root, "data");
  const configPath = resolve(root, "marcusd.json");
  const config = defaultMarcusdConfig(dataDirectory);
  config.listen.port = 0;
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
  let firstProcess: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let secondProcess: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let client: MnpClient | undefined;
  try {
    const first = await startDaemonProcess(configPath, false);
    firstProcess = first.process;
    const bootstrapToken = (await Bun.file(config.bootstrap!.tokenFile!).text()).trim();
    const bootstrap = new MnpClient({ hostname: first.address.hostname, port: first.address.port, authentication: { method: "bootstrap-token", token: bootstrapToken } });
    await bootstrap.request("bootstrap.setup", { username: "resident-admin", password: "resident-admin-passwordA!" });
    bootstrap.close();
    client = new MnpClient({ hostname: first.address.hostname, port: first.address.port, authentication: { method: "username-password", username: "resident-admin", password: "resident-admin-passwordA!" } });
    const project = await client.request<{ projectId: string }>("projects.create", { slug: "resident-project", name: "Resident Project" });
    const sdkPath = fileURLToPath(import.meta.resolve("@marcus/sdk"));
    const source = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};
export default defineAgent({ id: "resident-echo", name: "Resident Echo", runtime: { residency: "resident" }, recovery: { policy: "restart-instance" }, input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), async onRun(_context, input) { return { text: input.text.toUpperCase() }; } });
`;
    await client.request("files.write", { path: "agents/resident.agent.ts", content: source }, { projectId: project.projectId });
    await client.request("agents.createFromProjectSource", { sourcePath: "agents/resident.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
    const started = await client.request<{ instanceId: string }>("agents.start", { agent: "resident-echo" }, { projectId: project.projectId });
    for (const text of ["one", "two"]) {
      const handle = await client.request<{ runId: string }>("runs.invoke", { agent: "resident-echo", input: { text } }, { projectId: project.projectId });
      expect(await waitForRun(client, project.projectId, handle.runId)).toMatchObject({ state: "completed", output: { text: text.toUpperCase() } });
    }
    const beforeCrash = await client.request<Array<{ instanceId: string; state: string }>>("agents.instances", { agent: "resident-echo" }, { projectId: project.projectId });
    expect(beforeCrash.filter((instance) => ["ready", "running"].includes(instance.state))).toEqual([expect.objectContaining({ instanceId: started.instanceId })]);
    client.close();
    client = undefined;
    firstProcess.kill("SIGKILL");
    await firstProcess.exited;
    firstProcess = undefined;

    const second = await startDaemonProcess(configPath, true);
    secondProcess = second.process;
    client = new MnpClient({ hostname: second.address.hostname, port: second.address.port, authentication: { method: "username-password", username: "resident-admin", password: "resident-admin-passwordA!" } });
    const afterRecovery = await client.request<Array<{ instanceId: string; state: string; restartedFromInstanceId?: string }>>("agents.instances", { agent: "resident-echo" }, { projectId: project.projectId });
    expect(afterRecovery.some((instance) => instance.state === "orphaned" && instance.instanceId === started.instanceId)).toBe(true);
    expect(afterRecovery.some((instance) => instance.state === "ready" && instance.restartedFromInstanceId === started.instanceId)).toBe(true);
    const recoveredHandle = await client.request<{ runId: string }>("runs.invoke", { agent: "resident-echo", input: { text: "recovered" } }, { projectId: project.projectId });
    expect(await waitForRun(client, project.projectId, recoveredHandle.runId)).toMatchObject({ state: "completed", output: { text: "RECOVERED" } });
  } finally {
    client?.close();
    if (firstProcess !== undefined) { firstProcess.kill("SIGKILL"); await firstProcess.exited; }
    if (secondProcess !== undefined) { secondProcess.kill("SIGTERM"); await secondProcess.exited; }
    await rm(root, { recursive: true, force: true });
  }
});

describe("MNP/1 service boundary", () => {
  test("authenticates username/password and multiplexes requests", async () => {
    const setup = await createService();
    await setup.authentication.createUser({ username: "admin", password: "correct horse battery stapleA!", roles: ["system_admin"] });
    const client = setup.client({ method: "username-password", username: "admin", password: "correct horse battery stapleA!" });

    const [slow, fast] = await Promise.all([
      client.request<{ value: string }>("test.delay", { value: "slow", delay: 30 }),
      client.request<{ value: string }>("test.delay", { value: "fast", delay: 0 }),
    ]);

    expect(slow).toEqual({ value: "slow" });
    expect(fast).toEqual({ value: "fast" });
    expect(client.session?.principal.claims?.username).toBe("admin");
  });

  test("delivers daemon publications as asynchronous MNP EVENT frames", async () => {
    const setup = await createService();
    await setup.authentication.createUser({ username: "realtime-admin", password: "realtime-admin-passwordA!", roles: ["system_admin"] });
    const client = setup.client({ method: "username-password", username: "realtime-admin", password: "realtime-admin-passwordA!" });
    await client.request("system.health", {});
    const received = new Promise<{ topic: string; payload: unknown }>((resolve) => {
      const unsubscribe = client.subscribe((event) => {
        unsubscribe();
        resolve({ topic: event.topic, payload: event.payload });
      });
    });

    setup.server.publishRealtime({
      topic: "run.progress",
      timestamp: "2026-08-16T00:00:00.000Z",
      projectId: "prj_realtime",
      eventSeq: 42,
      payload: { runId: "run_realtime", progress: 50 },
    });

    expect(await received).toEqual({
      topic: "run.progress",
      payload: { projectId: "prj_realtime", data: { runId: "run_realtime", progress: 50 } },
    });
    expect(setup.server.realtimeStats()).toMatchObject({ activeConnections: 1, publishedEvents: 1, deliveredEvents: 1 });
  });

  test("enforces project RBAC on every request", async () => {
    const setup = await createService();
    const repositories = new MarcusRepositories(setup.database);
    const project = repositories.createProject({ slug: "rbac", name: "RBAC" });
    const user = await setup.authentication.createUser({ username: "viewer", password: "viewer-passwordA!" });
    setup.authentication.setProjectRole(project.projectId, user.id, "project_viewer");
    const client = setup.client({ method: "username-password", username: "viewer", password: "viewer-passwordA!" });

    expect(await client.request<{ allowed: boolean }>("test.project.read", {}, { projectId: project.projectId })).toEqual({ allowed: true });
    await expect(client.request("test.project.write", {}, { projectId: project.projectId })).rejects.toMatchObject({ code: "RBAC_FORBIDDEN" });
  });

  test("accepts hashed scoped tokens and rejects revoked tokens", async () => {
    const setup = await createService();
    const issued = setup.authentication.issueToken({ type: "service-account-token", scopes: ["system.health"] });
    const client = setup.client({ method: "service-account-token", token: issued.token });
    expect(await client.request<{ status: string }>("system.health", {})).toEqual({ status: "ok" });
    client.close();

    setup.authentication.revokeToken(issued.tokenId);
    const revoked = setup.client({ method: "service-account-token", token: issued.token });
    await expect(revoked.connect()).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });
});

async function createService() {
  const database = new MarcusSqliteDatabase(":memory:");
  const authentication = new AuthenticationService(database);
  const authorization = new AuthorizationService(database);
  const router = new CommandRouter(authorization)
    .register("system.health", { capability: "system.health", handler: () => ({ status: "ok" }) })
    .register("test.delay", {
      capability: "system.health",
      handler: async (_context, payload) => {
        const value = payload as { value: string; delay: number };
        await Bun.sleep(value.delay);
        return { value: value.value };
      },
    })
    .register("test.project.read", { capability: "projects.read", projectRequired: true, handler: () => ({ allowed: true }) })
    .register("test.project.write", { capability: "files.write", projectRequired: true, handler: () => ({ allowed: true }) });
  const server = new MnpServer({ hostname: "127.0.0.1", port: 0, nodeId: "test-node" }, authentication, router);
  const address = server.start();
  const clients: MnpClient[] = [];
  resources.push({ server, clients, database });
  return {
    database,
    authentication,
    server,
    client(authenticationMethod: ConstructorParameters<typeof MnpClient>[0]["authentication"]) {
      const client = new MnpClient({
        hostname: address.hostname,
        port: address.port,
        authentication: authenticationMethod,
        connectTimeoutMs: 2_000,
        requestTimeoutMs: 2_000,
      });
      clients.push(client);
      return client;
    },
  };
}

async function waitForRun(client: MnpClient, projectId: string, runId: string): Promise<{ state: string; output?: unknown; error?: unknown }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await client.request<{ state: string; output?: unknown; error?: unknown }>("runs.get", { runId }, { projectId });
    if (["completed", "failed", "cancelled", "timed_out", "killed"].includes(run.state)) return run;
    await Bun.sleep(20);
  }
  throw new Error(`Run ${runId} did not finish`);
}

async function startDaemonProcess(configPath: string, forceRecover: boolean): Promise<{
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  address: { hostname: string; port: number };
}> {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../marcusd/src/index.ts"), "--config", configPath, ...(forceRecover ? ["--force-recover"] : [])], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const ready = readDaemonReady(child.stdout);
  try {
    const address = await Promise.race([
      ready,
      Bun.sleep(5_000).then(() => { throw new Error("marcusd did not become ready within 5 seconds"); }),
    ]);
    return { process: child, address };
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    const stderr = await new Response(child.stderr).text();
    throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr === "" ? "" : `: ${stderr}`}`);
  }
}

async function readDaemonReady(stream: ReadableStream<Uint8Array>): Promise<{ hostname: string; port: number }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) throw new Error("marcusd exited before readiness");
      buffered += decoder.decode(next.value, { stream: true });
      const lineEnd = buffered.indexOf("\n");
      if (lineEnd < 0) continue;
      const record = JSON.parse(buffered.slice(0, lineEnd)) as { event?: string; address?: { hostname?: unknown; port?: unknown } };
      if (record.event === "marcusd.ready" && typeof record.address?.hostname === "string" && typeof record.address.port === "number") {
        return { hostname: record.address.hostname, port: record.address.port };
      }
      buffered = buffered.slice(lineEnd + 1);
    }
  } finally {
    reader.releaseLock();
  }
}
