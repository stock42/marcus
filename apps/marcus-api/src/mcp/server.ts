import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "@marcus/contracts";
import * as z from "zod/v4";
import type { ApiUpstreamClient, S42Request } from "@/index";

const readOnly: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutation: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const projectId = z.string().min(1).describe("ID exacto del Project; obtenelo primero con projects_list");
const agent = z.string().min(1).describe("ID o slug del agente");
const projectTokenId = z.string().min(1).describe("ID del token; nunca el bearer secreto");
const tokenExpiration = z.string().min(1).describe("Fecha ISO futura");
const jsonObject = z.record(z.string(), z.json());
const documentationBundles = {
  markdown: ["MARKDOWN.md", "CLI.md", "RUNTIME.md", "SECURITY.md"],
  sdk: ["SDK.md", "TOOLS.md", "RUNTIME.md", "SECURITY.md", "DEVELOPMENT.md"],
  operations: ["README.md", "INSTALL.md", "CONFIGURATION.md", "OPERATIONS.md", "API.md", "BACKOFFICE.md", "KERNEL.md", "MCP.md", "DISTRIBUTION.md"],
} as const;

export async function handleMarcusMcp(request: S42Request, client: ApiUpstreamClient): Promise<Response> {
  if (request.method !== "POST") return mcpMethodNotAllowed();
  const server = createMarcusMcpServer(client);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const raw = new Request(new URL(request.url, "http://127.0.0.1").toString(), {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    return await transport.handleRequest(raw, { parsedBody: request.body });
  } finally {
    await server.close();
  }
}

export function mcpMethodNotAllowed(): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32_000, message: "Method not allowed. Marcus MCP uses stateless Streamable HTTP POST requests." } }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8", Allow: "POST" },
  });
}

function createMarcusMcpServer(client: ApiUpstreamClient): McpServer {
  const server = new McpServer({ name: "marcus", version: "0.1.0" }, {
    instructions: "Marcus is an agentic operating system. Inspect Projects and load the relevant official documentation bundle before writing. Use project:/ logical paths. Prefer files_write plus agents_build for TypeScript SDK agents, and agents_generate_markdown or files_write plus agents_apply for Markdown. Read before overwriting. Destructive tools require explicit user approval in the MCP client. Every operation is authorized and audited by marcusd.",
  });

  registerSystemTools(server, client);
  registerProjectTools(server, client);
  registerFileTools(server, client);
  registerAgentTools(server, client);
  registerRuntimeTools(server, client);
  registerConfigurationTools(server, client);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}

function registerSystemTools(server: McpServer, client: ApiUpstreamClient): void {
  server.registerTool("system_health", { title: "Salud de Marcus", description: "Obtiene la salud inmediata del daemon y runtime.", annotations: readOnly },
    () => call(client, "system.health", {}));
  server.registerTool("system_doctor", { title: "Diagnóstico de Marcus", description: "Ejecuta el diagnóstico de paths, base, modelos y backups.", annotations: readOnly },
    () => call(client, "system.doctor", {}));
  server.registerTool("system_overview", { title: "Resumen operativo", description: "Obtiene métricas globales, tendencia de Runs y actividad reciente visible.", annotations: readOnly },
    () => call(client, "system.overview", {}));
  server.registerTool("system_search", {
    title: "Buscar en Marcus",
    description: "Busca proyectos, agentes, Runs, archivos y documentación oficial.",
    inputSchema: z.object({ query: z.string().min(2).max(200), limit: z.number().int().min(1).max(200).optional() }),
    annotations: readOnly,
  }, ({ query, limit }) => call(client, "system.search", { query, ...(limit === undefined ? {} : { limit }) }));
  server.registerTool("system_logs", {
    title: "Logs unificados",
    description: "Lee el tail redacted de marcusd, Marcus API y Backoffice. Filtra por source, level o texto.",
    inputSchema: z.object({ source: z.string().optional(), level: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(1_000).default(200) }),
    annotations: readOnly,
  }, ({ source, level, query, limit }) => call(client, "system.logs", { limit, ...(source === undefined ? {} : { source }), ...(level === undefined ? {} : { level }), ...(query === undefined ? {} : { query }) }));
  server.registerTool("documentation_list", { title: "Listar documentación", description: "Lista los documentos oficiales embebidos en Marcus.", annotations: readOnly },
    () => call(client, "documentation.list", {}));
  server.registerTool("documentation_read", {
    title: "Leer documentación",
    description: "Lee un documento oficial completo, por ejemplo SDK.md o MARKDOWN.md.",
    inputSchema: z.object({ name: z.string().min(1) }),
    annotations: readOnly,
  }, ({ name }) => call(client, "documentation.read", { name }));
  server.registerTool("documentation_search", {
    title: "Buscar documentación",
    description: "Busca texto dentro de la documentación oficial de Marcus.",
    inputSchema: z.object({ query: z.string().min(2).max(200), limit: z.number().int().min(1).max(200).optional() }),
    annotations: readOnly,
  }, ({ query, limit }) => call(client, "documentation.search", { query, ...(limit === undefined ? {} : { limit }) }));
  server.registerTool("documentation_bundle", {
    title: "Cargar documentación necesaria",
    description: "Devuelve en una llamada el corpus oficial necesario para crear agentes Markdown, agentes TypeScript SDK u operar Marcus. Usá all para obtener todos los documentos embebidos.",
    inputSchema: z.object({ bundle: z.enum(["markdown", "sdk", "operations", "all"]).describe("Conjunto documental requerido") }),
    annotations: readOnly,
  }, ({ bundle }) => documentationBundle(client, bundle));
}

function registerProjectTools(server: McpServer, client: ApiUpstreamClient): void {
  server.registerTool("projects_list", { title: "Listar Projects", description: "Lista los Projects visibles y sus IDs exactos.", annotations: readOnly },
    () => call(client, "projects.list", {}));
  server.registerTool("projects_get", {
    title: "Ver Project",
    description: "Obtiene un Project por ID.", inputSchema: z.object({ projectId }), annotations: readOnly,
  }, ({ projectId: id }) => call(client, "projects.get", {}, id));
  server.registerTool("projects_dashboard", {
    title: "Métricas del Project",
    description: "Obtiene archivos, agentes y consumo de Runs de 30 días.", inputSchema: z.object({ projectId }), annotations: readOnly,
  }, ({ projectId: id }) => call(client, "projects.dashboard", {}, id));
  server.registerTool("projects_create", {
    title: "Crear Project",
    description: "Crea un Project Home administrado por Marcus.",
    inputSchema: z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u), name: z.string().min(1).max(120) }), annotations: mutation,
  }, ({ slug, name }) => call(client, "projects.create", { slug, name }));
  server.registerTool("projects_delete", {
    title: "Eliminar Project",
    description: "Elimina definitivamente el Project y todos los datos que Marcus administra. Verificá el ID y pedí confirmación explícita al usuario.",
    inputSchema: z.object({ projectId }), annotations: destructive,
  }, ({ projectId: id }) => call(client, "projects.delete", {}, id));
  server.registerTool("project_members_list", {
    title: "Usuarios del Project",
    description: "Lista membresías y roles del Project.", inputSchema: z.object({ projectId }), annotations: readOnly,
  }, ({ projectId: id }) => call(client, "projectMembers.list", {}, id));
  server.registerTool("project_tokens_list", {
    title: "Listar tokens API del Project",
    description: "Lista metadata, estado y scopes de los tokens que invocan agentes por API. Nunca devuelve bearer secrets.",
    inputSchema: z.object({ projectId }), annotations: readOnly,
  }, ({ projectId: id }) => call(client, "projectTokens.list", {}, id));
  server.registerTool("project_tokens_get", {
    title: "Leer token API del Project",
    description: "Obtiene la metadata de un token por ID. El bearer se muestra sólo una vez al crearlo y no puede releerse.",
    inputSchema: z.object({ projectId, tokenId: projectTokenId }), annotations: readOnly,
  }, ({ projectId: id, tokenId }) => call(client, "projectTokens.get", { tokenId }, id));
  server.registerTool("project_tokens_create", {
    title: "Crear token API del Project",
    description: "Crea un token con scopes runs.invoke/runs.read. Devuelve el bearer una única vez; tratá la respuesta como un secreto.",
    inputSchema: z.object({ projectId, label: z.string().min(2).max(80), expiresAt: tokenExpiration.optional() }), annotations: mutation,
  }, ({ projectId: id, label, expiresAt }) => call(client, "projectTokens.create", { label, ...(expiresAt === undefined ? {} : { expiresAt }) }, id));
  server.registerTool("project_tokens_update", {
    title: "Editar token API del Project",
    description: "Actualiza label y/o expiración. expiresAt null elimina la expiración; el bearer y sus scopes son inmutables.",
    inputSchema: z.object({
      projectId,
      tokenId: projectTokenId,
      label: z.string().min(2).max(80).optional(),
      expiresAt: tokenExpiration.nullable().optional(),
    }).refine((value) => value.label !== undefined || value.expiresAt !== undefined, { message: "Provide label or expiresAt" }),
    annotations: mutation,
  }, ({ projectId: id, tokenId, label, expiresAt }) => call(client, "projectTokens.update", {
    tokenId,
    ...(label === undefined ? {} : { label }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }, id));
  server.registerTool("project_tokens_delete", {
    title: "Eliminar token API del Project",
    description: "Revoca inmediatamente el token. Conserva sólo su metadata para auditoría y el bearer no puede volver a utilizarse.",
    inputSchema: z.object({ projectId, tokenId: projectTokenId }), annotations: destructive,
  }, ({ projectId: id, tokenId }) => call(client, "projectTokens.revoke", { tokenId }, id));
}

function registerFileTools(server: McpServer, client: ApiUpstreamClient): void {
  server.registerTool("files_list", {
    title: "Listar archivos",
    description: "Lista un directorio lógico dentro del Project Home.",
    inputSchema: z.object({ projectId, path: z.string().default("project:/") }), annotations: readOnly,
  }, ({ projectId: id, path }) => call(client, "files.list", { path }, id));
  server.registerTool("files_search", {
    title: "Buscar en archivos",
    description: "Busca texto sin distinguir mayúsculas en los archivos del Project.",
    inputSchema: z.object({ projectId, query: z.string().min(1).max(500) }), annotations: readOnly,
  }, ({ projectId: id, query }) => call(client, "files.search", { query }, id));
  server.registerTool("files_read", {
    title: "Leer archivo",
    description: "Lee un archivo del Project y devuelve texto UTF-8 además de tamaño.",
    inputSchema: z.object({ projectId, path: z.string().startsWith("project:/") }), annotations: readOnly,
  }, async ({ projectId: id, path }) => {
    const result = await client.request<{ data: string; size: number }>("files.read", { path }, { projectId: id });
    return textResult({ path, size: result.size, content: Buffer.from(result.data, "base64").toString("utf8") });
  });
  server.registerTool("files_write", {
    title: "Escribir archivo",
    description: "Crea o reemplaza un archivo de texto. Leé primero y usá expectedRevision al editar contenido existente.",
    inputSchema: z.object({ projectId, path: z.string().startsWith("project:/"), content: z.string(), expectedRevision: z.number().int().min(0).optional() }), annotations: mutation,
  }, ({ projectId: id, path, content, expectedRevision }) => call(client, "files.write", { path, content, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, id));
  server.registerTool("files_mkdir", {
    title: "Crear directorio", description: "Crea un directorio lógico.", inputSchema: z.object({ projectId, path: z.string().startsWith("project:/") }), annotations: mutation,
  }, ({ projectId: id, path }) => call(client, "files.mkdir", { path }, id));
  server.registerTool("files_move", {
    title: "Mover archivo", description: "Mueve o renombra un path dentro del Project.", inputSchema: z.object({ projectId, from: z.string(), to: z.string() }), annotations: mutation,
  }, ({ projectId: id, from, to }) => call(client, "files.move", { from, to }, id));
  server.registerTool("files_copy", {
    title: "Copiar archivo", description: "Copia un path dentro del Project.", inputSchema: z.object({ projectId, from: z.string(), to: z.string() }), annotations: mutation,
  }, ({ projectId: id, from, to }) => call(client, "files.copy", { from, to }, id));
  server.registerTool("files_trash", {
    title: "Enviar a papelera", description: "Mueve un archivo o directorio a la papelera recuperable. Pedí confirmación explícita.", inputSchema: z.object({ projectId, path: z.string() }), annotations: destructive,
  }, ({ projectId: id, path }) => call(client, "files.trash", { path }, id));
}

function registerAgentTools(server: McpServer, client: ApiUpstreamClient): void {
  server.registerTool("agents_list", { title: "Listar agentes", description: "Lista agentes, estado, versión activa y fuente.", inputSchema: z.object({ projectId }), annotations: readOnly },
    ({ projectId: id }) => call(client, "agents.list", {}, id));
  server.registerTool("agents_get", { title: "Ver agente", description: "Obtiene el detalle de un agente.", inputSchema: z.object({ projectId, agent }), annotations: readOnly },
    ({ projectId: id, agent: reference }) => call(client, "agents.get", { agent: reference }, id));
  server.registerTool("agents_versions", { title: "Versiones del agente", description: "Lista el historial inmutable de versiones.", inputSchema: z.object({ projectId, agent }), annotations: readOnly },
    ({ projectId: id, agent: reference }) => call(client, "agents.versions", { agent: reference }, id));
  server.registerTool("agents_compiled", {
    title: "Artefacto compilado", description: "Lee manifest, TypeScript generado y JavaScript runtime de una versión Markdown.",
    inputSchema: z.object({ projectId, agent, agentVersionId: z.string().min(1) }), annotations: readOnly,
  }, ({ projectId: id, agent: reference, agentVersionId }) => call(client, "agents.compiled", { agent: reference, agentVersionId }, id));
  server.registerTool("agents_diff", { title: "Estado de fuente", description: "Compara la fuente actual con la versión activa.", inputSchema: z.object({ projectId, agent }), annotations: readOnly },
    ({ projectId: id, agent: reference }) => call(client, "agents.diff", { agent: reference }, id));
  server.registerTool("agent_tools_list", {
    title: "Tools de una AgentVersion",
    description: "Descubre la allowlist efectiva con versiones, schemas, riesgo, timeout, cancelación e idempotencia. Sin agent devuelve el catálogo oficial.",
    inputSchema: z.object({ projectId, agent: z.string().min(1).optional(), agentVersionId: z.string().min(1).optional() }),
    annotations: readOnly,
  }, ({ projectId: id, agent: reference, agentVersionId }) => call(client, "tools.list", {
    ...(reference === undefined ? {} : { agent: reference }),
    ...(agentVersionId === undefined ? {} : { agentVersionId }),
  }, id));
  server.registerTool("agents_plan", {
    title: "Planificar agente", description: "Convierte una necesidad en un plan implementable sin modificar archivos.",
    inputSchema: z.object({ projectId, prompt: z.string().min(12).max(20_000), sourceKind: z.enum(["markdown", "sdk"]).default("markdown") }), annotations: readOnly,
  }, ({ projectId: id, prompt, sourceKind }) => callAgentActivity(client, "agents.plan", { prompt, sourceKind }, id, 90_000));
  server.registerTool("agents_generate_markdown", {
    title: "Generar agente Markdown", description: "Genera, valida, compila y activa un agente Markdown desde lenguaje natural.",
    inputSchema: z.object({ projectId, prompt: z.string().min(12).max(20_000) }), annotations: mutation,
  }, ({ projectId: id, prompt }) => callAgentActivity(client, "agents.generateMarkdown", { prompt }, id, 120_000));
  server.registerTool("agents_build", {
    title: "Compilar fuente", description: "Compila una fuente TypeScript SDK o Markdown registrada y opcionalmente la activa.",
    inputSchema: z.object({ projectId, sourcePath: z.string().startsWith("project:/"), sourceKind: z.enum(["sdk", "markdown"]), activate: z.boolean().default(true) }), annotations: mutation,
  }, ({ projectId: id, sourcePath, sourceKind, activate }) => call(client, "agents.createFromProjectSource", { sourcePath, sourceKind, activate }, id, 120_000));
  server.registerTool("agents_apply", {
    title: "Aplicar edición", description: "Valida, compila y activa la fuente actual de un agente existente.", inputSchema: z.object({ projectId, agent }), annotations: mutation,
  }, ({ projectId: id, agent: reference }) => call(client, "agents.apply", { agent: reference }, id, 120_000));
  server.registerTool("agents_set_api_access", {
    title: "Cambiar acceso API", description: "Activa o desactiva el entrypoint API de un agente Markdown y genera una nueva versión.",
    inputSchema: z.object({ projectId, agent, enabled: z.boolean() }), annotations: mutation,
  }, ({ projectId: id, agent: reference, enabled }) => call(client, "agents.setApiAccess", { agent: reference, enabled }, id, 120_000));
  server.registerTool("agents_start", { title: "Iniciar agente residente", description: "Inicia una instancia residente.", inputSchema: z.object({ projectId, agent }), annotations: mutation },
    ({ projectId: id, agent: reference }) => call(client, "agents.start", { agent: reference }, id));
  server.registerTool("agents_stop", { title: "Detener agente residente", description: "Detiene una instancia residente.", inputSchema: z.object({ projectId, agent }), annotations: destructive },
    ({ projectId: id, agent: reference }) => call(client, "agents.stop", { agent: reference }, id));
}

function registerRuntimeTools(server: McpServer, client: ApiUpstreamClient): void {
  server.registerTool("runs_list", { title: "Listar Runs", description: "Lista Runs recientes de un Project.", inputSchema: z.object({ projectId, limit: z.number().int().min(1).max(1_000).default(100) }), annotations: readOnly },
    ({ projectId: id, limit }) => call(client, "runs.list", { limit }, id));
  server.registerTool("runs_get", { title: "Ver Run", description: "Obtiene estado, output, error y trazas de un Run.", inputSchema: z.object({ projectId, runId: z.string().min(1) }), annotations: readOnly },
    ({ projectId: id, runId }) => call(client, "runs.get", { runId }, id));
  server.registerTool("runs_invoke", { title: "Ejecutar agente", description: "Invoca un agente con input JSON. Pedí aprobación antes de ejecutar efectos externos.", inputSchema: z.object({ projectId, agent, input: jsonObject.default({}) }), annotations: mutation },
    ({ projectId: id, agent: reference, input }) => call(client, "runs.invoke", { agent: reference, input }, id));
  server.registerTool("runs_cancel", { title: "Cancelar Run", description: "Solicita la cancelación de un Run no terminal.", inputSchema: z.object({ projectId, runId: z.string().min(1) }), annotations: destructive },
    ({ projectId: id, runId }) => call(client, "runs.cancel", { runId }, id));
  server.registerTool("processes_list", { title: "Listar procesos", description: "Lista procesos Runtime Host y agentes de un Project.", inputSchema: z.object({ projectId, includeTerminal: z.boolean().default(false) }), annotations: readOnly },
    ({ projectId: id, includeTerminal }) => call(client, "processes.list", { includeTerminal }, id));
  server.registerTool("processes_kill", { title: "Terminar proceso", description: "Termina un proceso activo. Verificá el MPID y pedí confirmación explícita.", inputSchema: z.object({ projectId, mpid: z.string().min(1) }), annotations: destructive },
    ({ projectId: id, mpid }) => call(client, "processes.kill", { mpid }, id));
  server.registerTool("approvals_list", { title: "Listar approvals", description: "Lista solicitudes de aprobación, opcionalmente por estado.", inputSchema: z.object({ projectId, status: z.string().optional(), limit: z.number().int().min(1).max(1_000).default(100) }), annotations: readOnly },
    ({ projectId: id, status, limit }) => call(client, "approvals.list", { limit, ...(status === undefined ? {} : { status }) }, id));
  server.registerTool("approvals_decide", { title: "Resolver approval", description: "Aprueba o rechaza una solicitud pendiente. Pedí confirmación explícita.", inputSchema: z.object({ projectId, approvalId: z.string().min(1), decision: z.enum(["approve", "reject"]), resolution: jsonObject.optional() }), annotations: destructive },
    ({ projectId: id, approvalId, decision, resolution }) => call(client, "approvals.decide", { approvalId, decision, ...(resolution === undefined ? {} : { resolution }) }, id));
  server.registerTool("schedules_list", { title: "Listar schedules", description: "Lista schedules declarados por agentes activos.", inputSchema: z.object({ projectId }), annotations: readOnly },
    ({ projectId: id }) => call(client, "schedules.list", {}, id));
  server.registerTool("schedules_trigger", { title: "Disparar schedule", description: "Ejecuta manualmente un schedule declarado. Pedí confirmación explícita.", inputSchema: z.object({ projectId, agent, scheduleId: z.string().min(1), input: jsonObject.optional() }), annotations: mutation },
    ({ projectId: id, agent: reference, scheduleId, input }) => call(client, "schedules.trigger", { agent: reference, scheduleId, ...(input === undefined ? {} : { input }) }, id));
  server.registerTool("logs_list", { title: "Logs del Project", description: "Lista logs estructurados del runtime y permite filtrar por Run, agente o MPID.", inputSchema: z.object({ projectId, runId: z.string().optional(), agentId: z.string().optional(), mpid: z.string().optional(), limit: z.number().int().min(1).max(1_000).default(200) }), annotations: readOnly },
    ({ projectId: id, ...filters }) => call(client, "logs.list", filters, id));
  server.registerTool("audit_list", { title: "Auditoría del Project", description: "Lista operaciones auditadas del Project.", inputSchema: z.object({ projectId, limit: z.number().int().min(1).max(1_000).default(200) }), annotations: readOnly },
    ({ projectId: id, limit }) => call(client, "audit.list", { limit }, id));
}

function registerConfigurationTools(server: McpServer, client: ApiUpstreamClient): void {
  server.registerTool("providers_catalog", { title: "Catálogo de proveedores", description: "Lista proveedores LLM conocidos por Marcus.", annotations: readOnly },
    () => call(client, "providers.catalog", {}));
  server.registerTool("providers_list", { title: "Proveedores configurados", description: "Lista proveedores configurados sin revelar secretos.", annotations: readOnly },
    () => call(client, "providers.list", {}));
  server.registerTool("providers_models", { title: "Modelos del proveedor", description: "Consulta modelos disponibles en un proveedor configurado.", inputSchema: z.object({ provider: z.string().min(1) }), annotations: readOnly },
    ({ provider }) => call(client, "providers.models", { provider }));
  server.registerTool("providers_test", { title: "Probar proveedor", description: "Ejecuta el probe de un proveedor configurado.", inputSchema: z.object({ provider: z.string().min(1) }), annotations: mutation },
    ({ provider }) => call(client, "providers.test", { provider }));
  server.registerTool("model_roles_list", { title: "Roles de modelos", description: "Lista asignaciones de roles como agent.default.", annotations: readOnly },
    () => call(client, "modelRoles.list", {}));
  server.registerTool("backups_list", { title: "Listar backups", description: "Lista backups registrados por Marcus.", annotations: readOnly },
    () => call(client, "backups.list", {}));
}

function registerResources(server: McpServer, client: ApiUpstreamClient): void {
  server.registerResource("projects", "marcus://projects", { title: "Projects visibles", description: "Catálogo actual de Projects", mimeType: "application/json" }, async (uri) => {
    const projects = await client.request<JsonValue>("projects.list", {});
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(projects, null, 2) }] };
  });
  server.registerResource("documentation", new ResourceTemplate("marcus://documentation/{name}", {
    list: async () => {
      const documents = await client.request<Array<{ name: string }>>("documentation.list", {});
      return { resources: documents.map((document) => ({ uri: `marcus://documentation/${encodeURIComponent(document.name)}`, name: document.name, mimeType: "text/markdown" })) };
    },
  }), { title: "Documentación oficial", description: "Documentos versionados de Marcus", mimeType: "text/markdown" }, async (uri, variables) => {
    const name = String(variables.name ?? "");
    const document = await client.request<{ name: string; content: string }>("documentation.read", { name });
    return { contents: [{ uri: uri.href, name: document.name, mimeType: "text/markdown", text: document.content }] };
  });
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt("plan-agent", {
    title: "Planificar un agente Marcus",
    description: "Investiga la necesidad y produce un plan antes de escribir.",
    argsSchema: { projectId: z.string(), brief: z.string(), sourceKind: z.enum(["markdown", "sdk"]).default("markdown") },
  }, ({ projectId: id, brief, sourceKind }) => prompt(`Planificá un agente ${sourceKind} para el Project ${id}. Primero llamá documentation_bundle con bundle=${sourceKind === "markdown" ? "markdown" : "sdk"} y después usá agents_plan con este brief:\n\n${brief}\n\nNo escribas archivos hasta que el usuario apruebe el plan.`));
  server.registerPrompt("create-markdown-agent", {
    title: "Crear un agente Markdown",
    description: "Flujo completo de documentación, planificación, generación y verificación.",
    argsSchema: { projectId: z.string(), brief: z.string() },
  }, ({ projectId: id, brief }) => prompt(`Construí un agente Markdown en el Project ${id}. Cargá documentation_bundle bundle=markdown, planificá con agents_plan, mostrale el plan al usuario y, cuando lo apruebe, usá agents_generate_markdown. Después verificá agents_get, agents_versions y agents_diff. Brief:\n\n${brief}`));
  server.registerPrompt("create-typescript-agent", {
    title: "Crear un agente TypeScript SDK",
    description: "Flujo Bun-first para escribir, compilar, activar y probar un agente SDK.",
    argsSchema: { projectId: z.string(), brief: z.string() },
  }, ({ projectId: id, brief }) => prompt(`Construí un agente TypeScript SDK Bun-first en el Project ${id}. Cargá documentation_bundle bundle=sdk; planificá con agents_plan sourceKind=sdk; mostrale el plan al usuario. Tras su aprobación, escribí la fuente bajo project:/agents/<slug>/index.ts con files_write, compilá y activá con agents_build sourceKind=sdk, verificá agents_get y agents_versions, y ejecutá casos seguros con runs_invoke. Brief:\n\n${brief}`));
}

async function documentationBundle(client: ApiUpstreamClient, bundle: keyof typeof documentationBundles | "all") {
  const names = bundle === "all"
    ? (await client.request<Array<{ name: string }>>("documentation.list", {})).map((document) => document.name)
    : [...documentationBundles[bundle]];
  const documents = await Promise.all(names.map((name) => client.request<{ name: string; content: string }>("documentation.read", { name })));
  return {
    content: documents.map((document) => ({
      type: "text" as const,
      text: `<document name=${JSON.stringify(document.name)}>\n${document.content.trim()}\n</document>`,
    })),
  };
}

async function call(client: ApiUpstreamClient, operation: string, payload: JsonValue, scopedProjectId?: string, timeoutMs?: number) {
  const result = await client.request<JsonValue>(operation, payload, {
    ...(scopedProjectId === undefined ? {} : { projectId: scopedProjectId }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return textResult(result);
}

async function callAgentActivity(client: ApiUpstreamClient, operation: "agents.plan" | "agents.generateMarkdown", payload: JsonValue, scopedProjectId: string, timeoutMs: number) {
  const accepted = await client.request<JsonValue>(operation, payload, { projectId: scopedProjectId, timeoutMs });
  const activityId = asRecord(accepted)?.activityId;
  if (typeof activityId !== "string") return textResult(accepted);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activity = await client.request<JsonValue>("agentActivities.get", { activityId }, { projectId: scopedProjectId, timeoutMs: Math.min(10_000, Math.max(1_000, deadline - Date.now())) });
    const record = asRecord(activity);
    if (record?.status === "completed") return textResult(record.result ?? activity);
    if (record?.status === "failed") {
      const failure = asRecord(record.error);
      const code = typeof failure?.code === "string" ? failure.code : "AGENT_ACTIVITY_FAILED";
      const message = typeof failure?.message === "string" ? failure.message : "The agent activity failed";
      throw new Error(`${code}: ${message}`);
    }
    await Bun.sleep(100);
  }
  throw new Error(`AGENT_ACTIVITY_TIMEOUT: ${operation} did not finish within ${timeoutMs} ms`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function prompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}
