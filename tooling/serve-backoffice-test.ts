import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { MarcusApi } from "../apps/marcus-api/src/index";
import { MnpClient } from "../packages/protocol-client/src/index";
import { MarcusDaemon, defaultMarcusdConfig } from "../packages/service/src/index";

const port = Number(process.env.MARCUS_BACKOFFICE_API_TEST_PORT ?? "4314");
const directory = await mkdtemp(resolve(tmpdir(), "marcus-backoffice-browser-"));
const bootstrapToken = "browser-test-bootstrap";
const username = "browser-admin";
const password = "browser-test-passwordA!";
const config = defaultMarcusdConfig(directory);
config.listen.port = 0;
config.bootstrap = { token: bootstrapToken };

let daemon: MarcusDaemon | undefined;
let api: MarcusApi | undefined;
let provider: Bun.Server<undefined> | undefined;
let closing = false;

async function close(exitCode: number): Promise<void> {
  if (closing) return;
  closing = true;
  await api?.stop().catch(() => undefined);
  await daemon?.close().catch(() => undefined);
  provider?.stop(true);
  await rm(directory, { recursive: true, force: true });
  process.exit(exitCode);
}

process.on("SIGTERM", () => void close(0));
process.on("SIGINT", () => void close(0));

try {
  daemon = await MarcusDaemon.start(config);
  const address = daemon.address();
  const bootstrap = new MnpClient({
    hostname: address.hostname,
    port: address.port,
    authentication: { method: "bootstrap-token", token: bootstrapToken },
  });
  await bootstrap.request("bootstrap.setup", { username, password });
  bootstrap.close();

  const admin = new MnpClient({
    hostname: address.hostname,
    port: address.port,
    authentication: { method: "username-password", username, password },
  });
  const project = await admin.request<{ projectId: string }>("projects.create", {
    slug: "browser-project",
    name: "Browser Project",
  });
  await admin.request("files.write", { path: "browser-check.txt", content: "Playwright reached Marcus." }, { projectId: project.projectId });
  const sdkPath = resolve(import.meta.dir, "../packages/sdk/src/index.ts");
  const source = `import { defineAgent, m } from ${JSON.stringify(sdkPath)};\nexport default defineAgent({ id: "browser-runner", name: "Browser Runner", input: m.object({ text: m.string() }), output: m.object({ text: m.string() }), async onRun(_context, input) { return { text: input.text.toUpperCase() }; } });\n`;
  await admin.request("files.write", { path: "agents/browser-runner.agent.ts", content: source }, { projectId: project.projectId });
  await admin.request("agents.createFromProjectSource", { sourcePath: "agents/browser-runner.agent.ts", sourceKind: "sdk", activate: true }, { projectId: project.projectId });
  const seededRun = await admin.request<{ runId: string }>("runs.invoke", { agent: "browser-runner", input: { text: "playwright" } }, { projectId: project.projectId });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await admin.request<{ state: string }>("runs.get", { runId: seededRun.runId }, { projectId: project.projectId });
    if (["completed", "failed", "cancelled", "timed_out", "killed"].includes(run.state)) break;
    await Bun.sleep(20);
  }
  provider = Bun.serve({
    hostname: "127.0.0.1",
    port: port + 1,
    routes: {
      "/v1/models": () => Response.json({ data: [{ id: "browser-model" }] }),
      "/v1/chat/completions": {
        POST: async (request) => {
          const body = await request.json() as {
            response_format?: unknown;
            tools?: Array<{ function?: { name?: string } }>;
            messages?: Array<{ role?: string; name?: string; content?: unknown; reasoning_content?: string }>;
          };
          if (body.response_format !== undefined) {
            return Response.json({ error: { message: "This response_format type is unavailable now", type: "invalid_request_error" } }, { status: 400 });
          }
          if (body.messages?.some((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("official Marcus Agent Architect"))) {
            return Response.json({ choices: [{ message: { content: JSON.stringify({
              slug: "operational-planner",
              name: "Operational Planner",
              summary: "Plan verificable para consultas operativas.",
              sourceKind: "markdown",
              architecture: "Un agente declarativo recibe la consulta, usa únicamente fuentes autorizadas y devuelve una respuesta tipada.",
              inputs: ["query: string"],
              outputs: ["answer: string", "sources: string[]"],
              tools: ["Una tool de lectura operativa"],
              files: ["project:/agents/operational-planner.agent.md"],
              steps: ["Definir contrato", "Implementar fuente", "Compilar y activar"],
              testCases: ["Consulta válida", "Información ausente"],
              risks: ["No inventar datos no disponibles"],
            }) }, finish_reason: "stop" }] });
          }
          if (body.messages?.some((message) => typeof message.content === "string" && message.content.includes("official Marcus Markdown agent compiler"))) {
            await Bun.sleep(650);
            const requestContent = [...(body.messages ?? [])].reverse().find((message) => message.role === "user" && typeof message.content === "string")?.content;
            const fromStudio = typeof requestContent === "string" && requestContent.includes("Plan aprobado:");
            const agentId = fromStudio ? "studio-assistant" : "playwright-assistant";
            const agentName = fromStudio ? "Studio Assistant" : "Playwright Assistant";
            const source = `---
schema: marcus.agent/v1
id: ${agentId}
name: ${agentName}
kind: assistant
cli-enabled: true
---
# Objective
Answer a message during the Backoffice browser test.

# System
Return a concise answer.

# Prompt
Answer the provided message.

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
            return Response.json({ choices: [{ message: { content: JSON.stringify({ slug: agentId, name: agentName, summary: "Agente creado por el test E2E.", source }) }, finish_reason: "stop" }] });
          }
          if (body.messages?.some((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("Generate one realistic JSON request body"))) {
            return Response.json({ choices: [{ message: { content: JSON.stringify({ message: "El cliente no puede ingresar a su cuenta." }) }, finish_reason: "stop" }] });
          }
          if (body.messages?.some((message) => message.role === "system" && typeof message.content === "string" && (message.content.includes("Be concise.") || message.content.includes("Return a concise answer.")))) {
            return Response.json({ choices: [{ message: { content: JSON.stringify({ text: "Respuesta del test case." }) }, finish_reason: "stop" }] });
          }
          const latestUserMessage = [...(body.messages ?? [])].reverse().find((message) => message.role === "user" && typeof message.content === "string")?.content;
          if (typeof latestUserMessage === "string" && latestUserMessage.includes("Editá exclusivamente el agente Markdown")) {
            const toolNames = body.tools?.map((entry) => entry.function?.name).filter((name): name is string => name !== undefined).sort() ?? [];
            if (toolNames.join(",") !== "files_read,files_write") return Response.json({ error: { message: "agent editor tools are not restricted" } }, { status: 400 });
            const path = latestUserMessage.match(/ubicado en (project:\/[\w./-]+\.agent\.md)/u)?.[1];
            const systemMessage = body.messages?.find((message) => message.role === "system" && typeof message.content === "string")?.content;
            const projectId = typeof systemMessage === "string" ? systemMessage.match(/only allowed Project is ([^,]+),/u)?.[1] : undefined;
            if (path === undefined || projectId === undefined) return Response.json({ error: { message: "missing restricted editor scope" } }, { status: 400 });
            const toolResults = body.messages?.filter((message) => message.role === "tool") ?? [];
            if (toolResults.length === 0) {
              return Response.json({ choices: [{ message: { content: null, reasoning_content: "private edit read", tool_calls: [{ id: "call_edit_read", type: "function", function: { name: "files_read", arguments: JSON.stringify({ projectId, path }) } }] }, finish_reason: "tool_calls" }] });
            }
            if (toolResults.length === 1) {
              const result = parseToolResult(toolResults[0]?.content);
              const current = typeof result.content === "string" ? result.content : "";
              const content = current.includes("api-enabled: true") ? current : current.replace("cli-enabled: true", "cli-enabled: true\napi-enabled: true");
              return Response.json({ choices: [{ message: { content: null, reasoning_content: "private edit write", tool_calls: [{ id: "call_edit_write", type: "function", function: { name: "files_write", arguments: JSON.stringify({ projectId, path, content }) } }] }, finish_reason: "tool_calls" }] });
            }
            return Response.json({ choices: [{ message: { content: "Agregué `api-enabled: true` al frontmatter y preservé el resto del agente." }, finish_reason: "stop" }] });
          }
          const hasToolResult = body.messages?.some((message) => message.role === "tool") ?? false;
          if ((body.tools?.length ?? 0) > 0 && !hasToolResult) {
            return Response.json({ choices: [{ message: { content: null, reasoning_content: "private browser reasoning", tool_calls: [{ id: "call_projects", type: "function", function: { name: "projects_list", arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
          }
          if (hasToolResult && !body.messages?.some((message) => message.role === "assistant" && message.reasoning_content === "private browser reasoning")) {
            return Response.json({ error: { message: "missing reasoning_content continuity" } }, { status: 400 });
          }
          return Response.json({ choices: [{ message: { content: "Marcus está operativo. Consulté el catálogo real de proyectos mediante Marcus API." }, finish_reason: "stop" }] });
        },
      },
    },
  });
  admin.close();

  const serviceToken = (await Bun.file(resolve(directory, "api.token")).text()).trim();
  api = new MarcusApi({
    port,
    allowedOrigins: [`http://127.0.0.1:${port - 1}`],
    secureCookies: false,
    upstream: {
      hostname: address.hostname,
      port: address.port,
      authentication: { method: "service-account-token", token: serviceToken },
    },
  });
  await api.start();
  console.log(`Backoffice browser test stack: http://127.0.0.1:${port}`);
} catch (error) {
  console.error(error);
  await close(1);
}

function parseToolResult(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
