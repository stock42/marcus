import { chmod, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { AgentBuildService, copyAgentAssets, hashArtifactTree, hashSourceTree } from "@marcus/compiler";
import {
  MarcusError,
  MARCUS_OFFICIAL_TOOL_CATALOG,
  createId,
  isToolManifest,
  officialToolManifest,
  type AgentDefinitionRecord,
  type AgentManifest,
  type AgentVersionRecord,
  type ArtifactRecord,
  type JsonValue,
  type KernelEvent,
  type Principal,
  type RunRecord,
  type SerializedSchema,
  type ToolCallOptions,
  type ToolManifest,
} from "@marcus/contracts";
import { MarcusKernel, RateLimitManager } from "@marcus/kernel";
import { compileMarkdownAgent, emitMarkdownArtifact } from "@marcus/markdown";
import { createMarcusFileLogger, type SafeLogger } from "@marcus/observability";
import { DiskArtifactStore, DiskProjectFileStore, type ProjectFileMetadata } from "@marcus/project-files";
import {
  inferProviderCatalogId,
  listProviderCatalog,
  OpenAICompatibleProvider,
  providerCatalogEntry,
  type ModelGenerationRequest,
  type ModelGenerationResponse,
  type ModelMessage,
  type ModelToolCall,
  type ProviderCapabilities,
} from "@marcus/provider-contracts";
import { ProcessRuntimeController, RuntimeHostController, RuntimeMessageType, type RuntimeEnvelope } from "@marcus/runtime-host";
import { validateSchema } from "@marcus/schema";
import { SecretStore } from "@marcus/secrets";
import {
  MarcusRepositories,
  MarcusSqliteDatabase,
  SqliteProjectFileMetadataRepository,
  type ProjectRecord,
} from "@marcus/storage-sqlite";
import { AuthenticationService } from "./auth";
import { AuthorizationService } from "./authorization";
import { CommandRouter, type CommandAuditEvent, type CommandContext } from "./router";
import { MnpServer, type RealtimePublication } from "./server";
import { createMarcusBackup, verifyMarcusBackup } from "./operations";
import { cronMatches, validateCron } from "./scheduler";
import { marcusDocumentation, marcusDocumentationCorpus, marcusMarkdownAuthoringGuide } from "./documentation-corpus";

export interface MarcusdConfig {
  nodeId: string;
  listen: { host: string; port: number; tls: "required" | "optional-loopback" | "disabled-loopback"; tlsOptions?: Bun.TLSOptions };
  dataDir: string;
  projectsDir: string;
  databasePath: string;
  logsDir: string;
  runtimeDir: string;
  buildDir: string;
  runtimeHostExecutable?: string;
  agentProcessExecutable?: string;
  manifestLoaderExecutable?: string;
  secrets: { keyFile: string; masterKey?: string };
  bootstrap?: { token?: string; tokenFile?: string };
  forceRecover?: boolean;
}

type ProviderRow = {
  provider_id: string;
  name: string;
  type: string;
  base_url: string | null;
  secret_refs_json: string;
  status: "unverified" | "healthy" | "degraded" | "unavailable";
  capabilities_json: string;
  created_at: string;
  updated_at: string;
};

type ModelRoleRow = { role: string; provider_id: string; model_name: string; configuration_json: string; updated_at: string };
type ProjectMemberRow = {
  user_id: string;
  username: string;
  status: string;
  role: string;
  created_at: string;
  system_admin: number;
};
type ProjectTokenRow = {
  token_id: string;
  label: string | null;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};
type ProcessRow = {
  mpid: string; process_type: string; project_id: string | null; agent_id: string | null; agent_version_id: string | null;
  instance_id: string | null; parent_mpid: string | null; os_pid: number | null; state: string; health: string; started_at: string;
  last_heartbeat_at: string | null; last_progress_at: string | null; exit_code: number | null; signal: string | null;
};
type ConversationRow = { conversation_id: string; project_id: string; agent_id: string; principal_id: string | null; chat_id: string | null; scope: string; next_sequence: number; metadata_json: string; created_at: string; updated_at: string };
type UploadRow = { upload_id: string; project_id: string; destination: string | null; file_name: string; purpose: string; expected_size: number; expected_sha256: string | null; received_size: number; staging_path: string; status: string; expires_at: string; created_at: string };
type SyncRow = { sync_id: string; project_id: string; local_root_fingerprint: string; project_root: string; mode: string; delete_policy: string; status: string; state_json: string; created_at: string; updated_at: string };
type ToolCallRow = {
  tool_call_id: string;
  run_id: string;
  agent_version_id: string | null;
  tool_id: string;
  tool_version: string | null;
  state: string;
  input_json: string;
  output_json: string | null;
  error_json: string | null;
  risk: string | null;
  side_effects: number;
  idempotency_key: string | null;
  approval_id: string | null;
  cached_from_call_id: string | null;
  trace_id: string;
  created_at: string;
  finished_at: string | null;
};
type AuthValidatorRow = { validator_id: string; project_id: string; slug: string; active_version_id: string | null; source_path: string | null; source_state: string; status: string; created_at: string; updated_at: string | null };
type AuthValidatorVersionRow = { validator_version_id: string; validator_id: string; source_hash: string; artifact_hash: string; artifact_uri: string; scheme: string; status: string; created_at: string; activated_at: string | null };
type RuntimeController = RuntimeHostController | ProcessRuntimeController;
type ResidentInstance = {
  key: string;
  projectId: string;
  agentId: string;
  agentVersionId: string;
  instanceId: string;
  instanceMpid: string;
  shutdownTimeoutMs: number;
  runtime: RuntimeController;
};
type AssistantThread = {
  conversationId: string;
  principalId: string;
  projectId?: string;
  bindingKey: string;
  messages: ModelMessage[];
  updatedAt: number;
};
type AgentGenerationStage = "analyzing" | "generating" | "normalizing" | "validating" | "repairing" | "activating" | "completed" | "failed";
type AgentActivityKind = "agent.generate" | "agent.plan" | "assistant.chat";
type AgentGenerationProgressEvent = {
  sequence: number;
  timestamp: string;
  stage: AgentGenerationStage;
  kind: "analysis" | "provider" | "compiler" | "tool" | "result" | "error";
  title: string;
  message: string;
  operation: string;
  provider?: string;
  model?: string;
};
type AgentGenerationProgressRecord = {
  activityId: string;
  activityKind: AgentActivityKind;
  progressId: string;
  projectId?: string;
  principalId: string;
  status: "running" | "completed" | "failed";
  stage: AgentGenerationStage;
  message: string;
  sequence: number;
  startedAt: string;
  updatedAt: string;
  events: AgentGenerationProgressEvent[];
  provider?: string;
  model?: string;
  error?: { code: string; message: string };
  result?: JsonValue;
};

export const API_SERVICE_TOKEN_SCOPES = ["system.health", "agents.read", "runs.invoke", "runs.read"] as const;
const API_SERVICE_TOKEN_ID = "tok_marcus_api";
const ASSISTANT_MAX_ROUNDS = 8;
const ASSISTANT_MAX_HISTORY_MESSAGES = 30;
const ASSISTANT_MAX_MESSAGE_LENGTH = 20_000;
const ASSISTANT_MAX_PROVIDER_MESSAGES = 160;
const ASSISTANT_THREAD_TTL_MS = 2 * 60 * 60 * 1_000;
const AGENT_GENERATION_PROGRESS_TTL_MS = 15 * 60 * 1_000;

function generationEventKind(stage: AgentGenerationStage): AgentGenerationProgressEvent["kind"] {
  if (stage === "analyzing") return "analysis";
  if (stage === "generating" || stage === "repairing") return "provider";
  if (stage === "normalizing" || stage === "validating") return "compiler";
  if (stage === "activating") return "tool";
  if (stage === "completed") return "result";
  return "error";
}

function generationEventTitle(stage: AgentGenerationStage): string {
  return {
    analyzing: "Análisis de requisitos",
    generating: "Generación con LLM",
    normalizing: "Normalización del contrato",
    validating: "Validación del compilador",
    repairing: "Corrección asistida",
    activating: "Persistencia y compilación",
    completed: "Versión activa",
    failed: "Generación fallida",
  }[stage];
}

function generationEventOperation(stage: AgentGenerationStage): string {
  return {
    analyzing: "requirements.analyze",
    generating: "provider.chat.completions",
    normalizing: "agent.contract.normalize",
    validating: "markdown.compile",
    repairing: "provider.chat.completions.repair",
    activating: "agents.build",
    completed: "agents.activate",
    failed: "agents.generateMarkdown",
  }[stage];
}

function publicGenerationError(error: unknown): { code: string; message: string } {
  if (error instanceof MarcusError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: error.name === "Error" ? "AGENT_GENERATION_FAILED" : error.name, message: error.message };
  return { code: "AGENT_GENERATION_FAILED", message: String(error) };
}

const generatedAgentOutputSchema: SerializedSchema = {
  type: "object",
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1, maxLength: 120 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    source: { type: "string", minLength: 80 },
  },
  required: ["slug", "name", "summary", "source"],
  additionalProperties: false,
};

const generatedAgentOutputExample: JsonValue = {
  slug: "status-assistant",
  name: "Status Assistant",
  summary: "Answers a status request with a concise message.",
  source: `---
schema: marcus.agent/v1
id: status-assistant
name: Status Assistant
kind: assistant
cli-enabled: true
---
# Objective
Answer a status request.
# System
Be concise and factual.
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
\`\`\``,
};

const agentPlanOutputSchema: SerializedSchema = {
  type: "object",
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1, maxLength: 120 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    sourceKind: { type: "string", enum: ["markdown", "sdk"] },
    architecture: { type: "string", minLength: 1, maxLength: 4_000 },
    inputs: { type: "array", items: { type: "string" }, maxItems: 40 },
    outputs: { type: "array", items: { type: "string" }, maxItems: 40 },
    tools: { type: "array", items: { type: "string" }, maxItems: 40 },
    files: { type: "array", items: { type: "string" }, maxItems: 40 },
    steps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 40 },
    testCases: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 40 },
    risks: { type: "array", items: { type: "string" }, maxItems: 40 },
  },
  required: ["slug", "name", "summary", "sourceKind", "architecture", "inputs", "outputs", "tools", "files", "steps", "testCases", "risks"],
  additionalProperties: false,
};

const assistantTools: NonNullable<ModelGenerationRequest["tools"]> = [
  tool("projects_list", "Lista los proyectos visibles para el usuario.", {}),
  tool("projects_get", "Obtiene el detalle de un proyecto.", { projectId: stringSchema("ID o slug del proyecto") }, ["projectId"]),
  tool("projects_create", "Crea un proyecto administrado por Marcus.", { slug: stringSchema("Slug kebab-case"), name: stringSchema("Nombre visible") }, ["slug", "name"]),
  tool("projects_delete", "Elimina definitivamente un proyecto y sus datos administrados. Sólo funciona cuando el usuario escribe CONFIRMAR ELIMINAR PROYECTO seguido del ID o slug.", { projectId: stringSchema("ID o slug" ) }, ["projectId"]),
  tool("agents_list", "Lista los agentes de un proyecto.", { projectId: stringSchema("ID o slug del proyecto") }, ["projectId"]),
  tool("agents_get", "Obtiene el detalle de un agente.", { projectId: stringSchema("ID o slug del proyecto"), agent: stringSchema("ID o slug del agente") }, ["projectId", "agent"]),
  tool("agents_generate", "Crea y activa un agente Markdown nuevo a partir de lenguaje natural.", { projectId: stringSchema("ID o slug del proyecto"), prompt: stringSchema("Descripción completa del agente") }, ["projectId", "prompt"]),
  tool("agents_apply", "Compila y activa la fuente actual de un agente. Requiere CONFIRMAR APLICAR seguido del agente.", { projectId: stringSchema("ID o slug del proyecto"), agent: stringSchema("ID o slug del agente") }, ["projectId", "agent"]),
  tool("files_list", "Lista archivos en un path lógico del proyecto.", { projectId: stringSchema("ID o slug del proyecto"), path: stringSchema("Path project:/") }, ["projectId"]),
  tool("files_read", "Lee un archivo de texto del proyecto.", { projectId: stringSchema("ID o slug del proyecto"), path: stringSchema("Path project:/") }, ["projectId", "path"]),
  tool("files_write", "Crea un archivo de texto. Para sobrescribir uno existente requiere CONFIRMAR SOBRESCRIBIR seguido del path.", { projectId: stringSchema("ID o slug del proyecto"), path: stringSchema("Path project:/"), content: stringSchema("Contenido completo") }, ["projectId", "path", "content"]),
  tool("files_trash", "Mueve un archivo a la papelera. Requiere CONFIRMAR ELIMINAR seguido del path.", { projectId: stringSchema("ID o slug del proyecto"), path: stringSchema("Path project:/") }, ["projectId", "path"]),
  tool("runs_list", "Lista las ejecuciones recientes de un proyecto.", { projectId: stringSchema("ID o slug del proyecto"), limit: { type: "integer", minimum: 1, maximum: 100 } }, ["projectId"]),
  tool("runs_invoke", "Ejecuta un agente con input JSON. Requiere CONFIRMAR EJECUTAR seguido del agente.", { projectId: stringSchema("ID o slug del proyecto"), agent: stringSchema("ID o slug del agente"), input: { type: "object", additionalProperties: true } }, ["projectId", "agent"]),
  tool("runs_cancel", "Cancela una ejecución. Requiere CONFIRMAR CANCELAR seguido del run ID.", { projectId: stringSchema("ID o slug del proyecto"), runId: stringSchema("Run ID") }, ["projectId", "runId"]),
  tool("providers_list", "Lista proveedores LLM configurados, sin revelar secretos.", {}),
  tool("model_roles_list", "Lista las asignaciones de roles de modelos.", {}),
  tool("system_health", "Obtiene el estado de salud de Marcus.", {}),
  tool("system_doctor", "Ejecuta el diagnóstico de Marcus.", {}),
];
const agentFileEditTools = assistantTools.filter((definition) => definition.name === "files_read" || definition.name === "files_write");

export function defaultMarcusdConfig(dataDir = resolve(homedir(), ".marcus")): MarcusdConfig {
  return {
    nodeId: `node-${Bun.randomUUIDv7()}`,
    listen: { host: "127.0.0.1", port: 4242, tls: "disabled-loopback" },
    dataDir,
    projectsDir: resolve(dataDir, "projects"),
    databasePath: resolve(dataDir, "kernel.db"),
    logsDir: resolve(dataDir, "logs"),
    runtimeDir: resolve(dataDir, "runtime"),
    buildDir: resolve(dataDir, "builds"),
    secrets: { keyFile: resolve(dataDir, "secrets.key") },
    bootstrap: { tokenFile: resolve(dataDir, "bootstrap.token") },
  };
}

export class MarcusDaemon {
  readonly database: MarcusSqliteDatabase;
  readonly repositories: MarcusRepositories;
  readonly kernel: MarcusKernel;
  readonly authentication: AuthenticationService;
  readonly authorization: AuthorizationService;
  readonly router: CommandRouter;
  readonly server: MnpServer;
  readonly secrets: SecretStore;
  readonly logger: SafeLogger;
  private readonly fileStores = new Map<string, DiskProjectFileStore>();
  private readonly activeRuns = new Map<string, RuntimeController>();
  private readonly residentInstances = new Map<string, ResidentInstance>();
  private readonly residentStarts = new Map<string, Promise<ResidentInstance>>();
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly activeToolExecutions = new Map<string, { runId: string; controller: AbortController; cancellable: boolean }>();
  private readonly pendingApprovals = new Map<string, { runId: string; resolve(value: JsonValue): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly assistantThreads = new Map<string, AssistantThread>();
  private readonly agentGenerationProgress = new Map<string, AgentGenerationProgressRecord>();
  private readonly activeAgentActivities = new Map<string, Promise<void>>();
  private dispatching = false;
  private closed = false;
  private maintenance = false;
  private schedulerTicking = false;
  private messageDispatching = false;
  private schedulerTimer?: ReturnType<typeof setInterval>;

  private constructor(readonly config: MarcusdConfig, database: MarcusSqliteDatabase, masterKey: Uint8Array, private readonly lockPath: string) {
    this.database = database;
    let publishPersistedEvent: ((event: KernelEvent) => void) | undefined;
    this.repositories = new MarcusRepositories(database, {
      onKernelEvent: (event) => publishPersistedEvent?.(event),
    });
    this.kernel = new MarcusKernel({
      nodeId: config.nodeId,
      repository: this.repositories,
      rateLimits: new RateLimitManager({
        persistence: {
          get: (key) => {
            const row = database.raw.query<{ value_json: string }, [string]>("SELECT value_json FROM rate_limit_state WHERE state_key=?").get(key);
            return row === null ? undefined : JSON.parse(row.value_json);
          },
          set: (key, value) => database.raw.query(`INSERT INTO rate_limit_state(state_key, value_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(state_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`).run(key, JSON.stringify(value), new Date().toISOString()),
        },
      }),
    });
    this.authentication = new AuthenticationService(
      database,
      config.bootstrap?.token === undefined ? {} : { bootstrapToken: config.bootstrap.token },
    );
    this.authorization = new AuthorizationService(database);
    this.secrets = new SecretStore(database, masterKey);
    this.logger = createMarcusFileLogger("marcusd", { logsDir: config.logsDir });
    this.router = new CommandRouter(
      this.authorization,
      (event) => this.auditCommand(event),
      (operation) => {
        if (this.maintenance && operation !== "backups.create" && operation !== "system.health") {
          throw serviceError("MAINTENANCE_ACTIVE", "Control operations are paused for maintenance");
        }
      },
    );
    this.registerCommands();
    this.server = new MnpServer(
      {
        hostname: config.listen.host,
        port: config.listen.port,
        nodeId: config.nodeId,
        ...(config.listen.tlsOptions === undefined ? {} : { tls: config.listen.tlsOptions }),
      },
      this.authentication,
      this.router,
      this.logger,
      (session, event) => this.canReceiveRealtime(session.principal, event),
    );
    publishPersistedEvent = (event) => this.server.publishRealtime({
      topic: event.eventType,
      timestamp: event.occurredAt,
      eventSeq: event.eventSeq,
      ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
      payload: event as unknown as JsonValue,
    });
  }

  static async start(config: MarcusdConfig): Promise<MarcusDaemon> {
    validateConfig(config);
    for (const path of [config.dataDir, config.projectsDir, config.logsDir, config.runtimeDir, config.buildDir, resolve(config.databasePath, "..")]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
    }
    const lockPath = resolve(config.dataDir, "marcusd.lock");
    if (config.forceRecover === true) await recoverAuthorityLock(lockPath);
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch {
      throw new MarcusError({ code: "KERNEL_AUTHORITY_LOCKED", message: `Authority lock already exists: ${lockPath}`, retryable: false });
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid, nodeId: config.nodeId, startedAt: new Date().toISOString() }));
    await handle.close();
    let database: MarcusSqliteDatabase | undefined;
    try {
      database = new MarcusSqliteDatabase(config.databasePath);
      const masterKey = await loadOrCreateMasterKey(config, database);
      const bootstrap = await prepareBootstrap(config, database);
      const { bootstrap: _configuredBootstrap, ...configWithoutBootstrap } = config;
      const effectiveConfig: MarcusdConfig = bootstrap === undefined ? configWithoutBootstrap : { ...configWithoutBootstrap, bootstrap };
      const daemon = new MarcusDaemon(effectiveConfig, database, masterKey, lockPath);
      await daemon.ensureApiServiceToken();
      daemon.reconcileStartup();
      daemon.reconcileMessageDeliveries();
      await daemon.recoverResidentAgents();
      daemon.server.start();
      daemon.startScheduler();
      daemon.logger.info("daemon.started", { nodeId: daemon.config.nodeId, address: daemon.address(), databasePath: daemon.config.databasePath });
      return daemon;
    } catch (error) {
      database?.close();
      await rm(lockPath, { force: true });
      throw error;
    }
  }

  address(): { hostname: string; port: number } {
    return this.server.start();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.schedulerTimer !== undefined) clearInterval(this.schedulerTimer);
    this.server.stop();
    for (const execution of this.activeToolExecutions.values()) execution.controller.abort("Daemon is shutting down");
    this.activeToolExecutions.clear();
    for (const [approvalId, pending] of this.pendingApprovals) {
      clearTimeout(pending.timer);
      pending.reject(serviceError("APPROVAL_CANCELLED", "Daemon is shutting down"));
      this.database.raw.query("UPDATE approval_requests SET status='cancelled', resolved_at=? WHERE approval_id=? AND status='pending'").run(new Date().toISOString(), approvalId);
    }
    this.pendingApprovals.clear();
    this.assistantThreads.clear();
    await Promise.all([...this.residentInstances.values()].map((resident) => this.stopResidentInstance(resident, "stopped")));
    await Promise.all([...new Set(this.activeRuns.values())].map((runtime) => runtime.close()));
    await Promise.allSettled([...this.activeExecutions.values()]);
    await Promise.allSettled([...this.activeAgentActivities.values()]);
    const now = new Date().toISOString();
    this.database.raw.query(`UPDATE runs SET state='cancelled', result='cancelled', error_json=?, finished_at=?
      WHERE state IN ('accepted','queued','starting','cancelling')`).run(JSON.stringify({ code: "DAEMON_SHUTDOWN", message: "Run cancelled during daemon shutdown", retryable: true }), now);
    this.database.close();
    await rm(this.lockPath, { force: true });
    this.logger.info("daemon.stopped", { nodeId: this.config.nodeId });
  }

  private async ensureApiServiceToken(): Promise<void> {
    const target = resolve(this.config.dataDir, "api.token");
    try {
      const existing = (await Bun.file(target).text()).trim();
      if (existing !== "" && this.authentication.isServiceTokenActive(existing, API_SERVICE_TOKEN_ID, API_SERVICE_TOKEN_SCOPES)) {
        await chmod(target, 0o600);
        return;
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    const issued = this.authentication.replaceServiceToken(API_SERVICE_TOKEN_ID, API_SERVICE_TOKEN_SCOPES);
    try {
      await writeProtectedFile(target, issued.token);
    } catch (error) {
      this.authentication.revokeToken(issued.tokenId);
      throw error;
    }
  }

  private registerCommands(): void {
    this.router
      .register("system.health", { capability: "system.health", handler: () => this.health() })
      .register("system.doctor", { capability: "system.health", handler: () => this.doctor() })
      .register("system.overview", { capability: "projects.read", handler: (context) => this.systemOverview(context) })
      .register("system.logs", { capability: "users.manage", handler: (_context, payload) => this.systemLogs(payload) })
      .register("system.search", { capability: "projects.read", handler: (context, payload) => this.systemSearch(context, payload) })
      .register("system.operations", { capability: "system.health", handler: () => this.router.listOperations() as JsonValue })
      .register("documentation.list", { capability: "projects.read", handler: () => this.listDocumentation() })
      .register("documentation.read", { capability: "projects.read", handler: (_context, payload) => this.readDocumentation(requiredString(asObject(payload), "name")) })
      .register("documentation.search", { capability: "projects.read", handler: (_context, payload) => this.searchDocumentation(payload) })
      .register("backups.list", { capability: "system.health", handler: () => this.listBackups() })
      .register("backups.verify", { capability: "system.health", handler: (_context, payload) => verifyMarcusBackup(requiredString(asObject(payload), "source")) as unknown as Promise<JsonValue> })
      .register("backups.create", { capability: "users.manage", mutation: true, handler: (_context, payload) => this.createBackup(requiredString(asObject(payload), "destination")) })
      .register("schedules.list", { capability: "agents.read", projectRequired: true, handler: (context) => this.listSchedules(context.projectId!) })
      .register("schedules.trigger", { capability: "runs.invoke", projectRequired: true, handler: (context, payload) => this.triggerSchedule(context.projectId!, payload, context.session.principal) })
      .register("bootstrap.setup", {
        capability: "bootstrap.setup",
        handler: async (_context, payload) => {
          const input = asObject(payload);
          const principal = await this.authentication.createUser({
            username: requiredString(input, "username"),
            password: requiredString(input, "password"),
            roles: ["system_admin"],
          });
          if (this.config.bootstrap?.tokenFile !== undefined) await rm(this.config.bootstrap.tokenFile, { force: true });
          return { userId: principal.id };
        },
      })
      .register("projects.list", { capability: "projects.read", handler: (context, payload) => this.listProjects(context, payload) })
      .register("projects.get", { capability: "projects.read", projectRequired: true, handler: (context) => this.requiredProject(context.projectId!) as unknown as JsonValue })
      .register("projects.dashboard", { capability: "projects.read", projectRequired: true, handler: (context) => this.projectDashboard(context.projectId!) })
      .register("projects.create", { capability: "projects.create", handler: (context, payload) => this.createProject(context, payload) as unknown as JsonValue })
      .register("projects.update", { capability: "projects.update", projectRequired: true, handler: (context, payload) => this.updateProject(context.projectId!, payload) })
      .register("projects.archive", { capability: "projects.update", projectRequired: true, handler: (context) => this.archiveProject(context.projectId!) })
      .register("projects.delete", { capability: "projects.update", projectRequired: true, mutation: true, handler: (context) => this.deleteProject(context.projectId!) })
      .register("projectMembers.list", { capability: "projects.read", projectRequired: true, handler: (context) => this.listProjectMembers(context.projectId!) })
      .register("projectMembers.add", { capability: "projects.update", projectRequired: true, handler: (context, payload) => this.addProjectMember(context.projectId!, payload) })
      .register("projectMembers.create", { capability: "projects.update", projectRequired: true, mutation: true, handler: (context, payload) => this.createProjectMember(context.projectId!, payload) })
      .register("projectMembers.update", { capability: "projects.update", projectRequired: true, mutation: true, handler: (context, payload) => this.updateProjectMember(context.projectId!, payload) })
      .register("projectMembers.remove", { capability: "projects.update", projectRequired: true, handler: (context, payload) => this.removeProjectMember(context.projectId!, payload) })
      .register("users.list", { capability: "users.manage", handler: () => this.listUsers() })
      .register("users.create", { capability: "users.manage", handler: (_context, payload) => this.createUser(payload) })
      .register("users.password.change", { capability: "users.manage", mutation: true, handler: (context, payload) => this.changeOwnPassword(context, payload) })
      .register("users.disable", { capability: "users.manage", handler: (_context, payload) => this.disableUser(requiredString(asObject(payload), "user")) })
      .register("tokens.list", { capability: "users.manage", handler: () => this.listTokens() })
      .register("tokens.create", { capability: "users.manage", handler: (_context, payload) => this.createToken(payload) })
      .register("tokens.revoke", { capability: "users.manage", handler: (_context, payload) => this.revokeToken(requiredString(asObject(payload), "tokenId")) })
      .register("projectTokens.list", { capability: "projects.read", projectRequired: true, handler: (context) => this.listProjectTokens(context.projectId!) })
      .register("projectTokens.get", { capability: "projects.read", projectRequired: true, handler: (context, payload) => this.getProjectToken(context.projectId!, requiredString(asObject(payload), "tokenId")) })
      .register("projectTokens.create", { capability: "projects.update", projectRequired: true, mutation: true, handler: (context, payload) => this.createProjectToken(context, payload) })
      .register("projectTokens.update", { capability: "projects.update", projectRequired: true, mutation: true, handler: (context, payload) => this.updateProjectToken(context.projectId!, payload) })
      .register("projectTokens.revoke", { capability: "projects.update", projectRequired: true, mutation: true, handler: (context, payload) => this.revokeProjectToken(context.projectId!, requiredString(asObject(payload), "tokenId")) })
      .register("mcpTokens.list", { capability: "users.manage", handler: () => this.listMcpTokens() })
      .register("mcpTokens.create", { capability: "users.manage", mutation: true, handler: (context, payload) => this.createMcpToken(context, payload) })
      .register("mcpTokens.revoke", { capability: "users.manage", mutation: true, handler: (_context, payload) => this.revokeMcpToken(requiredString(asObject(payload), "tokenId")) })
      .register("files.list", { capability: "files.read", projectRequired: true, handler: async (context, payload) => (await this.projectStore(context.projectId!).list(optionalString(asObject(payload), "path") ?? "project:/")) as unknown as JsonValue })
      .register("files.stat", { capability: "files.read", projectRequired: true, handler: async (context, payload) => (await this.projectStore(context.projectId!).stat(requiredString(asObject(payload), "path"))) as unknown as JsonValue })
      .register("files.read", { capability: "files.read", projectRequired: true, handler: async (context, payload) => {
        const bytes = await this.projectStore(context.projectId!).read(requiredString(asObject(payload), "path"));
        return { encoding: "base64", data: bytes.toBase64(), size: bytes.length };
      } })
      .register("files.write", { capability: "files.write", projectRequired: true, handler: async (context, payload) => {
        const input = asObject(payload);
        const content = requiredString(input, "content");
        const path = requiredString(input, "path");
        const result = await this.projectStore(context.projectId!).write(path, content, {
          actorId: context.session.principal.id,
          ...(typeof input.expectedRevision === "number" ? { expectedRevision: input.expectedRevision } : {}),
        });
        this.markProjectSourcesDirty(context.projectId!, path);
        return result as unknown as JsonValue;
      } })
      .register("files.mkdir", { capability: "files.write", projectRequired: true, handler: async (context, payload) => (await this.projectStore(context.projectId!).mkdir(requiredString(asObject(payload), "path"), context.session.principal.id)) as unknown as JsonValue })
      .register("files.move", { capability: "files.write", projectRequired: true, handler: async (context, payload) => {
        const input = asObject(payload);
        const from = requiredString(input, "from");
        const to = requiredString(input, "to");
        await this.projectStore(context.projectId!).move(from, to, context.session.principal.id);
        this.markProjectSourcesDirty(context.projectId!, from);
        this.markProjectSourcesDirty(context.projectId!, to);
        return { from, to, moved: true };
      } })
      .register("files.copy", { capability: "files.write", projectRequired: true, handler: async (context, payload) => {
        const input = asObject(payload);
        const result = await this.projectStore(context.projectId!).copy(requiredString(input, "from"), requiredString(input, "to"), context.session.principal.id);
        this.markProjectSourcesDirty(context.projectId!, requiredString(input, "to"));
        return result as unknown as JsonValue;
      } })
      .register("files.trash", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.trashProjectFile(context.projectId!, context.session.principal.id, requiredString(asObject(payload), "path")) })
      .register("files.restore", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.restoreProjectFile(context.projectId!, context.session.principal.id, requiredString(asObject(payload), "trashId")) })
      .register("files.search", { capability: "files.read", projectRequired: true, handler: async (context, payload) => (await this.projectStore(context.projectId!).search(requiredString(asObject(payload), "query"))) as unknown as JsonValue })
      .register("files.watch", { capability: "files.read", projectRequired: true, handler: (context, payload) => this.watchProjectFiles(context.projectId!, payload) })
      .register("files.sync.open", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.openSyncSession(context.projectId!, payload) })
      .register("files.sync.list", { capability: "files.read", projectRequired: true, handler: (context) => this.listSyncSessions(context.projectId!) })
      .register("files.sync.update", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.updateSyncSession(context.projectId!, payload) })
      .register("files.sync.complete", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.closeSyncSession(context.projectId!, requiredString(asObject(payload), "syncId"), "completed") })
      .register("files.sync.stop", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.closeSyncSession(context.projectId!, requiredString(asObject(payload), "syncId"), "stopped") })
      .register("uploads.open", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.openUpload(context.projectId!, payload) })
      .register("uploads.chunk", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.writeUploadChunk(context.projectId!, payload) })
      .register("uploads.resume", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.getUpload(context.projectId!, requiredString(asObject(payload), "uploadId")) })
      .register("uploads.commit", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.commitUpload(context.projectId!, context.session.principal.id, payload) })
      .register("uploads.abort", { capability: "files.write", projectRequired: true, handler: (context, payload) => this.abortUpload(context.projectId!, requiredString(asObject(payload), "uploadId")) })
      .register("secrets.list", { capability: "secrets.manage", handler: (context) => this.secrets.list(context.projectId) as unknown as JsonValue })
      .register("secrets.show", { capability: "secrets.manage", handler: (context, payload) => this.secrets.show(requiredString(asObject(payload), "name"), context.projectId) as unknown as JsonValue })
      .register("secrets.set", { capability: "secrets.manage", handler: async (context, payload) => {
        const input = asObject(payload);
        return await this.secrets.set(requiredString(input, "name"), requiredString(input, "value"), context.projectId) as unknown as JsonValue;
      } })
      .register("secrets.revoke", { capability: "secrets.manage", handler: (context, payload) => this.secrets.revoke(requiredString(asObject(payload), "name"), context.projectId) as unknown as JsonValue })
      .register("providers.catalog", { capability: "providers.manage", handler: () => listProviderCatalog() as unknown as JsonValue })
      .register("providers.list", { capability: "providers.manage", handler: () => this.listProviders() })
      .register("providers.add", { capability: "providers.manage", handler: (_context, payload) => this.addProvider(payload) })
      .register("providers.test", { capability: "providers.manage", handler: (_context, payload) => this.testProvider(requiredString(asObject(payload), "provider")) })
      .register("providers.models", { capability: "providers.manage", handler: (_context, payload) => this.providerModels(requiredString(asObject(payload), "provider")) })
      .register("modelRoles.list", { capability: "providers.manage", handler: () => this.listModelRoles() })
      .register("modelRoles.set", { capability: "providers.manage", handler: (_context, payload) => this.setModelRole(payload) })
      .register("modelRoles.delete", { capability: "providers.manage", handler: (_context, payload) => this.deleteModelRole(requiredString(asObject(payload), "role")) })
      .register("configuration.defaultLlm.get", { capability: "providers.manage", handler: () => this.defaultLlmConfiguration() })
      .register("configuration.defaultLlm.set", { capability: "providers.manage", mutation: true, handler: (_context, payload) => this.configureDefaultLlm(payload) })
      .register("agents.list", { capability: "agents.read", projectRequired: true, handler: (context) => this.repositories.listAgentDefinitions(context.projectId) as unknown as JsonValue })
      .register("authValidators.list", { capability: "agents.read", projectRequired: true, handler: (context) => this.listAuthValidators(context.projectId!) })
      .register("authValidators.get", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.authValidatorJson(this.requiredAuthValidator(context.projectId!, requiredString(asObject(payload), "validator")), true) })
      .register("authValidators.versions", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.listAuthValidatorVersions(context.projectId!, requiredString(asObject(payload), "validator")) })
      .register("authValidators.createFromProjectSource", { capability: "agents.manage", projectRequired: true, handler: (context, payload) => this.buildAuthValidator(context, payload) })
      .register("authValidators.activate", { capability: "agents.manage", projectRequired: true, handler: (context, payload) => this.activateAuthValidator(context.projectId!, payload) })
      .register("authValidators.disable", { capability: "agents.manage", projectRequired: true, handler: (context, payload) => this.disableAuthValidator(context.projectId!, requiredString(asObject(payload), "validator")) })
      .register("authValidators.test", { capability: "agents.manage", projectRequired: true, handler: (context, payload) => this.testAuthValidator(context.projectId!, payload) })
      .register("agents.get", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.requiredAgent(context.projectId!, requiredString(asObject(payload), "agent")) as unknown as JsonValue })
      .register("agents.versions", { capability: "agents.read", projectRequired: true, handler: (context, payload) => {
        const agent = this.requiredAgent(context.projectId!, requiredString(asObject(payload), "agent"));
        return this.repositories.listAgentVersions(agent.agentId) as unknown as JsonValue;
      } })
      .register("agents.compiled", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.compiledAgent(context.projectId!, payload) })
      .register("agents.diff", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.agentSourceStatus(context.projectId!, requiredString(asObject(payload), "agent")) })
      .register("agents.apply", { capability: "agents.create", projectRequired: true, handler: (context, payload) => {
        const agent = this.requiredAgent(context.projectId!, requiredString(asObject(payload), "agent"));
        if (agent.sourcePath === undefined) throw serviceError("AGENT_SOURCE_MISSING", "Agent has no registered source path");
        return this.buildAgent(context, { sourcePath: agent.sourcePath, sourceKind: agent.sourcePath.endsWith(".md") ? "markdown" : "sdk", activate: true });
      } })
      .register("agents.instances", { capability: "agents.read", projectRequired: true, handler: (context, payload) => {
        const agent = this.requiredAgent(context.projectId!, requiredString(asObject(payload), "agent"));
        return this.listInstances(context.projectId!, agent.agentId);
      } })
      .register("agents.contract", { capability: "agents.read", projectRequired: true, handler: (context, payload) => {
        const agent = this.requiredAgent(context.projectId!, requiredString(asObject(payload), "agent"));
        if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Agent has no active version");
        const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
        if (manifest === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", "Active AgentVersion manifest is unavailable");
        return publicManifest(manifest) as unknown as JsonValue;
      } })
      .register("agents.generateInputExample", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.generateAgentInputExample(context, payload) })
      .register("agents.setApiAccess", { capability: "agents.activate", projectRequired: true, mutation: true, handler: (context, payload) => this.setAgentApiAccess(context, payload) })
      .register("agents.asset", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.readAgentAsset(context.projectId!, payload) })
      .register("agents.createFromProjectSource", { capability: "agents.create", projectRequired: true, handler: (context, payload) => this.buildAgent(context, payload) })
      .register("agents.generateMarkdown", { capability: "agents.create", projectRequired: true, mutation: true, handler: (context, payload) => this.startAgentGeneration(context, payload) })
      .register("agents.plan", { capability: "agents.read", projectRequired: true, mutation: true, handler: (context, payload) => this.startAgentPlan(context, payload) })
      .register("agents.generationProgress", { capability: "agents.create", projectRequired: true, handler: (context, payload) => this.getAgentGenerationProgress(context, payload) })
      .register("agentActivities.get", { capability: "projects.read", handler: (context, payload) => this.getAgentActivity(context, payload) })
      .register("agents.activate", { capability: "agents.activate", projectRequired: true, handler: (context, payload) => this.activateAgent(context.projectId!, payload) })
      .register("agents.disable", { capability: "agents.activate", projectRequired: true, handler: (context, payload) => this.disableAgent(context.projectId!, requiredString(asObject(payload), "agent")) })
      .register("agents.start", { capability: "agents.start", projectRequired: true, handler: (context, payload) => this.startResident(context.projectId!, requiredString(asObject(payload), "agent")) })
      .register("agents.stop", { capability: "agents.start", projectRequired: true, handler: (context, payload) => this.stopResident(context.projectId!, requiredString(asObject(payload), "agent")) })
      .register("agents.restart", { capability: "agents.start", projectRequired: true, handler: async (context, payload) => {
        const agent = requiredString(asObject(payload), "agent");
        await this.stopResident(context.projectId!, agent, false);
        return this.startResident(context.projectId!, agent);
      } })
      .register("agents.invokeExternal", { capability: "runs.invoke", projectRequired: true, mutation: true, handler: (context, payload) => this.invokeExternal(context, payload) })
      .register("tools.list", { capability: "agents.read", projectRequired: true, handler: (context, payload) => this.listTools(context.projectId!, payload) })
      .register("runs.invoke", { capability: "runs.invoke", projectRequired: true, handler: (context, payload) => this.invoke(context, payload) })
      .register("runs.get", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.requiredRun(context.projectId!, requiredString(asObject(payload), "runId")) as unknown as JsonValue })
      .register("runs.list", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.repositories.listRuns(context.projectId, numberOr(asObject(payload).limit, 100)) as unknown as JsonValue })
      .register("runs.cancel", { capability: "runs.cancel", projectRequired: true, handler: (context, payload) => this.cancel(context, payload) as unknown as JsonValue })
      .register("runs.checkpoints", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.listCheckpoints(context.projectId!, requiredString(asObject(payload), "runId")) })
      .register("runs.graph", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.getExecutionGraph(context.projectId!, requiredString(asObject(payload), "runId")) })
      .register("runs.attach", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.attachmentSnapshot(context.projectId!, "run", requiredString(asObject(payload), "runId"), payload) })
      .register("conversations.list", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.listConversations(context.projectId!, payload) })
      .register("conversations.get", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.getConversation(context.projectId!, requiredString(asObject(payload), "conversationId")) })
      .register("conversations.messages", { capability: "runs.read", projectRequired: true, handler: (context, payload) => {
        const input = asObject(payload);
        this.getConversation(context.projectId!, requiredString(input, "conversationId"));
        return this.conversationMessages(requiredString(input, "conversationId"), numberOr(input.limit, 100), typeof input.beforeSequence === "number" ? input.beforeSequence : undefined);
      } })
      .register("conversations.clear", { capability: "runs.cancel", projectRequired: true, handler: (context, payload) => this.clearConversation(context.projectId!, requiredString(asObject(payload), "conversationId")) })
      .register("messages.list", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.listMessages(context.projectId!, payload) })
      .register("messages.send", { capability: "runs.invoke", projectRequired: true, handler: (context, payload) => this.sendMessage(context.projectId!, { principalId: context.session.principal.id }, payload) })
      .register("messages.ack", { capability: "runs.invoke", projectRequired: true, handler: (context, payload) => this.ackMessage(context.projectId!, requiredString(asObject(payload), "messageId")) })
      .register("events.publish", { capability: "runs.invoke", projectRequired: true, handler: (context, payload) => this.publishEvent(context.projectId!, payload, context.session.principal.id) })
      .register("approvals.list", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.listApprovals(context.projectId!, payload) })
      .register("approvals.decide", { capability: "runs.cancel", projectRequired: true, handler: (context, payload) => this.decideApproval(context.projectId!, context.session.principal.id, payload) })
      .register("processes.list", { capability: "runs.read", handler: (context, payload) => this.listProcesses(context.projectId, payload) })
      .register("processes.top", { capability: "runs.read", handler: (context, payload) => this.processTop(context.projectId, payload) })
      .register("processes.get", { capability: "runs.read", handler: (context, payload) => this.getProcess(requiredString(asObject(payload), "mpid"), context.projectId) })
      .register("processes.attach", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.attachmentSnapshot(context.projectId!, "process", requiredString(asObject(payload), "mpid"), payload) })
      .register("processes.kill", { capability: "agents.kill", handler: (context, payload) => this.killProcess(requiredString(asObject(payload), "mpid"), context.projectId) })
      .register("artifacts.list", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.listArtifacts(context.projectId!, optionalString(asObject(payload), "runId")) })
      .register("artifacts.read", { capability: "runs.read", projectRequired: true, handler: (context, payload) => this.readArtifact(context.projectId!, requiredString(asObject(payload), "artifactId")) })
      .register("events.list", { capability: "audit.read", projectRequired: true, handler: (context, payload) => this.listEvents(context.projectId!, payload) })
      .register("logs.list", { capability: "audit.read", projectRequired: true, handler: (context, payload) => this.listLogs(context.projectId!, payload) })
      .register("audit.list", { capability: "audit.read", projectRequired: true, handler: (context, payload) => this.listAudit(context.projectId!, payload) })
      .register("assistant.chat", { capability: "projects.read", mutation: true, handler: (context, payload) => this.startAssistantChat(context, payload) });
  }

  private startScheduler(): void {
    void this.runScheduleTick(new Date());
    void this.dispatchAvailableMessages();
    this.schedulerTimer = setInterval(() => {
      void this.runScheduleTick(new Date());
      void this.dispatchAvailableMessages();
    }, 1_000);
    this.schedulerTimer.unref();
  }

  private async runScheduleTick(instant: Date): Promise<void> {
    if (this.schedulerTicking || this.closed || this.maintenance) return;
    this.schedulerTicking = true;
    const scheduledFor = `${instant.toISOString().slice(0, 16)}:00.000Z`;
    try {
      for (const agent of this.database.raw.query<{ project_id: string; agent_id: string; active_version_id: string }, []>(`SELECT project_id, agent_id, active_version_id
        FROM agent_definitions WHERE status='active' AND active_version_id IS NOT NULL`).all()) {
        const manifest = this.repositories.getAgentManifest(agent.active_version_id);
        for (const schedule of manifest?.entrypoints.schedules ?? []) {
          const scheduleKey = `${agent.active_version_id}:${schedule.id}`;
          try {
            validateCron(schedule.cron, schedule.timezone);
            if (!cronMatches(schedule.cron, schedule.timezone, instant)) continue;
            const firingId = `firing_${Bun.randomUUIDv7()}`;
            const inserted = this.database.raw.query(`INSERT OR IGNORE INTO schedule_firings(firing_id, schedule_key, project_id, agent_id, agent_version_id, scheduled_for, run_id, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, NULL, 'admitting', ?)`).run(firingId, scheduleKey, agent.project_id, agent.agent_id, agent.active_version_id, scheduledFor, new Date().toISOString());
            if (inserted.changes !== 1) continue;
            const handle = this.kernel.invokeAgent({
              projectId: agent.project_id,
              agentId: agent.agent_id,
              entrypoint: "schedule",
              input: schedule.input ?? {},
              principal: { id: "marcus-scheduler", type: "service-account", claims: { scheduleId: schedule.id } },
              idempotencyKey: `schedule:${scheduleKey}:${scheduledFor}`,
            });
            this.database.raw.query("UPDATE schedule_firings SET run_id=?, status='accepted' WHERE firing_id=?").run(handle.runId, firingId);
            const traceId = createId("trace");
            this.repositories.appendKernelEvent({
              eventType: "schedule.fired",
              nodeId: this.config.nodeId,
              projectId: agent.project_id,
              agentId: agent.agent_id,
              runId: handle.runId,
              correlationId: traceId,
              traceId,
              payload: { scheduleId: schedule.id, scheduledFor },
            });
          } catch (error) {
            this.database.raw.query(`UPDATE schedule_firings SET status='failed', error_json=? WHERE schedule_key=? AND scheduled_for=?`)
              .run(JSON.stringify({ code: error instanceof MarcusError ? error.code : "SCHEDULE_FAILED", message: error instanceof Error ? error.message : String(error) }), scheduleKey, scheduledFor);
          }
        }
      }
      this.kickDispatcher();
    } finally {
      this.schedulerTicking = false;
    }
  }

  private listSchedules(projectId: string): JsonValue {
    const schedules: JsonValue[] = [];
    for (const agent of this.repositories.listAgentDefinitions(projectId)) {
      if (agent.activeVersionId === undefined) continue;
      const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
      for (const schedule of manifest?.entrypoints.schedules ?? []) {
        schedules.push({ agentId: agent.agentId, agent: agent.slug, agentVersionId: agent.activeVersionId, ...schedule });
      }
    }
    return schedules;
  }

  private triggerSchedule(projectId: string, payload: JsonValue, principal: Principal): JsonValue {
    const input = asObject(payload);
    const agent = this.requiredAgent(projectId, requiredString(input, "agent"));
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Scheduled agent has no active version");
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    const scheduleId = requiredString(input, "scheduleId");
    const schedule = manifest?.entrypoints.schedules?.find((candidate) => candidate.id === scheduleId);
    if (schedule === undefined) throw serviceError("SCHEDULE_NOT_FOUND", `Schedule ${scheduleId} not found`);
    validateCron(schedule.cron, schedule.timezone);
    const handle = this.kernel.invokeAgent({ projectId, agentId: agent.agentId, entrypoint: "schedule", input: (input.input ?? schedule.input ?? {}) as JsonValue, principal });
    this.kickDispatcher();
    return handle as unknown as JsonValue;
  }

  private reconcileStartup(): void {
    const now = new Date().toISOString();
    const interrupted = this.database.raw.query<{ run_id: string; project_id: string; agent_id: string; correlation_id: string; trace_id: string }, []>(`SELECT run_id, project_id, agent_id, correlation_id, trace_id FROM runs
      WHERE state NOT IN ('completed','failed','cancelled','timed_out','killed')`).all();
    const interruptedTools = this.database.raw.query<ToolCallRow, []>("SELECT * FROM tool_calls WHERE state IN ('running','waiting_for_approval')").all();
    this.database.transaction(() => {
      this.database.raw.query(`UPDATE runs SET state='failed', result='failure', error_json=?, finished_at=?
        WHERE state NOT IN ('completed','failed','cancelled','timed_out','killed')`)
        .run(JSON.stringify({ code: "DAEMON_RESTARTED", message: "Run was interrupted by daemon restart", retryable: true }), now);
      this.database.raw.query(`UPDATE agent_instances SET state='orphaned', health='unknown', stopped_at=COALESCE(stopped_at, ?)
        WHERE state NOT IN ('stopped','failed','killed','zombie')`).run(now);
      this.database.raw.query(`UPDATE processes SET state='orphaned', health='unknown' WHERE state NOT IN ('stopped','failed','killed','zombie')`).run();
      this.database.raw.query("UPDATE approval_requests SET status='cancelled', resolved_at=? WHERE status='pending'").run(now);
      this.database.raw.query(`UPDATE tool_calls SET state='failed', error_json=?, finished_at=? WHERE state IN ('running','waiting_for_approval')`)
        .run(JSON.stringify({ code: "DAEMON_RESTARTED", message: "Tool call was interrupted by daemon restart", retryable: true }), now);
      this.database.raw.query("UPDATE execution_graphs SET status='failed', updated_at=? WHERE status='running'").run(now);
    });
    for (const run of interrupted) {
      this.repositories.appendKernelEvent({ eventType: "run.recovered_failed", nodeId: this.config.nodeId, projectId: run.project_id, agentId: run.agent_id, runId: run.run_id, correlationId: run.correlation_id, traceId: run.trace_id, occurredAt: now, payload: { reason: "daemon-restart" } });
    }
    for (const interruptedTool of interruptedTools) {
      const run = this.repositories.getRun(interruptedTool.run_id);
      if (run === undefined) continue;
      let tool = officialToolManifest(interruptedTool.tool_id);
      try { tool = this.versionTools(run.agentVersionId).find((candidate) => candidate.id === interruptedTool.tool_id) ?? tool; }
      catch { /* Keep startup recovery available for an old or corrupt manifest. */ }
      if (tool === undefined) continue;
      this.appendToolEvent(run, tool, interruptedTool.tool_call_id, "failed", {
        error: { code: "DAEMON_RESTARTED", message: "Tool call was interrupted by daemon restart", retryable: true },
        recovered: true,
      });
      this.auditToolCall(run, tool, interruptedTool.tool_call_id, "failure");
    }
  }

  private health(): JsonValue {
    return { status: "ok", nodeId: this.config.nodeId, database: this.database.integrityCheck().ok ? "healthy" : "degraded", schedulerReady: this.schedulerTimer !== undefined, activeRuns: this.activeRuns.size, residentInstances: this.residentInstances.size, realtime: { ...this.server.realtimeStats() } };
  }

  private canReceiveRealtime(principal: Principal, event: RealtimePublication): boolean {
    if (event.principalId !== undefined && event.principalId !== principal.id) return false;
    try {
      if (event.projectId !== undefined) this.authorization.assert(principal, "projects.read", event.projectId);
      else if (event.principalId === undefined) this.authorization.assert(principal, "users.manage");
      return true;
    } catch {
      return false;
    }
  }

  private async doctor(): Promise<JsonValue> {
    const paths: Record<string, JsonValue> = {};
    for (const [name, path] of Object.entries({ dataDir: this.config.dataDir, projectsDir: this.config.projectsDir, databasePath: this.config.databasePath, buildDir: this.config.buildDir })) {
      try { const info = await stat(path); paths[name] = { path, exists: true, directory: info.isDirectory() }; }
      catch { paths[name] = { path, exists: false }; }
    }
    const readiness = Object.fromEntries(["agent.default", "markdown.compiler", "markdown.reviewer", "kernel.evaluator", "embedding.default"]
      .map((role) => [role, this.getModelRole(role) !== undefined]));
    const latestBackup = this.database.raw.query<{ destination: string; status: string; completed_at: string | null }, []>("SELECT destination, status, completed_at FROM backup_records ORDER BY created_at DESC LIMIT 1").get();
    return { health: this.health(), paths, modelRoles: readiness, backup: latestBackup ?? { status: "never" } };
  }

  private systemOverview(context: CommandContext): JsonValue {
    const projects = this.listProjects(context, { status: "active" }) as unknown as ProjectRecord[];
    const visible = new Set(projects.map((project) => project.projectId));
    const totals = { projects: projects.length, files: 0, agents: 0, activeAgents: 0, runs24h: 0, failed24h: 0, pendingApprovals: 0, activeProcesses: 0 };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    for (const project of projects) {
      totals.files += this.database.raw.query<{ value: number }, [string]>(
        "SELECT COUNT(*) AS value FROM project_files WHERE project_id=? AND kind='file' AND deleted_at IS NULL",
      ).get(project.projectId)?.value ?? 0;
      const agents = this.repositories.listAgentDefinitions(project.projectId);
      totals.agents += agents.length;
      totals.activeAgents += agents.filter((agent) => agent.status === "active").length;
      totals.runs24h += this.database.raw.query<{ value: number }, [string, string]>(
        "SELECT COUNT(*) AS value FROM runs WHERE project_id=? AND accepted_at>=?",
      ).get(project.projectId, since)?.value ?? 0;
      totals.failed24h += this.database.raw.query<{ value: number }, [string, string]>(
        "SELECT COUNT(*) AS value FROM runs WHERE project_id=? AND accepted_at>=? AND state IN ('failed','timed_out','killed')",
      ).get(project.projectId, since)?.value ?? 0;
      totals.pendingApprovals += this.database.raw.query<{ value: number }, [string]>(
        "SELECT COUNT(*) AS value FROM approval_requests WHERE project_id=? AND status='pending'",
      ).get(project.projectId)?.value ?? 0;
      totals.activeProcesses += this.database.raw.query<{ value: number }, [string]>(
        "SELECT COUNT(*) AS value FROM processes WHERE project_id=? AND state NOT IN ('stopped','failed','killed','zombie','orphaned')",
      ).get(project.projectId)?.value ?? 0;
    }
    type RecentRunRow = {
      run_id: string; project_id: string; agent_id: string; agent_name: string; agent_slug: string;
      state: string; result: string; entrypoint: string; accepted_at: string; finished_at: string | null;
    };
    const recentRuns = this.database.raw.query<RecentRunRow, []>(`SELECT r.run_id, r.project_id, r.agent_id, a.name AS agent_name,
      a.slug AS agent_slug, r.state, r.result, r.entrypoint, r.accepted_at, r.finished_at
      FROM runs r JOIN agent_definitions a ON a.agent_id=r.agent_id ORDER BY r.accepted_at DESC LIMIT 250`).all()
      .filter((run) => visible.has(run.project_id)).slice(0, 12)
      .map((run) => ({
        runId: run.run_id,
        projectId: run.project_id,
        agentId: run.agent_id,
        agentName: run.agent_name,
        agentSlug: run.agent_slug,
        state: run.state,
        result: run.result,
        entrypoint: run.entrypoint,
        acceptedAt: run.accepted_at,
        ...(run.finished_at === null ? {} : { finishedAt: run.finished_at }),
      }));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const firstDay = new Date(today);
    firstDay.setUTCDate(firstDay.getUTCDate() - 13);
    const trend = Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(firstDay);
      date.setUTCDate(date.getUTCDate() + offset);
      const day = date.toISOString().slice(0, 10);
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 1);
      let runs = 0;
      let failed = 0;
      for (const project of projects) {
        const row = this.database.raw.query<{ runs: number; failed: number }, [string, string, string]>(`SELECT COUNT(*) AS runs,
          SUM(CASE WHEN state IN ('failed','timed_out','killed') THEN 1 ELSE 0 END) AS failed
          FROM runs WHERE project_id=? AND accepted_at>=? AND accepted_at<?`).get(project.projectId, date.toISOString(), next.toISOString());
        runs += row?.runs ?? 0;
        failed += row?.failed ?? 0;
      }
      return { day, runs, failed };
    });
    const systemAdmin = String(context.session.principal.claims?.systemRoles ?? "").split(",").includes("system_admin");
    const providers = systemAdmin
      ? this.database.raw.query<{ status: string; value: number }, []>("SELECT status, COUNT(*) AS value FROM providers GROUP BY status").all()
      : [];
    return {
      health: this.health(),
      totals,
      trend,
      recentRuns,
      ...(systemAdmin ? {
        providers: {
          total: providers.reduce((sum, row) => sum + row.value, 0),
          healthy: providers.filter((row) => row.status === "healthy").reduce((sum, row) => sum + row.value, 0),
        },
      } : {}),
      sampledAt: new Date().toISOString(),
    } as JsonValue;
  }

  private async systemLogs(payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const limit = Math.max(1, Math.min(numberOr(input.limit, 200), 1_000));
    const source = optionalString(input, "source")?.toLowerCase();
    const level = optionalString(input, "level")?.toLowerCase();
    const query = optionalString(input, "query")?.toLowerCase();
    const path = resolve(this.config.logsDir, "all.log");
    const file = Bun.file(path);
    if (!(await file.exists())) return { entries: [], sampledAt: new Date().toISOString() };
    const maxBytes = 4 * 1024 * 1024;
    const text = await file.slice(Math.max(0, file.size - maxBytes), file.size).text();
    const entries = text.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as JsonValue;
        if (!isJsonObject(value)) return [];
        if (source !== undefined && String(value.source ?? "").toLowerCase() !== source) return [];
        if (level !== undefined && String(value.level ?? "").toLowerCase() !== level) return [];
        if (query !== undefined && !line.toLowerCase().includes(query)) return [];
        return [value];
      } catch {
        return [];
      }
    }).slice(-limit).reverse();
    return { entries, truncated: file.size > maxBytes, sampledAt: new Date().toISOString() } as JsonValue;
  }

  private listDocumentation(): JsonValue {
    return Object.entries(marcusDocumentation).map(([name, content]) => ({ name, bytes: new TextEncoder().encode(content).byteLength })) as JsonValue;
  }

  private readDocumentation(name: string): JsonValue {
    const normalized = name.toUpperCase().endsWith(".MD") ? name.toUpperCase() : `${name.toUpperCase()}.MD`;
    const match = Object.entries(marcusDocumentation).find(([documentName]) => documentName.toUpperCase() === normalized);
    if (match === undefined) throw serviceError("DOCUMENTATION_NOT_FOUND", `Documentation ${name} not found`);
    return { name: match[0], content: match[1] } as JsonValue;
  }

  private searchDocumentation(payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const query = requiredString(input, "query").trim();
    if (query.length < 2 || query.length > 200) throw serviceError("DOCUMENTATION_QUERY_INVALID", "Documentation query must contain between 2 and 200 characters");
    const needle = query.toLowerCase();
    const limit = Math.max(1, Math.min(numberOr(input.limit, 50), 200));
    const results: JsonValue[] = [];
    for (const [name, content] of Object.entries(marcusDocumentation)) {
      for (const [index, line] of content.split("\n").entries()) {
        if (!line.toLowerCase().includes(needle)) continue;
        results.push({ name, line: index + 1, text: line.trim().slice(0, 500) });
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  private async systemSearch(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const query = requiredString(input, "query").trim();
    if (query.length < 2 || query.length > 200) throw serviceError("SEARCH_QUERY_INVALID", "Search query must contain between 2 and 200 characters");
    const limit = Math.max(1, Math.min(numberOr(input.limit, 80), 200));
    const needle = query.toLowerCase();
    const projects = this.listProjects(context, {}) as unknown as ProjectRecord[];
    const results: JsonValue[] = [];
    for (const project of projects) {
      if (`${project.name} ${project.slug} ${project.projectId}`.toLowerCase().includes(needle)) {
        results.push({ kind: "project", projectId: project.projectId, title: project.name, detail: project.slug });
      }
      for (const agent of this.repositories.listAgentDefinitions(project.projectId)) {
        if (`${agent.name} ${agent.slug} ${agent.description ?? ""} ${agent.agentId}`.toLowerCase().includes(needle)) {
          results.push({ kind: "agent", projectId: project.projectId, agent: agent.slug, title: agent.name, detail: agent.description ?? agent.slug });
        }
      }
      type RunSearchRow = { run_id: string; agent_id: string; state: string; trace_id: string; accepted_at: string };
      for (const run of this.database.raw.query<RunSearchRow, [string, string, string, string, string, number]>(`SELECT run_id, agent_id, state, trace_id, accepted_at FROM runs
        WHERE project_id=? AND (lower(run_id) LIKE ? OR lower(agent_id) LIKE ? OR lower(state) LIKE ? OR lower(trace_id) LIKE ?)
        ORDER BY accepted_at DESC LIMIT ?`).all(project.projectId, `%${needle}%`, `%${needle}%`, `%${needle}%`, `%${needle}%`, 20)) {
        results.push({ kind: "run", projectId: project.projectId, runId: run.run_id, title: run.run_id, detail: `${run.state} · ${run.accepted_at}` });
      }
      if (results.length < limit) {
        const fileMatches = await this.projectStore(project.projectId).search(query, { maxFiles: 300, maxBytesPerFile: 512 * 1024 });
        for (const match of fileMatches.slice(0, 30)) {
          results.push({ kind: "file", projectId: project.projectId, path: match.path, line: match.line, title: match.path, detail: match.text.trim().slice(0, 300) });
        }
      }
      if (results.length >= limit) break;
    }
    for (const match of this.searchDocumentation({ query, limit: Math.max(1, limit - results.length) }) as JsonValue[]) {
      if (results.length >= limit) break;
      const entry = asObject(match);
      results.push({ kind: "documentation", title: requiredString(entry, "name"), line: numberOr(entry.line, 0), detail: requiredString(entry, "text") });
    }
    return { query, results: results.slice(0, limit), sampledAt: new Date().toISOString() } as JsonValue;
  }

  private listBackups(): JsonValue {
    type Row = { backup_id: string; destination: string; status: string; manifest_json: string; created_at: string; completed_at: string | null };
    return this.database.raw.query<Row, []>("SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 100").all()
      .map((row) => ({ backupId: row.backup_id, destination: row.destination, status: row.status, manifest: JSON.parse(row.manifest_json), createdAt: row.created_at, ...(row.completed_at === null ? {} : { completedAt: row.completed_at }) })) as unknown as JsonValue;
  }

  private listProjects(context: CommandContext, payload: JsonValue): JsonValue {
    const status = optionalString(asObject(payload), "status");
    if (status !== undefined && status !== "active" && status !== "archived") {
      throw serviceError("PROJECT_STATUS_INVALID", "Project status filter must be active or archived");
    }
    const systemRoles = String(context.session.principal.claims?.systemRoles ?? "").split(",");
    const allowedProjectIds = systemRoles.includes("system_admin")
      ? undefined
      : new Set(this.database.raw.query<{ project_id: string }, [string]>(
        "SELECT project_id FROM project_memberships WHERE user_id=?",
      ).all(context.session.principal.id).map((row) => row.project_id));
    return this.repositories.listProjects()
      .filter((project) => allowedProjectIds === undefined || allowedProjectIds.has(project.projectId))
      .filter((project) => status === undefined || project.status === status) as unknown as JsonValue;
  }

  private projectDashboard(projectId: string): JsonValue {
    const fileCount = this.database.raw.query<{ value: number }, [string]>(
      "SELECT COUNT(*) AS value FROM project_files WHERE project_id=? AND kind='file' AND deleted_at IS NULL",
    ).get(projectId)?.value ?? 0;
    const agents = this.repositories.listAgentDefinitions(projectId);
    const activeAgents = agents.filter((agent) => agent.status === "active").length;
    const apiAgents = agents.filter((agent) =>
      agent.activeVersionId !== undefined && this.repositories.getAgentManifest(agent.activeVersionId)?.entrypoints.api?.enabled === true,
    ).length;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const firstDay = new Date(today);
    firstDay.setUTCDate(firstDay.getUTCDate() - 29);
    type RunDay = { day: string; runs: number; completed: number; failed: number };
    const rows = this.database.raw.query<RunDay, [string, string]>(`SELECT substr(accepted_at, 1, 10) AS day,
      COUNT(*) AS runs,
      SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN state IN ('failed','timed_out','killed') THEN 1 ELSE 0 END) AS failed
      FROM runs WHERE project_id=? AND accepted_at>=? GROUP BY substr(accepted_at, 1, 10) ORDER BY day`).all(projectId, firstDay.toISOString());
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const consumption = Array.from({ length: 30 }, (_, offset) => {
      const date = new Date(firstDay);
      date.setUTCDate(date.getUTCDate() + offset);
      const day = date.toISOString().slice(0, 10);
      return byDay.get(day) ?? { day, runs: 0, completed: 0, failed: 0 };
    });
    return {
      files: fileCount,
      agents: agents.length,
      activeAgents,
      apiAgents,
      runs: consumption.reduce((total, day) => total + day.runs, 0),
      consumption,
    } as JsonValue;
  }

  private async createBackup(destination: string): Promise<JsonValue> {
    if (this.maintenance) throw serviceError("MAINTENANCE_ACTIVE", "A maintenance operation is already active");
    if (this.activeRuns.size > 0 || this.activeExecutions.size > 0 || this.pendingApprovals.size > 0) {
      throw serviceError("BACKUP_WORKLOAD_ACTIVE", "Backup requires no active Runs or approvals");
    }
    this.maintenance = true;
    const backupId = `backup_${Bun.randomUUIDv7()}`;
    const createdAt = new Date().toISOString();
    this.database.raw.query("INSERT INTO backup_records(backup_id, destination, status, manifest_json, created_at) VALUES (?, ?, 'creating', '{}', ?)")
      .run(backupId, destination, createdAt);
    try {
      const backup = await createMarcusBackup(this.config, this.database, destination);
      const completedAt = new Date().toISOString();
      this.database.raw.query("UPDATE backup_records SET status='completed', destination=?, manifest_json=?, completed_at=? WHERE backup_id=?")
        .run(backup.destination, JSON.stringify(backup.manifest), completedAt, backupId);
      return { backupId, destination: backup.destination, status: "completed", completedAt, manifest: backup.manifest } as unknown as JsonValue;
    } catch (error) {
      this.database.raw.query("UPDATE backup_records SET status='failed', completed_at=? WHERE backup_id=?").run(new Date().toISOString(), backupId);
      throw error;
    } finally {
      this.maintenance = false;
    }
  }

  private updateProject(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const name = optionalString(input, "name");
    if (name === undefined) throw serviceError("REQUEST_PAYLOAD_INVALID", "name is required");
    this.database.raw.query("UPDATE projects SET name=?, updated_at=? WHERE project_id=?").run(name, new Date().toISOString(), projectId);
    return this.requiredProject(projectId) as unknown as JsonValue;
  }

  private archiveProject(projectId: string): JsonValue {
    this.database.raw.query("UPDATE projects SET status='archived', updated_at=? WHERE project_id=?").run(new Date().toISOString(), projectId);
    return this.requiredProject(projectId) as unknown as JsonValue;
  }

  private async deleteProject(projectId: string): Promise<JsonValue> {
    if (this.maintenance) throw serviceError("MAINTENANCE_ACTIVE", "A maintenance operation is already active");
    const project = this.requiredProject(projectId);
    this.maintenance = true;
    try {
      const activeRunIds = this.database.raw.query<{ run_id: string }, [string]>(`SELECT run_id FROM runs WHERE project_id=?
        AND state NOT IN ('completed','failed','cancelled','timed_out','killed')`).all(projectId).map((row) => row.run_id);
      const activeExecutionIds = [...this.activeExecutions.keys()].filter((runId) => this.repositories.getRun(runId)?.projectId === projectId);
      const startingResidents = [...this.residentStarts.keys()].filter((versionId) => {
        const agentId = this.repositories.getAgentVersion(versionId)?.agentId;
        return agentId !== undefined && this.repositories.getAgentDefinition(agentId)?.projectId === projectId;
      });
      if (activeRunIds.length > 0 || activeExecutionIds.length > 0 || startingResidents.length > 0 || this.schedulerTicking || this.messageDispatching) {
        throw serviceError("PROJECT_DELETE_WORKLOAD_ACTIVE", "Cancel active Project Runs and wait for background dispatch before deleting the Project");
      }
      const residents = [...this.residentInstances.values()].filter((resident) => resident.projectId === projectId);
      await Promise.all(residents.map((resident) => this.stopResidentInstance(resident, "stopped")));
      const deleted = this.repositories.deleteProject(projectId);
      this.fileStores.delete(projectId);
      let homeDeleted = false;
      if (deleted.home?.mode === "managed") {
        await rm(deleted.home.physicalPath, { recursive: true, force: true });
        homeDeleted = true;
      }
      return {
        projectId: project.projectId,
        slug: project.slug,
        deleted: true,
        deletedRows: deleted.deletedRows,
        projectHome: deleted.home === undefined ? "missing" : deleted.home.mode,
        homeDeleted,
      };
    } finally {
      this.maintenance = false;
    }
  }

  private listUsers(): JsonValue {
    type Row = { user_id: string; username: string; status: string; created_at: string; updated_at: string; roles: string | null };
    return this.database.raw.query<Row, []>(`SELECT u.*, GROUP_CONCAT(r.role) AS roles FROM users u LEFT JOIN user_roles r ON r.user_id=u.user_id
      GROUP BY u.user_id ORDER BY u.username`).all().map((row) => ({ userId: row.user_id, username: row.username, status: row.status, roles: row.roles?.split(",") ?? [], createdAt: row.created_at, updatedAt: row.updated_at })) as unknown as JsonValue;
  }

  private async createUser(payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const roles = input.systemAdmin === true ? ["system_admin" as const] : [];
    const principal = await this.authentication.createUser({ username: requiredString(input, "username"), password: requiredString(input, "password"), roles });
    return { userId: principal.id, username: principal.claims?.username ?? null };
  }

  private async changeOwnPassword(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    await this.authentication.changePassword(
      context.session.principal.id,
      requiredString(input, "currentPassword"),
      requiredString(input, "password"),
    );
    return { userId: context.session.principal.id, changed: true };
  }

  private disableUser(reference: string): JsonValue {
    const user = this.requiredUser(reference);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.raw.query("UPDATE users SET status='disabled', updated_at=? WHERE user_id=?").run(now, user.user_id);
      this.database.raw.query("UPDATE access_tokens SET revoked_at=COALESCE(revoked_at, ?) WHERE user_id=?").run(now, user.user_id);
    });
    return { userId: user.user_id, username: user.username, status: "disabled" };
  }

  private listTokens(): JsonValue {
    type Row = { token_id: string; user_id: string | null; token_type: string; scopes_json: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; created_at: string };
    return this.database.raw.query<Row, []>("SELECT token_id, user_id, token_type, scopes_json, expires_at, revoked_at, last_used_at, created_at FROM access_tokens ORDER BY created_at DESC").all()
      .map((row) => ({ tokenId: row.token_id, ...(row.user_id === null ? {} : { userId: row.user_id }), type: row.token_type, scopes: parseStringArray(row.scopes_json), ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }), ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }), ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at }), createdAt: row.created_at })) as unknown as JsonValue;
  }

  private createToken(payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const type = input.type === "service-account-token" ? "service-account-token" : "personal-access-token";
    const user = optionalString(input, "user");
    const userId = user === undefined ? undefined : this.requiredUser(user).user_id;
    if (type === "personal-access-token" && userId === undefined) throw serviceError("TOKEN_USER_REQUIRED", "Personal access tokens require a user");
    return this.authentication.issueToken({
      ...(userId === undefined ? {} : { userId }),
      type,
      scopes: stringArray(input.scopes ?? []),
      ...(optionalString(input, "expiresAt") === undefined ? {} : { expiresAt: optionalString(input, "expiresAt")! }),
    }) as unknown as JsonValue;
  }

  private revokeToken(tokenId: string): JsonValue {
    const exists = this.database.raw.query<{ value: number }, [string]>("SELECT COUNT(*) AS value FROM access_tokens WHERE token_id=?").get(tokenId)?.value ?? 0;
    if (exists === 0) throw serviceError("TOKEN_NOT_FOUND", `Token ${tokenId} not found`);
    this.authentication.revokeToken(tokenId);
    return { tokenId, revoked: true };
  }

  private listProjectTokens(projectId: string): JsonValue {
    return this.database.raw.query<ProjectTokenRow, [string]>(`SELECT token_id, label, scopes_json, expires_at, revoked_at, last_used_at, created_at
      FROM access_tokens WHERE project_id=? ORDER BY created_at DESC`).all(projectId).map(projectTokenMetadata) as unknown as JsonValue;
  }

  private getProjectToken(projectId: string, tokenId: string): JsonValue {
    const row = this.requiredProjectToken(projectId, tokenId);
    return projectTokenMetadata(row) as unknown as JsonValue;
  }

  private requiredProjectToken(projectId: string, tokenId: string): ProjectTokenRow {
    const row = this.database.raw.query<ProjectTokenRow, [string, string]>(`SELECT token_id, label, scopes_json, expires_at, revoked_at, last_used_at, created_at
      FROM access_tokens WHERE token_id=? AND project_id=?`).get(tokenId, projectId);
    if (row === null) throw serviceError("TOKEN_NOT_FOUND", `Project token ${tokenId} not found`);
    return row;
  }

  private updateProjectToken(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const tokenId = requiredString(input, "tokenId");
    const current = this.requiredProjectToken(projectId, tokenId);
    if (current.revoked_at !== null) throw serviceError("TOKEN_REVOKED", `Project token ${tokenId} is revoked`);
    const hasLabel = Object.hasOwn(input, "label");
    const hasExpiresAt = Object.hasOwn(input, "expiresAt");
    if (!hasLabel && !hasExpiresAt) throw serviceError("TOKEN_UPDATE_EMPTY", "Token update requires label or expiresAt");
    const label = hasLabel ? requiredString(input, "label").trim() : current.label;
    if (label === null || label.length < 2 || label.length > 80) {
      throw serviceError("TOKEN_LABEL_INVALID", "Token label must contain between 2 and 80 characters");
    }
    let expiresAt: string | null = current.expires_at;
    if (hasExpiresAt) {
      const value = input.expiresAt;
      if (value !== null && typeof value !== "string") {
        throw serviceError("TOKEN_EXPIRY_INVALID", "Token expiration must be a future ISO date or null");
      }
      if (typeof value === "string" && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) {
        throw serviceError("TOKEN_EXPIRY_INVALID", "Token expiration must be a future date");
      }
      expiresAt = value;
    }
    this.database.raw.query("UPDATE access_tokens SET label=?, expires_at=? WHERE token_id=? AND project_id=?")
      .run(label, expiresAt, tokenId, projectId);
    return this.getProjectToken(projectId, tokenId);
  }

  private createProjectToken(context: CommandContext, payload: JsonValue): JsonValue {
    if (context.session.principal.type !== "user") throw serviceError("TOKEN_USER_REQUIRED", "Project API tokens require a user session");
    const input = asObject(payload);
    const label = requiredString(input, "label").trim();
    if (label.length < 2 || label.length > 80) throw serviceError("TOKEN_LABEL_INVALID", "Token label must contain between 2 and 80 characters");
    const expiresAt = optionalString(input, "expiresAt");
    if (expiresAt !== undefined && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw serviceError("TOKEN_EXPIRY_INVALID", "Token expiration must be a future date");
    }
    const hasApiAgent = this.repositories.listAgentDefinitions(context.projectId!).some((agent) =>
      agent.activeVersionId !== undefined && this.repositories.getAgentManifest(agent.activeVersionId)?.entrypoints.api?.enabled === true,
    );
    if (!hasApiAgent) throw serviceError("PROJECT_API_UNAVAILABLE", "Enable API access on at least one active agent before creating a token");
    return {
      ...this.authentication.issueToken({
        userId: context.session.principal.id,
        projectId: context.projectId!,
        label,
        type: "personal-access-token",
        scopes: ["runs.invoke", "runs.read"],
        ...(expiresAt === undefined ? {} : { expiresAt }),
      }),
      projectId: context.projectId!,
      label,
      scopes: ["runs.invoke", "runs.read"],
      ...(expiresAt === undefined ? {} : { expiresAt }),
    } as JsonValue;
  }

  private revokeProjectToken(projectId: string, tokenId: string): JsonValue {
    this.requiredProjectToken(projectId, tokenId);
    this.authentication.revokeToken(tokenId);
    return { tokenId, revoked: true };
  }

  private listMcpTokens(): JsonValue {
    type Row = { token_id: string; user_id: string; label: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; created_at: string };
    return this.database.raw.query<Row, []>(`SELECT token_id, user_id, label, expires_at, revoked_at, last_used_at, created_at
      FROM access_tokens WHERE project_id IS NULL AND token_type='personal-access-token' AND label LIKE 'mcp:%'
      ORDER BY created_at DESC`).all().map((row) => ({
      tokenId: row.token_id,
      userId: row.user_id,
      label: row.label.slice(4),
      status: row.revoked_at !== null ? "revoked" : row.expires_at !== null && Date.parse(row.expires_at) <= Date.now() ? "expired" : "active",
      scopes: ["*"],
      ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
      ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
      ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at }),
      createdAt: row.created_at,
    })) as unknown as JsonValue;
  }

  private createMcpToken(context: CommandContext, payload: JsonValue): JsonValue {
    if (context.session.principal.type !== "user") throw serviceError("TOKEN_USER_REQUIRED", "MCP administrator tokens require a user session");
    const input = asObject(payload);
    const label = requiredString(input, "label").trim();
    if (label.length < 2 || label.length > 80) throw serviceError("TOKEN_LABEL_INVALID", "Token label must contain between 2 and 80 characters");
    const expiresAt = optionalString(input, "expiresAt");
    if (expiresAt !== undefined && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw serviceError("TOKEN_EXPIRY_INVALID", "Token expiration must be a future date");
    }
    return {
      ...this.authentication.issueToken({
        userId: context.session.principal.id,
        type: "personal-access-token",
        scopes: ["*"],
        label: `mcp:${label}`,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      }),
      label,
      scopes: ["*"],
      ...(expiresAt === undefined ? {} : { expiresAt }),
    } as JsonValue;
  }

  private revokeMcpToken(tokenId: string): JsonValue {
    const exists = this.database.raw.query<{ value: number }, [string]>(`SELECT COUNT(*) AS value FROM access_tokens
      WHERE token_id=? AND project_id IS NULL AND token_type='personal-access-token' AND label LIKE 'mcp:%'`).get(tokenId)?.value ?? 0;
    if (exists === 0) throw serviceError("TOKEN_NOT_FOUND", `MCP token ${tokenId} not found`);
    this.authentication.revokeToken(tokenId);
    return { tokenId, revoked: true };
  }

  private requiredUser(reference: string): { user_id: string; username: string; status: string } {
    const row = this.database.raw.query<{ user_id: string; username: string; status: string }, [string, string]>("SELECT user_id, username, status FROM users WHERE user_id=? OR username=?").get(reference, reference);
    if (row === null) throw serviceError("USER_NOT_FOUND", `User ${reference} not found`);
    return row;
  }

  private listProjectMembers(projectId: string): JsonValue {
    return this.database.raw.query<ProjectMemberRow, [string]>(`SELECT m.user_id, u.username, u.status, m.role, m.created_at,
      EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=m.user_id AND r.role='system_admin') AS system_admin
      FROM project_memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.project_id=? AND NOT EXISTS (
        SELECT 1 FROM user_roles r WHERE r.user_id=m.user_id AND r.role='system_admin'
      ) ORDER BY u.username`).all(projectId)
      .map(mapProjectMember) as unknown as JsonValue;
  }

  private addProjectMember(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const user = this.requiredUser(requiredString(input, "user"));
    const role = requiredString(input, "role");
    if (!new Set(["project_owner", "project_operator", "project_developer", "project_viewer"]).has(role)) throw serviceError("PROJECT_ROLE_INVALID", "Project role is invalid");
    this.authentication.setProjectRole(projectId, user.user_id, role as "project_owner" | "project_operator" | "project_developer" | "project_viewer");
    return { projectId, userId: user.user_id, username: user.username, role };
  }

  private async createProjectMember(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const role = projectRole(requiredString(input, "role"));
    const principal = await this.authentication.createUser({
      username: requiredString(input, "username"),
      password: requiredString(input, "password"),
      project: { projectId, role },
    });
    return this.requiredProjectMember(projectId, principal.id);
  }

  private async updateProjectMember(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const user = this.requiredUser(requiredString(input, "user"));
    const password = optionalString(input, "password");
    await this.authentication.updateProjectUser({
      projectId,
      userId: user.user_id,
      username: requiredString(input, "username"),
      role: projectRole(requiredString(input, "role")),
      ...(password === undefined ? {} : { password }),
    });
    return this.requiredProjectMember(projectId, user.user_id);
  }

  private removeProjectMember(projectId: string, payload: JsonValue): JsonValue {
    const user = this.requiredUser(requiredString(asObject(payload), "user"));
    const result = this.database.raw.query("DELETE FROM project_memberships WHERE project_id=? AND user_id=?").run(projectId, user.user_id);
    if (result.changes !== 1) throw serviceError("PROJECT_MEMBER_NOT_FOUND", "Project membership not found");
    return { projectId, userId: user.user_id, removed: true };
  }

  private requiredProjectMember(projectId: string, userId: string): JsonValue {
    const row = this.database.raw.query<ProjectMemberRow, [string, string]>(`SELECT m.user_id, u.username, u.status, m.role, m.created_at,
      EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=m.user_id AND r.role='system_admin') AS system_admin
      FROM project_memberships m JOIN users u ON u.user_id=m.user_id WHERE m.project_id=? AND m.user_id=?`).get(projectId, userId);
    if (row === null) throw serviceError("PROJECT_MEMBER_NOT_FOUND", "Project membership not found");
    return mapProjectMember(row) as unknown as JsonValue;
  }

  private listProviders(): JsonValue {
    return this.database.raw.query<ProviderRow, []>("SELECT * FROM providers ORDER BY name").all().map(publicProvider) as unknown as JsonValue;
  }

  private addProvider(payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const name = requiredString(input, "name");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(name)) throw serviceError("PROVIDER_NAME_INVALID", "Provider name is invalid");
    const requestedCatalogId = optionalString(input, "catalogId");
    const catalog = providerCatalogEntry(requestedCatalogId ?? optionalString(input, "type"));
    if (requestedCatalogId !== undefined && catalog === undefined) throw serviceError("PROVIDER_CATALOG_NOT_FOUND", `Provider catalog entry ${requestedCatalogId} not found`);
    const type = catalog?.id ?? optionalString(input, "type") ?? "openai-compatible";
    if (type !== "openai-compatible" && providerCatalogEntry(type) === undefined) throw serviceError("PROVIDER_TYPE_UNSUPPORTED", `Provider type ${type} is not supported`);
    const baseUrl = optionalString(input, "baseUrl") ?? catalog?.baseUrl;
    if (baseUrl === undefined) throw serviceError("PROVIDER_BASE_URL_REQUIRED", "OpenAI-compatible providers require baseUrl");
    if (baseUrl !== undefined) validateProviderUrl(baseUrl);
    const secretRefs = stringArray(input.secretRefs ?? []);
    const now = new Date().toISOString();
    const providerId = `provider_${Bun.randomUUIDv7()}`;
    this.database.raw.query(`INSERT INTO providers(provider_id, name, type, base_url, secret_refs_json, status, capabilities_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'unverified', ?, ?, ?)`)
      .run(providerId, name, type, baseUrl ?? null, JSON.stringify(secretRefs), JSON.stringify(emptyCapabilities()), now, now);
    return publicProvider(this.requiredProvider(providerId)) as unknown as JsonValue;
  }

  private async testProvider(reference: string): Promise<JsonValue> {
    const row = this.requiredProvider(reference);
    const probe = await this.createProvider(row).probe();
    const status = probe.healthy ? "healthy" : "unavailable";
    this.database.raw.query("UPDATE providers SET status = ?, capabilities_json = ?, updated_at = ? WHERE provider_id = ?")
      .run(status, JSON.stringify(probe.capabilities), new Date().toISOString(), row.provider_id);
    return { provider: publicProvider(this.requiredProvider(row.provider_id)), probe } as unknown as JsonValue;
  }

  private async providerModels(reference: string): Promise<JsonValue> {
    const row = this.requiredProvider(reference);
    return { providerId: row.provider_id, models: await this.createProvider(row).listModels() } as unknown as JsonValue;
  }

  private listModelRoles(): JsonValue {
    return this.database.raw.query<ModelRoleRow, []>("SELECT * FROM model_roles ORDER BY role").all().map(mapModelRole) as unknown as JsonValue;
  }

  private setModelRole(payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const role = requiredString(input, "role");
    const provider = this.requiredProvider(requiredString(input, "provider"));
    const model = requiredString(input, "model");
    const configuration = isJsonObject(input.configuration) ? input.configuration : {};
    const now = new Date().toISOString();
    this.database.raw.query(`INSERT INTO model_roles(role, provider_id, model_name, configuration_json, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(role) DO UPDATE SET provider_id=excluded.provider_id, model_name=excluded.model_name,
      configuration_json=excluded.configuration_json, updated_at=excluded.updated_at`)
      .run(role, provider.provider_id, model, JSON.stringify(configuration), now);
    return mapModelRole(this.getModelRole(role)!) as unknown as JsonValue;
  }

  private deleteModelRole(role: string): JsonValue {
    const result = this.database.raw.query("DELETE FROM model_roles WHERE role = ?").run(role);
    if (result.changes !== 1) throw serviceError("MODEL_ROLE_NOT_CONFIGURED", `Model role ${role} is not configured`);
    return { role, deleted: true };
  }

  private defaultLlmConfiguration(): JsonValue {
    const role = this.getModelRole("agent.default");
    if (role === undefined) return { configured: false };
    return {
      configured: true,
      role: mapModelRole(role),
      provider: publicProvider(this.requiredProvider(role.provider_id)),
    } as unknown as JsonValue;
  }

  private async configureDefaultLlm(payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const name = requiredString(input, "provider");
    const requestedCatalogId = optionalString(input, "catalogId");
    const requestedCatalog = providerCatalogEntry(requestedCatalogId ?? name);
    if (requestedCatalogId !== undefined && requestedCatalog === undefined) throw serviceError("PROVIDER_CATALOG_NOT_FOUND", `Provider catalog entry ${requestedCatalogId} not found`);
    const baseUrl = optionalString(input, "baseUrl") ?? requestedCatalog?.baseUrl;
    if (baseUrl === undefined) throw serviceError("PROVIDER_BASE_URL_REQUIRED", "Provider base URL is required");
    const apiKey = requiredString(input, "apiKey");
    const model = requiredString(input, "model");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(name)) throw serviceError("PROVIDER_NAME_INVALID", "Provider name is invalid");
    validateProviderUrl(baseUrl);

    const catalogId = requestedCatalog?.id ?? inferProviderCatalogId(baseUrl);
    const probe = await new OpenAICompatibleProvider({ id: name, baseUrl, apiKey, ...(catalogId === undefined ? {} : { catalogId }) }).probe();
    if (!probe.healthy) {
      throw serviceError("PROVIDER_PROBE_FAILED", `Provider ${name} could not be verified (${probe.error?.code ?? "unknown error"})`);
    }

    const secretRef = `providers.${name}`;
    await this.secrets.set(secretRef, apiKey);
    const existing = this.database.raw.query<ProviderRow, [string]>("SELECT * FROM providers WHERE name = ?").get(name);
    if (existing === null) {
      this.addProvider({ name, type: catalogId ?? "openai-compatible", baseUrl, secretRefs: [secretRef], ...(catalogId === undefined ? {} : { catalogId }) });
    } else {
      const now = new Date().toISOString();
      this.database.raw.query(`UPDATE providers SET type=?, base_url=?, secret_refs_json=?, status='unverified',
        capabilities_json=?, updated_at=? WHERE provider_id=?`)
        .run(catalogId ?? "openai-compatible", baseUrl, JSON.stringify([secretRef]), JSON.stringify(emptyCapabilities()), now, existing.provider_id);
    }
    const provider = this.requiredProvider(name);
    this.database.raw.query("UPDATE providers SET status='healthy', capabilities_json=?, updated_at=? WHERE provider_id=?")
      .run(JSON.stringify(probe.capabilities), new Date().toISOString(), provider.provider_id);
    const role = this.setModelRole({
      role: "agent.default",
      provider: name,
      model,
      ...(catalogId === "deepseek" ? { configuration: { thinking: true, reasoningEffort: "high" } } : {}),
    });
    return { configured: true, provider: publicProvider(this.requiredProvider(name)), role, probe } as unknown as JsonValue;
  }

  private getModelRole(role: string): ModelRoleRow | undefined {
    return this.database.raw.query<ModelRoleRow, [string]>("SELECT * FROM model_roles WHERE role = ?").get(role) ?? undefined;
  }

  private requiredProvider(reference: string): ProviderRow {
    const row = this.database.raw.query<ProviderRow, [string, string]>("SELECT * FROM providers WHERE provider_id = ? OR name = ?").get(reference, reference);
    if (row === null) throw serviceError("PROVIDER_NOT_FOUND", `Provider ${reference} not found`);
    return row;
  }

  private createProvider(row: ProviderRow, projectId?: string): OpenAICompatibleProvider {
    if ((row.type !== "openai-compatible" && providerCatalogEntry(row.type) === undefined) || row.base_url === null) {
      throw serviceError("PROVIDER_TYPE_UNSUPPORTED", `Provider type ${row.type} is not supported by this daemon`);
    }
    const refs = parseStringArray(row.secret_refs_json);
    const catalogId = providerCatalogEntry(row.type)?.id ?? inferProviderCatalogId(row.base_url);
    return new OpenAICompatibleProvider({
      id: row.provider_id,
      baseUrl: row.base_url,
      ...(catalogId === undefined ? {} : { catalogId }),
      ...(refs[0] === undefined ? {} : { apiKey: () => this.secrets.resolve(refs[0]!, projectId) }),
    });
  }

  private async generateWithRole<T extends JsonValue>(
    role: string,
    messages: readonly ModelMessage[],
    options: Pick<ModelGenerationRequest, "outputSchema" | "outputExample" | "tools" | "maxOutputTokens" | "thinking" | "reasoningEffort"> = {},
    projectId?: string,
  ): Promise<ModelGenerationResponse<T>> {
    const binding = this.getModelRole(role);
    if (binding === undefined) throw serviceError("MODEL_ROLE_NOT_CONFIGURED", `Model role ${role} is not configured`);
    const configuration = JSON.parse(binding.configuration_json) as Record<string, JsonValue>;
    return this.createProvider(this.requiredProvider(binding.provider_id), projectId).generate<T>({
      model: binding.model_name,
      messages,
      ...(typeof configuration.temperature === "number" ? { temperature: configuration.temperature } : {}),
      ...(typeof configuration.maxOutputTokens === "number" ? { maxOutputTokens: configuration.maxOutputTokens } : {}),
      ...(typeof configuration.thinking === "boolean" ? { thinking: configuration.thinking } : {}),
      ...(isReasoningEffort(configuration.reasoningEffort) ? { reasoningEffort: configuration.reasoningEffort } : {}),
      ...options,
    });
  }

  private startAgentGeneration(context: CommandContext, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const prompt = requiredString(input, "prompt").trim();
    if (prompt.length < 12 || prompt.length > ASSISTANT_MAX_MESSAGE_LENGTH) {
      throw serviceError("AGENT_PROMPT_INVALID", "Agent description must contain between 12 and 20000 characters");
    }
    const requestedProgressId = optionalString(input, "progressId");
    if (requestedProgressId !== undefined && !/^generation_[a-zA-Z0-9_-]{8,96}$/u.test(requestedProgressId)) {
      throw serviceError("AGENT_GENERATION_PROGRESS_ID_INVALID", "progressId is invalid");
    }
    const progressId = requestedProgressId ?? `generation_${Bun.randomUUIDv7()}`;
    this.purgeAgentGenerationProgress();
    this.createAgentActivity(context, progressId, "agent.generate", "Interpretando requisitos y preparando el contrato del agente…", context.projectId);
    this.launchAgentActivity(progressId, () => this.generateMarkdownAgent(context, { ...input, prompt, progressId }));
    return { activityId: progressId, progressId, status: "accepted" };
  }

  private async generateMarkdownAgent(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const prompt = requiredString(input, "prompt").trim();
    const progressId = optionalString(input, "progressId");
    const role = this.getModelRole("markdown.compiler") === undefined ? "agent.default" : "markdown.compiler";
    const binding = this.getModelRole(role);
    if (binding === undefined) throw serviceError("MODEL_ROLE_NOT_CONFIGURED", `Model role ${role} is not configured`);
    const provider = this.requiredProvider(binding.provider_id);
    this.updateAgentGenerationProgress(progressId, {
      stage: "generating",
      message: `Generando el agente con ${provider.name} · ${binding.model_name}…`,
      provider: provider.name,
      model: binding.model_name,
    });
    try {
      let response = await this.generateWithRole<Record<string, JsonValue>>(role, [
        {
          role: "system",
          content: `You are the official Marcus Markdown agent compiler. Return one complete, deterministic and executable Marcus Markdown agent. Never use code fences around the full source. The first frontmatter field must be exactly \"schema: marcus.agent/v1\". The source must include typed Input and Output yaml schema blocks so it compiles without semantic assumptions. Use kebab-case for the id and preserve every material requirement.\n\nOfficial authoring documentation:\n${marcusMarkdownAuthoringGuide}`,
        },
        { role: "user", content: prompt },
      ], {
        maxOutputTokens: 8_192,
        outputSchema: generatedAgentOutputSchema,
        outputExample: generatedAgentOutputExample,
      }, context.projectId);
      let generated = asObject(response.output);
      let normalized = canonicalizeGeneratedAgentSource(stripOuterMarkdownFence(requiredString(generated, "source")));
      if (normalized.changed) {
        this.updateAgentGenerationProgress(progressId, {
          stage: "normalizing",
          message: "Normalizando el frontmatter al contrato marcus.agent/v1…",
        });
      }
      let source = normalized.source;
      this.updateAgentGenerationProgress(progressId, {
        stage: "validating",
        message: "Validando frontmatter y schemas de entrada y salida…",
      });
      let compilation;
      try {
        compilation = await compileMarkdownAgent(source);
      } catch (error) {
        if (!(error instanceof MarcusError) || !error.code.startsWith("MD_")) throw error;
        this.updateAgentGenerationProgress(progressId, {
          stage: "repairing",
          message: `El compilador rechazó el primer borrador (${error.code}: ${error.message}). Marcus AI está corrigiendo el contrato…`,
        });
        response = await this.generateWithRole<Record<string, JsonValue>>(role, [
          {
            role: "system",
            content: `Repair the supplied Marcus Markdown agent without changing its requested behavior. Return the same structured object with a complete corrected source. Never use outer code fences. The first frontmatter field must be exactly \"schema: marcus.agent/v1\". Resolve the compiler diagnostic and preserve all material requirements.\n\nOfficial authoring documentation:\n${marcusMarkdownAuthoringGuide}`,
          },
          {
            role: "user",
            content: `Original request:\n${prompt}\n\nCompiler diagnostic:\n${error.code}: ${error.message}\n\nInvalid draft:\n${source}`,
          },
        ], {
          maxOutputTokens: 8_192,
          outputSchema: generatedAgentOutputSchema,
          outputExample: generatedAgentOutputExample,
        }, context.projectId);
        generated = asObject(response.output);
        normalized = canonicalizeGeneratedAgentSource(stripOuterMarkdownFence(requiredString(generated, "source")));
        source = normalized.source;
        this.updateAgentGenerationProgress(progressId, {
          stage: "validating",
          message: "Validando nuevamente el agente corregido…",
        });
        compilation = await compileMarkdownAgent(source);
      }
      const slug = compilation.manifest.identity.id;
      if (this.repositories.getAgentBySlug(context.projectId!, slug) !== undefined) {
        throw serviceError("AGENT_ALREADY_EXISTS", `Agent ${slug} already exists; edit or apply its source instead`);
      }
      const sourcePath = `project:/agents/${slug}.agent.md`;
      const store = this.projectStore(context.projectId!);
      this.updateAgentGenerationProgress(progressId, {
        stage: "activating",
        message: `Escribiendo la fuente administrada en project:/agents/${slug}.agent.md…`,
      }, "files.write");
      await store.write(sourcePath, `${source}\n`, { actorId: context.session.principal.id });
      this.updateAgentGenerationProgress(progressId, {
        stage: "activating",
        message: "Compilando una versión inmutable y activando el agente…",
      }, "agents.build");
      const build = await this.buildAgent(context, { sourcePath, sourceKind: "markdown", activate: true });
      const result = {
        ...asObject(build),
        sourcePath,
        summary: requiredString(generated, "summary"),
        provider: response.provider,
        model: response.model,
      } as JsonValue;
      this.updateAgentGenerationProgress(progressId, {
        status: "completed",
        stage: "completed",
        message: "Agente creado y activado.",
        result,
      }, "agents.activate");
      return result;
    } catch (error) {
      const detail = publicGenerationError(error);
      this.updateAgentGenerationProgress(progressId, {
        status: "failed",
        stage: "failed",
        message: `${detail.code}: ${detail.message}`,
        error: detail,
      }, "agents.generateMarkdown");
      throw error;
    }
  }

  private startAgentPlan(context: CommandContext, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const prompt = requiredString(input, "prompt").trim();
    if (prompt.length < 12 || prompt.length > ASSISTANT_MAX_MESSAGE_LENGTH) {
      throw serviceError("AGENT_PROMPT_INVALID", "Agent description must contain between 12 and 20000 characters");
    }
    const sourceKind = optionalString(input, "sourceKind") ?? "markdown";
    if (sourceKind !== "markdown" && sourceKind !== "sdk") throw serviceError("AGENT_SOURCE_KIND_INVALID", "sourceKind must be markdown or sdk");
    const activityId = `activity_${Bun.randomUUIDv7()}`;
    this.createAgentActivity(context, activityId, "agent.plan", "Analizando la necesidad y el formato de implementación…", context.projectId);
    this.launchAgentActivity(activityId, () => this.planAgent(context, { ...input, prompt, sourceKind }, activityId));
    return { activityId, status: "accepted" };
  }

  private async planAgent(context: CommandContext, payload: JsonValue, activityId?: string): Promise<JsonValue> {
    const input = asObject(payload);
    const prompt = requiredString(input, "prompt").trim();
    const sourceKind = optionalString(input, "sourceKind") ?? "markdown";
    const role = this.getModelRole("agent.default") === undefined ? "markdown.compiler" : "agent.default";
    const binding = this.getModelRole(role);
    if (binding === undefined) throw serviceError("MODEL_ROLE_NOT_CONFIGURED", `Model role ${role} is not configured`);
    const provider = this.requiredProvider(binding.provider_id);
    this.updateAgentGenerationProgress(activityId, {
      stage: "generating",
      message: `Solicitando el plan a ${provider.name} · ${binding.model_name}…`,
      provider: provider.name,
      model: binding.model_name,
    }, "provider.chat.completions", { title: "Diseño de arquitectura", kind: "provider" });
    const response = await this.generateWithRole<Record<string, JsonValue>>(role, [
      {
        role: "system",
        content: `You are the official Marcus Agent Architect. Produce an implementation plan, not source code and do not mutate any Project. The requested source kind is ${sourceKind}. Every recommendation must match the official Marcus authoring contract. Make inputs, outputs, tools, files, execution steps, tests and operational risks explicit. Use concise Spanish.\n\nOfficial authoring documentation:\n${sourceKind === "markdown" ? marcusMarkdownAuthoringGuide : `${marcusDocumentation["SDK.md"]}\n\n${marcusDocumentation["RUNTIME.md"]}\n\n${marcusDocumentation["SECURITY.md"]}`}`,
      },
      { role: "user", content: prompt },
    ], {
      maxOutputTokens: 4_096,
      outputSchema: agentPlanOutputSchema,
      outputExample: {
        slug: "status-assistant",
        name: "Status Assistant",
        summary: "Responde consultas operativas con información verificable.",
        sourceKind,
        architecture: "Un agente invocable que valida entrada, consulta capacidades administradas y produce una salida tipada.",
        inputs: ["message: string"],
        outputs: ["answer: string"],
        tools: ["Una tool de lectura explícitamente autorizada"],
        files: [sourceKind === "markdown" ? "project:/agents/status-assistant.agent.md" : "project:/agents/status-assistant/index.ts"],
        steps: ["Definir el contrato", "Implementar la fuente", "Compilar y activar", "Ejecutar casos de prueba"],
        testCases: ["Entrada válida", "Datos ausentes", "Fallo de tool"],
        risks: ["No inventar datos ausentes"],
      },
    }, context.projectId);
    const plan = asObject(response.output);
    if (plan.sourceKind !== sourceKind) plan.sourceKind = sourceKind;
    this.updateAgentGenerationProgress(activityId, {
      stage: "validating",
      message: "Validando entradas, salidas, tools, archivos, pruebas y riesgos del plan…",
    }, "agent.plan.validate", { title: "Validación del plan", kind: "compiler" });
    return { ...plan, provider: response.provider, model: response.model, plannedAt: new Date().toISOString() } as JsonValue;
  }

  private createAgentActivity(
    context: CommandContext,
    activityId: string,
    activityKind: AgentActivityKind,
    message: string,
    projectId?: string,
  ): void {
    const now = new Date().toISOString();
    const record: AgentGenerationProgressRecord = {
      activityId,
      activityKind,
      progressId: activityId,
      ...(projectId === undefined ? {} : { projectId }),
      principalId: context.session.principal.id,
      status: "running",
      stage: "analyzing",
      message,
      sequence: 1,
      startedAt: now,
      updatedAt: now,
      events: [{
        sequence: 1,
        timestamp: now,
        stage: "analyzing",
        kind: "analysis",
        title: activityKind === "agent.generate" ? "Análisis de requisitos" : "Análisis de la solicitud",
        message,
        operation: activityKind === "agent.generate" ? "requirements.analyze" : `${activityKind}.analyze`,
      }],
    };
    this.agentGenerationProgress.set(activityId, record);
    this.publishAgentActivity(record);
  }

  private launchAgentActivity(activityId: string, worker: () => Promise<JsonValue>): void {
    const task = worker()
      .then((result) => {
        const current = this.agentGenerationProgress.get(activityId);
        if (current === undefined) return;
        if (current.status === "running") {
          this.updateAgentGenerationProgress(activityId, {
            status: "completed",
            stage: "completed",
            message: current.activityKind === "agent.plan" ? "Plan listo para revisión." : current.activityKind === "assistant.chat" ? "Respuesta lista." : "Agente creado y activado.",
            result,
          }, `${current.activityKind}.completed`, { title: "Actividad completada", kind: "result" });
          return;
        }
        if (current.result === undefined) {
          const updated = { ...current, result };
          this.agentGenerationProgress.set(activityId, updated);
          this.publishAgentActivity(updated);
        }
      })
      .catch((error: unknown) => {
        const current = this.agentGenerationProgress.get(activityId);
        if (current === undefined || current.status === "failed") return;
        const detail = publicGenerationError(error);
        this.updateAgentGenerationProgress(activityId, {
          status: "failed",
          stage: "failed",
          message: `${detail.code}: ${detail.message}`,
          error: detail,
        }, `${current.activityKind}.failed`, { title: "Actividad fallida", kind: "error" });
      })
      .finally(() => this.activeAgentActivities.delete(activityId));
    this.activeAgentActivities.set(activityId, task);
  }

  private getAgentActivity(context: CommandContext, payload: JsonValue): JsonValue {
    this.purgeAgentGenerationProgress();
    const activityId = requiredString(asObject(payload), "activityId");
    const activity = this.agentGenerationProgress.get(activityId);
    if (activity === undefined || activity.principalId !== context.session.principal.id || (context.projectId !== undefined && activity.projectId !== context.projectId)) {
      throw serviceError("AGENT_ACTIVITY_NOT_FOUND", "Agent activity was not found");
    }
    if (activity.projectId !== undefined) this.authorization.assert(context.session.principal, "projects.read", activity.projectId);
    const { principalId: _principalId, ...publicActivity } = activity;
    return publicActivity as unknown as JsonValue;
  }

  private getAgentGenerationProgress(context: CommandContext, payload: JsonValue): JsonValue {
    this.purgeAgentGenerationProgress();
    const progressId = requiredString(asObject(payload), "progressId");
    const progress = this.agentGenerationProgress.get(progressId);
    if (progress === undefined || progress.projectId !== context.projectId || progress.principalId !== context.session.principal.id) {
      throw serviceError("AGENT_GENERATION_PROGRESS_NOT_FOUND", "Agent generation progress was not found");
    }
    const { principalId: _principalId, ...publicProgress } = progress;
    return publicProgress as unknown as JsonValue;
  }

  private updateAgentGenerationProgress(
    progressId: string | undefined,
    update: Partial<Pick<AgentGenerationProgressRecord, "status" | "stage" | "message" | "provider" | "model" | "error" | "result">>,
    operation?: string,
    event?: Partial<Pick<AgentGenerationProgressEvent, "title" | "kind">>,
  ): void {
    if (progressId === undefined) return;
    const current = this.agentGenerationProgress.get(progressId);
    if (current === undefined) return;
    const sequence = current.sequence + 1;
    const updatedAt = new Date().toISOString();
    const stage = update.stage ?? current.stage;
    const provider = update.provider ?? current.provider;
    const model = update.model ?? current.model;
    const message = update.message ?? current.message;
    const updated: AgentGenerationProgressRecord = {
      ...current,
      ...update,
      sequence,
      updatedAt,
      events: [...current.events, {
        sequence,
        timestamp: updatedAt,
        stage,
        kind: event?.kind ?? generationEventKind(stage),
        title: event?.title ?? generationEventTitle(stage),
        message,
        operation: operation ?? generationEventOperation(stage),
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
      }].slice(-48),
    };
    this.agentGenerationProgress.set(progressId, updated);
    this.publishAgentActivity(updated);
  }

  private publishAgentActivity(activity: AgentGenerationProgressRecord): void {
    this.server.publishRealtime({
      topic: "agent.activity.updated",
      timestamp: activity.updatedAt,
      ...(activity.projectId === undefined ? {} : { projectId: activity.projectId }),
      principalId: activity.principalId,
      payload: {
        activityId: activity.activityId,
        progressId: activity.progressId,
        activityKind: activity.activityKind,
        status: activity.status,
        stage: activity.stage,
        sequence: activity.sequence,
      },
    });
  }

  private purgeAgentGenerationProgress(): void {
    const expiredBefore = Date.now() - AGENT_GENERATION_PROGRESS_TTL_MS;
    for (const [progressId, progress] of this.agentGenerationProgress) {
      if (Date.parse(progress.updatedAt) < expiredBefore) this.agentGenerationProgress.delete(progressId);
    }
  }

  private startAssistantChat(context: CommandContext, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > ASSISTANT_MAX_HISTORY_MESSAGES) {
      throw serviceError("ASSISTANT_MESSAGES_INVALID", `messages must contain between 1 and ${ASSISTANT_MAX_HISTORY_MESSAGES} entries`);
    }
    const selectedProjectReference = optionalString(input, "projectId");
    const selectedProject = selectedProjectReference === undefined ? context.projectId : this.requiredProjectByReference(selectedProjectReference).projectId;
    const activityId = `activity_${Bun.randomUUIDv7()}`;
    this.createAgentActivity(context, activityId, "assistant.chat", "Preparando el contexto y la documentación de Marcus…", selectedProject);
    this.launchAgentActivity(activityId, () => this.assistantChat(context, payload, activityId));
    return { activityId, status: "accepted" };
  }

  private async assistantChat(context: CommandContext, payload: JsonValue, activityId?: string): Promise<JsonValue> {
    const input = asObject(payload);
    if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > ASSISTANT_MAX_HISTORY_MESSAGES) {
      throw serviceError("ASSISTANT_MESSAGES_INVALID", `messages must contain between 1 and ${ASSISTANT_MAX_HISTORY_MESSAGES} entries`);
    }
    const history: ModelMessage[] = input.messages.map((value) => {
      const message = asObject(value);
      const role = requiredString(message, "role");
      const content = requiredString(message, "content").trim();
      if ((role !== "user" && role !== "assistant") || content.length > ASSISTANT_MAX_MESSAGE_LENGTH) {
        throw serviceError("ASSISTANT_MESSAGE_INVALID", "Assistant messages must use user or assistant roles and contain at most 20000 characters");
      }
      return { role, content };
    });
    const selectedProjectReference = optionalString(input, "projectId");
    const selectedProject = selectedProjectReference === undefined ? undefined : this.requiredProjectByReference(selectedProjectReference).projectId;
    const mode = optionalString(input, "mode");
    if (mode !== undefined && mode !== "agent-file-edit") throw serviceError("ASSISTANT_MODE_INVALID", "Assistant mode is invalid");
    const editPath = mode === "agent-file-edit" ? requiredString(input, "path") : undefined;
    if (editPath !== undefined) {
      if (selectedProject === undefined || !/^project:\/.+\.agent\.md$/iu.test(editPath)) {
        throw serviceError("ASSISTANT_EDIT_SCOPE_INVALID", "Agent file editing requires a Project and a project:/*.agent.md path");
      }
      const target = await this.projectStore(selectedProject).stat(editPath);
      if (target.kind !== "file") throw serviceError("ASSISTANT_EDIT_SCOPE_INVALID", "Agent edit target must be a file");
    }
    const latestUserMessage = [...history].reverse().find((message) => message.role === "user")?.content;
    if (typeof latestUserMessage !== "string") throw serviceError("ASSISTANT_MESSAGE_INVALID", "A user message is required");
    this.purgeAssistantThreads();
    const binding = this.getModelRole("agent.default");
    if (binding === undefined) throw serviceError("MODEL_ROLE_NOT_CONFIGURED", "Model role agent.default is not configured");
    const provider = this.requiredProvider(binding.provider_id);
    this.updateAgentGenerationProgress(activityId, {
      stage: "generating",
      message: `Modelo asignado: ${provider.name} · ${binding.model_name}.`,
      provider: provider.name,
      model: binding.model_name,
    }, "modelRoles.resolve", { title: "Modelo seleccionado", kind: "provider" });
    const bindingKey = `${binding.provider_id}:${binding.model_name}:${binding.configuration_json}:${editPath ?? "general"}`;
    const requestedConversationId = optionalString(input, "conversationId");
    let thread = requestedConversationId === undefined ? undefined : this.assistantThreads.get(requestedConversationId);
    if (thread !== undefined && (thread.principalId !== context.session.principal.id || thread.projectId !== selectedProject)) {
      throw serviceError("ASSISTANT_CONVERSATION_FORBIDDEN", "Assistant conversation does not belong to this principal and Project");
    }
    if (thread === undefined || thread.bindingKey !== bindingKey) {
      thread = {
        conversationId: createId("conversation"),
        principalId: context.session.principal.id,
        ...(selectedProject === undefined ? {} : { projectId: selectedProject }),
        bindingKey,
        messages: [assistantSystemMessage(selectedProject, editPath), ...history],
        updatedAt: Date.now(),
      };
      this.assistantThreads.set(thread.conversationId, thread);
    } else {
      thread.messages.push({ role: "user", content: latestUserMessage });
      thread.updatedAt = Date.now();
    }
    const modelMessages = thread.messages;
    const actions: Array<{ tool: string; arguments: Record<string, JsonValue>; result: JsonValue }> = [];
    for (let round = 0; round < ASSISTANT_MAX_ROUNDS; round += 1) {
      this.updateAgentGenerationProgress(activityId, {
        stage: "generating",
        message: `Consultando el modelo · ronda ${round + 1} de ${ASSISTANT_MAX_ROUNDS}…`,
      }, "provider.chat.completions", { title: `Ronda ${round + 1}`, kind: "provider" });
      const response = await this.generateWithRole<JsonValue>("agent.default", modelMessages, { tools: editPath === undefined ? assistantTools : agentFileEditTools }, selectedProject);
      const calls = response.toolCalls ?? [];
      if (calls.length === 0) {
        const message = response.text?.trim();
        if (message === undefined || message.length === 0) throw serviceError("ASSISTANT_EMPTY_RESPONSE", "The configured model returned an empty assistant response");
        modelMessages.push({ role: "assistant", content: message });
        thread.messages = trimAssistantMessages(modelMessages);
        thread.updatedAt = Date.now();
        return { conversationId: thread.conversationId, message, actions, provider: response.provider, model: response.model, rounds: round + 1 } as JsonValue;
      }
      modelMessages.push({
        role: "assistant",
        content: response.text ?? "",
        ...(response.reasoningContent === undefined ? {} : { reasoningContent: response.reasoningContent }),
        toolCalls: calls,
      });
      for (const call of calls) {
        this.updateAgentGenerationProgress(activityId, {
          stage: "activating",
          message: `Ejecutando tool ${call.name}${Object.keys(call.arguments).length === 0 ? "" : ` con ${Object.keys(call.arguments).join(", ")}`}…`,
        }, call.name, { title: `Tool · ${call.name}`, kind: "tool" });
        const result = await this.executeAssistantTool(context, call, latestUserMessage, editPath, selectedProject, activityId);
        actions.push({ tool: call.name, arguments: { ...call.arguments }, result });
        this.updateAgentGenerationProgress(activityId, {
          stage: "activating",
          message: `Tool ${call.name} completada.`,
        }, call.name, { title: `Tool completada · ${call.name}`, kind: "tool" });
        modelMessages.push({ role: "tool", name: call.name, toolCallId: call.id, content: result });
      }
    }
    throw serviceError("ASSISTANT_ROUND_LIMIT", "Marcus AI reached its tool-call round limit");
  }

  private purgeAssistantThreads(): void {
    const threshold = Date.now() - ASSISTANT_THREAD_TTL_MS;
    for (const [conversationId, thread] of this.assistantThreads) {
      if (thread.updatedAt < threshold) this.assistantThreads.delete(conversationId);
    }
  }

  private async executeAssistantTool(context: CommandContext, call: ModelToolCall, latestUserMessage: string, editPath?: string, selectedProjectId?: string, activityId?: string): Promise<JsonValue> {
    const args = asObject(call.arguments);
    const projectReference = optionalString(args, "projectId");
    const projectId = projectReference === undefined ? undefined : this.requiredProjectByReference(projectReference).projectId;
    if (context.projectId !== undefined && projectId !== undefined && context.projectId !== projectId) {
      throw serviceError("ASSISTANT_PROJECT_SCOPE_MISMATCH", "Assistant tools cannot leave the selected Project scope");
    }
    if (selectedProjectId !== undefined && projectId !== undefined && selectedProjectId !== projectId) {
      throw serviceError("ASSISTANT_PROJECT_SCOPE_MISMATCH", "Assistant tools cannot leave the selected Project scope");
    }
    if (editPath !== undefined && ((call.name !== "files_read" && call.name !== "files_write") || requiredString(args, "path") !== editPath)) {
      throw serviceError("ASSISTANT_EDIT_SCOPE_FORBIDDEN", "Agent editor tools cannot leave the selected file");
    }
    const route = (operation: string, payload: JsonValue, scopedProjectId?: string) => this.router.route(context.session, {
      requestId: `${context.request.requestId}:${call.id}`,
      operation,
      protocolVersion: 1,
      ...(scopedProjectId === undefined ? {} : { projectId: scopedProjectId }),
      payload,
    }, context.sourceAddress);
    if (call.name === "projects_list") return route("projects.list", {});
    if (call.name === "projects_get") return route("projects.get", {}, requiredProjectId(projectId));
    if (call.name === "projects_create") return route("projects.create", { slug: requiredString(args, "slug"), name: requiredString(args, "name") });
    if (call.name === "projects_delete") {
      assertAssistantConfirmation(latestUserMessage, "CONFIRMAR ELIMINAR PROYECTO", projectReference!);
      return route("projects.delete", {}, requiredProjectId(projectId));
    }
    if (call.name === "agents_list") return route("agents.list", {}, requiredProjectId(projectId));
    if (call.name === "agents_get") return route("agents.get", { agent: requiredString(args, "agent") }, requiredProjectId(projectId));
    if (call.name === "agents_generate") {
      const scopedProjectId = requiredProjectId(projectId);
      this.authorization.assert(context.session.principal, "agents.create", scopedProjectId);
      return this.generateMarkdownAgent({ ...context, projectId: scopedProjectId }, { prompt: requiredString(args, "prompt") });
    }
    if (call.name === "agents_apply") {
      const agent = requiredString(args, "agent");
      assertAssistantConfirmation(latestUserMessage, "CONFIRMAR APLICAR", agent);
      return route("agents.apply", { agent }, requiredProjectId(projectId));
    }
    if (call.name === "files_list") return route("files.list", { path: optionalString(args, "path") ?? "project:/" }, requiredProjectId(projectId));
    if (call.name === "files_read") {
      const result = asObject(await route("files.read", { path: requiredString(args, "path") }, requiredProjectId(projectId)));
      const data = requiredString(result, "data");
      return { path: requiredString(args, "path"), content: Buffer.from(data, "base64").toString("utf8").slice(0, 60_000), size: numberOr(result.size, 0) };
    }
    if (call.name === "files_write") {
      const path = requiredString(args, "path");
      const scopedProjectId = requiredProjectId(projectId);
      const content = requiredString(args, "content");
      this.authorization.assert(context.session.principal, "files.write", scopedProjectId);
      if (editPath !== undefined) {
        this.authorization.assert(context.session.principal, "agents.create", scopedProjectId);
        this.authorization.assert(context.session.principal, "agents.activate", scopedProjectId);
        await compileMarkdownAgent(content);
      }
      const exists = await this.projectStore(scopedProjectId).stat(path).then(() => true).catch(() => false);
      if (exists) assertAssistantConfirmation(latestUserMessage, "CONFIRMAR SOBRESCRIBIR", path);
      const written = asObject(await route("files.write", { path, content }, scopedProjectId));
      if (editPath === undefined) return written as JsonValue;
      const build = asObject(await route("agents.createFromProjectSource", {
        sourcePath: path,
        sourceKind: "markdown",
        activate: true,
      }, scopedProjectId));
      return {
        ...written,
        agentId: requiredString(build, "agentId"),
        agentVersionId: requiredString(build, "agentVersionId"),
        activated: build.activated === true,
      };
    }
    if (call.name === "files_trash") {
      const path = requiredString(args, "path");
      assertAssistantConfirmation(latestUserMessage, "CONFIRMAR ELIMINAR", path);
      return route("files.trash", { path }, requiredProjectId(projectId));
    }
    if (call.name === "runs_list") return route("runs.list", { limit: numberOr(args.limit, 20) }, requiredProjectId(projectId));
    if (call.name === "runs_invoke") {
      const agent = requiredString(args, "agent");
      assertAssistantConfirmation(latestUserMessage, "CONFIRMAR EJECUTAR", agent);
      return route("runs.invoke", { agent, input: isJsonObject(args.input) ? args.input : {} }, requiredProjectId(projectId));
    }
    if (call.name === "runs_cancel") {
      const runId = requiredString(args, "runId");
      assertAssistantConfirmation(latestUserMessage, "CONFIRMAR CANCELAR", runId);
      return route("runs.cancel", { runId }, requiredProjectId(projectId));
    }
    if (call.name === "providers_list") return route("providers.list", {});
    if (call.name === "model_roles_list") return route("modelRoles.list", {});
    if (call.name === "system_health") return route("system.health", {});
    if (call.name === "system_doctor") return route("system.doctor", {});
    throw serviceError("ASSISTANT_TOOL_NOT_FOUND", `Assistant tool ${call.name} is not registered`);
  }

  private async openUpload(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const fileName = requiredString(input, "fileName");
    if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") throw serviceError("UPLOAD_FILE_NAME_INVALID", "fileName must be a single safe path segment");
    const expectedSize = numberOr(input.size, -1);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > 100 * 1024 * 1024) throw serviceError("UPLOAD_SIZE_INVALID", "Upload size must be between 0 and 100 MiB");
    const purpose = optionalString(input, "purpose") ?? "project-file";
    if (!new Set(["project-file", "agent-source", "artifact-import"]).has(purpose)) throw serviceError("UPLOAD_PURPOSE_INVALID", "Upload purpose is invalid");
    const destination = optionalString(input, "destination");
    if ((purpose === "project-file" || purpose === "agent-source") && destination === undefined) throw serviceError("UPLOAD_DESTINATION_REQUIRED", "Upload destination is required");
    const expectedSha256 = optionalString(input, "sha256");
    if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/iu.test(expectedSha256)) throw serviceError("UPLOAD_HASH_INVALID", "sha256 must be a hexadecimal SHA-256 digest");
    const concurrent = this.database.raw.query<{ value: number }, [string, string]>("SELECT COUNT(*) AS value FROM uploads WHERE project_id=? AND status='open' AND expires_at>?").get(projectId, new Date().toISOString())?.value ?? 0;
    if (concurrent >= 10) throw serviceError("UPLOAD_CONCURRENCY_LIMIT", "Project has too many concurrent uploads");
    const uploadId = createId("upload");
    const home = this.repositories.getProjectHome(projectId);
    if (home === undefined) throw serviceError("PROJECT_HOME_NOT_FOUND", "Project Home is unavailable");
    const stagingDirectory = resolve(home.physicalPath, ".marcus", "uploads");
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    const stagingPath = resolve(stagingDirectory, `${uploadId}.part`);
    const handle = await open(stagingPath, "wx", 0o600);
    await handle.close();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    this.database.raw.query(`INSERT INTO uploads(upload_id, project_id, destination, file_name, purpose, expected_size, expected_sha256, received_size, staging_path, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'open', ?, ?)`)
      .run(uploadId, projectId, destination ?? null, fileName, purpose, expectedSize, expectedSha256 ?? null, stagingPath, expiresAt, createdAt);
    return { uploadId, chunkSize: 262_144, resumeOffset: 0, expiresAt };
  }

  private async trashProjectFile(projectId: string, actorId: string, path: string): Promise<JsonValue> {
    const result = await this.projectStore(projectId).trash(path, actorId);
    const deletedAt = new Date().toISOString();
    this.database.raw.query(`INSERT INTO trash_entries(trash_id, project_id, original_path, stored_path, deleted_at, deleted_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`).run(result.trashId, projectId, result.originalPath, result.storedPath, deletedAt, actorId);
    this.markProjectSourcesDirty(projectId, path);
    return { ...result, deletedAt };
  }

  private async restoreProjectFile(projectId: string, actorId: string, trashId: string): Promise<JsonValue> {
    type Row = { project_id: string; original_path: string; stored_path: string };
    const entry = this.database.raw.query<Row, [string]>("SELECT project_id, original_path, stored_path FROM trash_entries WHERE trash_id=?").get(trashId);
    if (entry === null || entry.project_id !== projectId) throw serviceError("TRASH_ENTRY_NOT_FOUND", `Trash entry ${trashId} not found`);
    const restored = await this.projectStore(projectId).restore(entry.stored_path, entry.original_path, actorId);
    this.database.raw.query("DELETE FROM trash_entries WHERE trash_id=?").run(trashId);
    this.markProjectSourcesDirty(projectId, entry.original_path);
    return { trashId, restored } as unknown as JsonValue;
  }

  private async watchProjectFiles(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const cursor = optionalString(input, "cursor") ?? "1970-01-01T00:00:00.000Z";
    if (!Number.isFinite(Date.parse(cursor))) throw serviceError("FILE_WATCH_CURSOR_INVALID", "File watch cursor must be an ISO timestamp");
    const reconciliation = await this.projectStore(projectId).reconcile();
    const nextCursor = new Date().toISOString();
    const prefix = (optionalString(input, "path") ?? "project:/").replace(/^project:\/+|^\/+|\/+$/gu, "");
    type Row = { file_id: string; relative_path: string; kind: string; size: number; sha256: string | null; revision: number; source: string; updated_at: string; deleted_at: string | null };
    const rows = this.database.raw.query<Row, [string, string, string, number]>(`SELECT file_id, relative_path, kind, size, sha256, revision, source, updated_at, deleted_at
      FROM project_files WHERE project_id=? AND updated_at>? AND relative_path LIKE ? ORDER BY updated_at, relative_path LIMIT ?`)
      .all(projectId, cursor, `${prefix}%`, Math.max(1, Math.min(numberOr(input.limit, 1_000), 5_000)));
    for (const row of rows) this.markProjectSourcesDirty(projectId, row.relative_path);
    return {
      cursor: nextCursor,
      reconciliation,
      changes: rows.map((row) => ({ fileId: row.file_id, path: `project:/${row.relative_path}`, kind: row.kind, size: row.size, ...(row.sha256 === null ? {} : { sha256: row.sha256 }), revision: row.revision, source: row.source, updatedAt: row.updated_at, ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }) })),
    };
  }

  private openSyncSession(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const fingerprint = requiredString(input, "localRootFingerprint");
    const projectRoot = requiredString(input, "projectRoot");
    this.projectStore(projectId).resolver.resolve(projectRoot);
    const mode = optionalString(input, "mode") ?? "push";
    if (mode !== "push") throw serviceError("SYNC_MODE_UNSUPPORTED", "Marcus v1 supports local-to-project push sync only");
    const deletePolicy = optionalString(input, "deletePolicy") ?? "preserve";
    if (deletePolicy !== "preserve" && deletePolicy !== "trash") throw serviceError("SYNC_DELETE_POLICY_INVALID", "deletePolicy must be preserve or trash");
    const syncId = `sync_${Bun.randomUUIDv7()}`;
    const now = new Date().toISOString();
    this.database.raw.query(`INSERT INTO sync_sessions(sync_id, project_id, local_root_fingerprint, project_root, mode, delete_policy, status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', '{}', ?, ?)`).run(syncId, projectId, fingerprint, projectRoot, mode, deletePolicy, now, now);
    return { syncId, projectId, projectRoot, mode, deletePolicy, status: "open", createdAt: now };
  }

  private listSyncSessions(projectId: string): JsonValue {
    const rows = this.database.raw.query<SyncRow, [string]>("SELECT * FROM sync_sessions WHERE project_id=? ORDER BY created_at DESC").all(projectId);
    return rows.map((row) => this.syncSessionJson(row)) as unknown as JsonValue;
  }

  private updateSyncSession(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const syncId = requiredString(input, "syncId");
    const row = this.requiredSyncSession(projectId, syncId);
    if (row.status !== "open") throw serviceError("SYNC_SESSION_CLOSED", `Sync session ${syncId} is ${row.status}`);
    const fingerprint = optionalString(input, "localRootFingerprint") ?? row.local_root_fingerprint;
    const state = input.state === undefined ? JSON.parse(row.state_json) as JsonValue : input.state;
    const updatedAt = new Date().toISOString();
    this.database.raw.query("UPDATE sync_sessions SET local_root_fingerprint=?, state_json=?, updated_at=? WHERE sync_id=? AND project_id=? AND status='open'")
      .run(fingerprint, JSON.stringify(state), updatedAt, syncId, projectId);
    return this.syncSessionJson(this.requiredSyncSession(projectId, syncId));
  }

  private closeSyncSession(projectId: string, syncId: string, status: "completed" | "stopped"): JsonValue {
    const row = this.requiredSyncSession(projectId, syncId);
    if (row.status === "open") {
      const updatedAt = new Date().toISOString();
      this.database.raw.query("UPDATE sync_sessions SET status=?, updated_at=? WHERE sync_id=? AND project_id=? AND status='open'")
        .run(status, updatedAt, syncId, projectId);
    }
    return this.syncSessionJson(this.requiredSyncSession(projectId, syncId));
  }

  private requiredSyncSession(projectId: string, syncId: string): SyncRow {
    const row = this.database.raw.query<SyncRow, [string]>("SELECT * FROM sync_sessions WHERE sync_id=?").get(syncId);
    if (row === null || row.project_id !== projectId) throw serviceError("SYNC_SESSION_NOT_FOUND", `Sync session ${syncId} not found`);
    return row;
  }

  private syncSessionJson(row: SyncRow): JsonValue {
    return {
      syncId: row.sync_id,
      projectId: row.project_id,
      localRootFingerprint: row.local_root_fingerprint,
      projectRoot: row.project_root,
      mode: row.mode,
      deletePolicy: row.delete_policy,
      status: row.status,
      state: JSON.parse(row.state_json) as JsonValue,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async writeUploadChunk(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const row = this.requiredUpload(projectId, requiredString(input, "uploadId"));
    if (row.status !== "open" || Date.parse(row.expires_at) <= Date.now()) throw serviceError("UPLOAD_NOT_OPEN", "Upload is closed or expired");
    const offset = numberOr(input.offset, -1);
    if (!Number.isSafeInteger(offset) || offset !== row.received_size) throw serviceError("UPLOAD_OFFSET_CONFLICT", `Expected upload offset ${row.received_size}`);
    const encoded = requiredString(input, "data");
    if (!/^[a-zA-Z0-9+/]*={0,2}$/u.test(encoded)) throw serviceError("UPLOAD_CHUNK_INVALID", "Upload chunk is not valid base64");
    const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
    if (bytes.byteLength > 262_144 || row.received_size + bytes.byteLength > row.expected_size) throw serviceError("UPLOAD_CHUNK_TOO_LARGE", "Upload chunk exceeds declared limits");
    const chunkHash = optionalString(input, "sha256");
    if (chunkHash !== undefined && new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== chunkHash.toLowerCase()) throw serviceError("UPLOAD_CHUNK_HASH_MISMATCH", "Upload chunk hash does not match");
    const handle = await open(row.staging_path, "r+");
    try { await handle.write(bytes, 0, bytes.byteLength, offset); await handle.sync(); }
    finally { await handle.close(); }
    const next = offset + bytes.byteLength;
    const changed = this.database.raw.query("UPDATE uploads SET received_size=? WHERE upload_id=? AND received_size=? AND status='open'").run(next, row.upload_id, offset);
    if (changed.changes !== 1) throw serviceError("UPLOAD_OFFSET_CONFLICT", "Upload offset changed concurrently");
    return { uploadId: row.upload_id, receivedSize: next, complete: next === row.expected_size };
  }

  private getUpload(projectId: string, uploadId: string): JsonValue {
    const row = this.requiredUpload(projectId, uploadId);
    return { uploadId: row.upload_id, projectId: row.project_id, ...(row.destination === null ? {} : { destination: row.destination }), fileName: row.file_name, purpose: row.purpose, expectedSize: row.expected_size, ...(row.expected_sha256 === null ? {} : { expectedSha256: row.expected_sha256 }), receivedSize: row.received_size, status: row.status, expiresAt: row.expires_at, createdAt: row.created_at };
  }

  private async commitUpload(projectId: string, actorId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const row = this.requiredUpload(projectId, requiredString(input, "uploadId"));
    if (row.status !== "open" || row.received_size !== row.expected_size) throw serviceError("UPLOAD_INCOMPLETE", `Upload received ${row.received_size} of ${row.expected_size} bytes`);
    const bytes = new Uint8Array(await Bun.file(row.staging_path).arrayBuffer());
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (row.expected_sha256 !== null && hash !== row.expected_sha256.toLowerCase()) throw serviceError("UPLOAD_HASH_MISMATCH", "Upload hash does not match");
    let committed: JsonValue;
    if (row.purpose === "project-file" || row.purpose === "agent-source") {
      committed = await this.projectStore(projectId).write(row.destination!, bytes, {
        actorId,
        ...(typeof input.expectedRevision === "number" ? { expectedRevision: input.expectedRevision } : {}),
      }) as unknown as JsonValue;
      this.markProjectSourcesDirty(projectId, row.destination!);
    } else {
      const run = this.requiredRun(projectId, requiredString(input, "runId"));
      const home = this.repositories.getProjectHome(projectId);
      if (home === undefined) throw serviceError("PROJECT_HOME_NOT_FOUND", "Project Home is unavailable");
      const visibility = optionalString(input, "visibility") ?? "private";
      if (visibility !== "private" && visibility !== "public" && visibility !== "signed") throw serviceError("ARTIFACT_VISIBILITY_INVALID", "Artifact visibility is invalid");
      const artifact = await new DiskArtifactStore(home.physicalPath).create({
        projectId,
        agentId: run.agentId,
        agentVersionId: run.agentVersionId,
        runId: run.runId,
        name: row.file_name,
        mediaType: optionalString(input, "mediaType") ?? "application/octet-stream",
        bytes,
        visibility,
      });
      this.database.raw.query("INSERT INTO artifacts(artifact_id, project_id, agent_id, agent_version_id, run_id, task_id, name, media_type, size, sha256, storage_uri, visibility, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)")
        .run(artifact.artifactId, artifact.projectId, artifact.agentId, artifact.agentVersionId, artifact.runId, artifact.name, artifact.mediaType, artifact.size, artifact.sha256, artifact.storageUri, artifact.visibility, artifact.createdAt);
      committed = artifact as unknown as JsonValue;
    }
    this.database.raw.query("UPDATE uploads SET status='committed' WHERE upload_id=?").run(row.upload_id);
    await rm(row.staging_path, { force: true });
    return { uploadId: row.upload_id, status: "committed", sha256: hash, result: committed };
  }

  private async abortUpload(projectId: string, uploadId: string): Promise<JsonValue> {
    const row = this.requiredUpload(projectId, uploadId);
    if (row.status === "open") this.database.raw.query("UPDATE uploads SET status='aborted' WHERE upload_id=?").run(uploadId);
    await rm(row.staging_path, { force: true });
    return { uploadId, status: "aborted" };
  }

  private requiredUpload(projectId: string, uploadId: string): UploadRow {
    const row = this.database.raw.query<UploadRow, [string]>("SELECT * FROM uploads WHERE upload_id=?").get(uploadId);
    if (row === null || row.project_id !== projectId) throw serviceError("UPLOAD_NOT_FOUND", `Upload ${uploadId} not found`);
    return row;
  }

  private listArtifacts(projectId: string, runId?: string): JsonValue {
    type Row = { artifact_id: string; project_id: string; agent_id: string; agent_version_id: string; run_id: string; task_id: string | null; name: string; media_type: string; size: number; sha256: string; storage_uri: string; visibility: string; created_at: string };
    const rows = runId === undefined
      ? this.database.raw.query<Row, [string]>("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
      : this.database.raw.query<Row, [string, string]>("SELECT * FROM artifacts WHERE project_id = ? AND run_id = ? ORDER BY created_at DESC").all(projectId, runId);
    return rows.map((row) => ({ artifactId: row.artifact_id, projectId: row.project_id, agentId: row.agent_id, agentVersionId: row.agent_version_id, runId: row.run_id, ...(row.task_id === null ? {} : { taskId: row.task_id }), name: row.name, mediaType: row.media_type, size: row.size, sha256: row.sha256, storageUri: row.storage_uri, visibility: row.visibility, createdAt: row.created_at })) as unknown as JsonValue;
  }

  private async readArtifact(projectId: string, artifactId: string): Promise<JsonValue> {
    type Row = { artifact_id: string; project_id: string; agent_id: string; agent_version_id: string; run_id: string; task_id: string | null; name: string; media_type: string; size: number; sha256: string; storage_uri: string; visibility: "private" | "public" | "signed"; created_at: string };
    const row = this.database.raw.query<Row, [string]>("SELECT * FROM artifacts WHERE artifact_id=?").get(artifactId);
    if (row === null || row.project_id !== projectId) throw serviceError("ARTIFACT_NOT_FOUND", `Artifact ${artifactId} not found`);
    const home = this.repositories.getProjectHome(projectId);
    if (home === undefined) throw serviceError("PROJECT_HOME_NOT_FOUND", "Project Home is unavailable");
    const record: ArtifactRecord = { artifactId: row.artifact_id, projectId: row.project_id, agentId: row.agent_id, agentVersionId: row.agent_version_id, runId: row.run_id, name: row.name, mediaType: row.media_type, size: row.size, sha256: row.sha256, storageUri: row.storage_uri, visibility: row.visibility, createdAt: row.created_at, ...(row.task_id === null ? {} : { taskId: row.task_id }) };
    const bytes = await new DiskArtifactStore(home.physicalPath).read(record);
    return { ...record, encoding: "base64", data: bytes.toBase64() } as unknown as JsonValue;
  }

  private async readAgentAsset(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const agent = this.requiredAgent(projectId, requiredString(input, "agent"));
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Agent active version is unavailable");
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    if (manifest?.assets?.expose !== true) throw serviceError("AGENT_ASSETS_DISABLED", "Agent static assets are not exposed");
    const requested = requiredString(input, "path").replace(/^\/+/, "");
    const artifactPath = this.repositories.getAgentArtifactUri(agent.activeVersionId);
    if (artifactPath === undefined) throw serviceError("AGENT_ARTIFACT_MISSING", "Agent artifact is unavailable");
    const root = resolve(artifactPath, "..", manifest.assets.staticDir);
    const target = resolve(root, requested);
    if (target !== root && !target.startsWith(`${root}/`)) throw serviceError("PATH_ESCAPE", "Asset path escapes static directory");
    const file = Bun.file(target);
    if (!(await file.exists())) throw serviceError("ASSET_NOT_FOUND", "Agent asset not found");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { encoding: "base64", data: bytes.toBase64(), size: bytes.byteLength, mediaType: mediaTypeFor(requested), sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
  }

  private listConversations(projectId: string, payload: JsonValue): JsonValue {
    const limit = Math.max(1, Math.min(numberOr(asObject(payload).limit, 100), 1_000));
    return this.database.raw.query<ConversationRow, [string, number]>("SELECT * FROM conversations WHERE project_id=? ORDER BY updated_at DESC LIMIT ?").all(projectId, limit)
      .map(mapConversation) as unknown as JsonValue;
  }

  private getConversation(projectId: string, conversationId: string): JsonValue {
    const row = this.database.raw.query<ConversationRow, [string]>("SELECT * FROM conversations WHERE conversation_id=?").get(conversationId);
    if (row === null || row.project_id !== projectId) throw serviceError("CONVERSATION_NOT_FOUND", `Conversation ${conversationId} not found`);
    return mapConversation(row) as unknown as JsonValue;
  }

  private conversationRuntimeContext(conversationId: string): { id: string; chatId: string; principalId?: string } | undefined {
    const row = this.database.raw.query<ConversationRow, [string]>("SELECT * FROM conversations WHERE conversation_id=?").get(conversationId);
    if (row === null) return undefined;
    return { id: row.conversation_id, chatId: row.chat_id ?? row.conversation_id, ...(row.principal_id === null ? {} : { principalId: row.principal_id }) };
  }

  private conversationMessages(conversationId: string, limit: number, beforeSequence?: number): JsonValue {
    type Row = { conversation_message_id: string; conversation_id: string; sequence: number; role: string; content_json: string; run_id: string | null; agent_version_id: string | null; metadata_json: string; created_at: string };
    const bounded = Math.max(1, Math.min(limit, 1_000));
    const rows = beforeSequence === undefined
      ? this.database.raw.query<Row, [string, number]>("SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY sequence DESC LIMIT ?").all(conversationId, bounded)
      : this.database.raw.query<Row, [string, number, number]>("SELECT * FROM conversation_messages WHERE conversation_id=? AND sequence < ? ORDER BY sequence DESC LIMIT ?").all(conversationId, beforeSequence, bounded);
    return rows.reverse().map((row) => ({ conversationMessageId: row.conversation_message_id, conversationId: row.conversation_id, sequence: row.sequence, role: row.role, content: JSON.parse(row.content_json), ...(row.run_id === null ? {} : { runId: row.run_id }), ...(row.agent_version_id === null ? {} : { agentVersionId: row.agent_version_id }), metadata: JSON.parse(row.metadata_json), createdAt: row.created_at })) as unknown as JsonValue;
  }

  private conversationModelHistory(conversationId: string, currentRunId: string, limit: number): ModelGenerationRequest["messages"] {
    type Row = { role: string; content_json: string };
    const roles = new Set(["system", "user", "assistant", "tool"]);
    return this.database.raw.query<Row, [string, string, number]>(`SELECT role, content_json FROM conversation_messages
      WHERE conversation_id=? AND (run_id IS NULL OR run_id != ?) ORDER BY sequence DESC LIMIT ?`)
      .all(conversationId, currentRunId, Math.max(1, Math.min(limit, 1_000)))
      .reverse()
      .filter((row) => roles.has(row.role))
      .map((row) => ({ role: row.role as "system" | "user" | "assistant" | "tool", content: JSON.parse(row.content_json) as JsonValue }));
  }

  private clearConversation(projectId: string, conversationId: string): JsonValue {
    this.getConversation(projectId, conversationId);
    const result = this.database.raw.query("DELETE FROM conversation_messages WHERE conversation_id=?").run(conversationId);
    this.database.raw.query("UPDATE conversations SET next_sequence=1, updated_at=? WHERE conversation_id=?").run(new Date().toISOString(), conversationId);
    return { conversationId, clearedMessages: result.changes };
  }

  private async invokeSubagent(parent: RunRecord, input: Record<string, JsonValue | Uint8Array>, envelope: RuntimeEnvelope, defaultWait = true): Promise<JsonValue> {
    const agent = this.requiredAgent(parent.projectId, requiredString(input, "agent"));
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", `Subagent ${agent.slug} has no active version`);
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    if (manifest === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", `Subagent ${agent.slug} manifest not found`);
    const handle = this.kernel.invokeAgent({
      projectId: parent.projectId,
      agentId: agent.agentId,
      entrypoint: internalEntrypoint(manifest),
      input: (input.input ?? {}) as JsonValue,
      ...(parent.principalId === undefined ? {} : { principal: { id: parent.principalId, type: "user" } }),
      correlationId: envelope.correlationId,
      causationId: parent.runId,
      traceId: parent.traceId,
    });
    this.attachExecutionGraph(parent, handle.runId, optionalString(input, "parentClose") ?? "request-cancel");
    this.kickDispatcher();
    const shouldWait = input.wait === false ? false : defaultWait;
    if (!shouldWait) return handle as unknown as JsonValue;
    return this.waitForRunOutput(handle.runId);
  }

  private attachExecutionGraph(parent: RunRecord, childRunId: string, parentClosePolicy: string): void {
    if (!["terminate", "request-cancel", "detach"].includes(parentClosePolicy)) throw serviceError("SUBAGENT_PARENT_CLOSE_INVALID", "parentClose policy is invalid");
    let graphId = this.database.raw.query<{ graph_id: string }, [string, string]>(`SELECT graph_id FROM execution_graphs WHERE root_run_id=?
      UNION SELECT graph_id FROM execution_edges WHERE child_run_id=? LIMIT 1`).get(parent.runId, parent.runId)?.graph_id;
    const now = new Date().toISOString();
    if (graphId === undefined) {
      graphId = createId("graph");
      this.database.raw.query("INSERT INTO execution_graphs(graph_id, project_id, root_run_id, status, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)")
        .run(graphId, parent.projectId, parent.runId, now, now);
    }
    this.database.raw.query(`INSERT INTO execution_edges(graph_id, parent_run_id, child_run_id, relationship, join_group_id, parent_close_policy)
      VALUES (?, ?, ?, 'subagent', NULL, ?)`)
      .run(graphId, parent.runId, childRunId, parentClosePolicy);
    this.database.raw.query("UPDATE execution_graphs SET updated_at=? WHERE graph_id=?").run(now, graphId);
  }

  private async waitForRunOutput(runId: string): Promise<JsonValue> {
    for (;;) {
      const run = this.repositories.getRun(runId);
      if (run === undefined) throw serviceError("RUN_NOT_FOUND", `Child Run ${runId} not found`);
      if (run.state === "completed") return run.output ?? null;
      if (isTerminalRunState(run.state)) {
        throw new MarcusError(run.error ?? { code: "SUBAGENT_FAILED", message: `Child Run ${runId} ended as ${run.state}`, retryable: false });
      }
      await Bun.sleep(20);
    }
  }

  private applyParentClosePolicy(parentRunId: string): void {
    type Row = { child_run_id: string; parent_close_policy: string };
    for (const edge of this.database.raw.query<Row, [string]>("SELECT child_run_id, parent_close_policy FROM execution_edges WHERE parent_run_id=?").all(parentRunId)) {
      if (edge.parent_close_policy === "detach") continue;
      const child = this.repositories.getRun(edge.child_run_id);
      if (child === undefined || isTerminalRunState(child.state)) continue;
      if (edge.parent_close_policy === "terminate" && !["accepted", "queued"].includes(child.state)) {
        this.kernel.killRun(child.runId, `Parent Run ${parentRunId} closed`);
      } else {
        this.kernel.cancelRun(child.runId);
      }
      const runtime = this.activeRuns.get(child.runId);
      if (runtime !== undefined) void runtime.cancelRun(child.runId, `Parent Run ${parentRunId} closed`).catch(() => undefined);
    }
  }

  private sendMessage(projectId: string, sender: { principalId?: string; agentId?: string; runId?: string }, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const address = requiredString(input, "recipient");
    const type = requiredString(input, "type");
    if (address.length > 256 || type.length > 128) throw serviceError("MESSAGE_INVALID", "Message recipient or type is too long");
    const stored = this.database.transaction(() => {
      let mailbox = this.database.raw.query<{ mailbox_id: string; next_sequence: number; max_pending: number }, [string, string]>("SELECT mailbox_id, next_sequence, max_pending FROM mailboxes WHERE project_id=? AND address=?").get(projectId, address);
      if (mailbox === null) {
        const mailboxId = `mailbox_${Bun.randomUUIDv7()}`;
        this.database.raw.query("INSERT INTO mailboxes(mailbox_id, project_id, address, next_sequence, max_pending) VALUES (?, ?, ?, 1, 1000)").run(mailboxId, projectId, address);
        mailbox = { mailbox_id: mailboxId, next_sequence: 1, max_pending: 1000 };
      }
      const pending = this.database.raw.query<{ value: number }, [string]>(`SELECT COUNT(*) AS value FROM messages m JOIN message_deliveries d ON d.message_id=m.message_id
        WHERE m.mailbox_id=? AND d.state IN ('pending','available','delivered')`).get(mailbox.mailbox_id)?.value ?? 0;
      if (pending >= mailbox.max_pending) throw serviceError("MAILBOX_BACKPRESSURE", `Mailbox ${address} is full`);
      const messageId = createId("message");
      const now = new Date().toISOString();
      const correlationId = sender.runId === undefined ? createId("trace") : this.repositories.getRun(sender.runId)?.correlationId ?? createId("trace");
      const traceId = sender.runId === undefined ? createId("trace") : this.repositories.getRun(sender.runId)?.traceId ?? createId("trace");
      this.database.raw.query(`INSERT INTO messages(message_id, project_id, mailbox_id, mailbox_sequence, message_type, sender_json, recipient_json,
        run_id, task_id, correlation_id, causation_id, reply_to, priority, deadline_at, content_type, payload_json, artifact_refs_json, trace_id,
        deduplication_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 'normal', NULL, 'application/json', ?, '[]', ?, NULL, NULL, ?)`)
        .run(messageId, projectId, mailbox.mailbox_id, mailbox.next_sequence, type, JSON.stringify(sender), JSON.stringify({ address }), sender.runId ?? null, correlationId, sender.runId ?? null, JSON.stringify(input.payload ?? null), traceId, now);
      this.database.raw.query("UPDATE mailboxes SET next_sequence=next_sequence+1 WHERE mailbox_id=?").run(mailbox.mailbox_id);
      this.database.raw.query("INSERT INTO message_deliveries(delivery_id, message_id, attempt, state, available_at) VALUES (?, ?, 0, 'available', ?)")
        .run(`delivery_${Bun.randomUUIDv7()}`, messageId, now);
      return { messageId, mailboxSequence: mailbox.next_sequence };
    });
    const triggeredRunId = this.dispatchMessage(stored.messageId);
    return { ...stored, ...(triggeredRunId === undefined ? {} : { triggeredRunId }) };
  }

  private dispatchMessage(messageId: string): string | undefined {
    type Row = {
      message_id: string; project_id: string; message_type: string; sender_json: string; correlation_id: string;
      trace_id: string; payload_json: string | null; address: string; delivery_id: string; attempt: number; state: string;
    };
    const row = this.database.raw.query<Row, [string]>(`SELECT m.message_id, m.project_id, m.message_type, m.sender_json, m.correlation_id,
        m.trace_id, m.payload_json, b.address, d.delivery_id, d.attempt, d.state
      FROM messages m JOIN mailboxes b ON b.mailbox_id=m.mailbox_id
      JOIN message_deliveries d ON d.message_id=m.message_id WHERE m.message_id=?`).get(messageId);
    if (row === null || row.state !== "available") return undefined;
    const slug = row.address.startsWith("agent:") ? row.address.slice(6) : row.address;
    const agent = this.repositories.getAgentBySlug(row.project_id, slug);
    if (agent?.status !== "active" || agent.activeVersionId === undefined) return undefined;
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    if (manifest?.entrypoints.messages?.enabled !== true) return undefined;
    const claimed = this.database.raw.query("UPDATE message_deliveries SET state='delivering', attempt=attempt+1 WHERE delivery_id=? AND state='available'").run(row.delivery_id);
    if (claimed.changes !== 1) return undefined;
    const attempt = row.attempt + 1;
    try {
      const sender = JSON.parse(row.sender_json) as { principalId?: string; agentId?: string };
      const handle = this.kernel.invokeAgent({
        projectId: row.project_id,
        agentId: agent.agentId,
        entrypoint: "message",
        input: row.payload_json === null ? null : JSON.parse(row.payload_json) as JsonValue,
        principal: { id: sender.principalId ?? sender.agentId ?? "marcus-message-router", type: sender.agentId === undefined ? "service-account" : "external" },
        idempotencyKey: `message:${row.message_id}:${attempt}`,
        correlationId: row.correlation_id,
        causationId: row.message_id,
        traceId: row.trace_id,
      });
      this.database.raw.query("UPDATE message_deliveries SET state='delivered', delivered_at=? WHERE delivery_id=?")
        .run(new Date().toISOString(), row.delivery_id);
      this.kickDispatcher();
      return handle.runId;
    } catch (error) {
      this.rescheduleMessage(row.delivery_id, row.message_id, attempt, error);
      return undefined;
    }
  }

  private async dispatchAvailableMessages(): Promise<void> {
    if (this.messageDispatching || this.closed || this.maintenance) return;
    this.messageDispatching = true;
    try {
      const rows = this.database.raw.query<{ message_id: string }, [string]>(`SELECT m.message_id FROM messages m
        JOIN message_deliveries d ON d.message_id=m.message_id
        WHERE d.state='available' AND d.available_at<=? ORDER BY d.available_at, m.created_at LIMIT 100`).all(new Date().toISOString());
      for (const row of rows) this.dispatchMessage(row.message_id);
    } finally {
      this.messageDispatching = false;
    }
  }

  private settleMessageDelivery(run: RunRecord): void {
    if (run.causationId === undefined) return;
    const delivery = this.database.raw.query<{ delivery_id: string; attempt: number; state: string }, [string]>(`SELECT d.delivery_id, d.attempt, d.state
      FROM message_deliveries d WHERE d.message_id=?`).get(run.causationId);
    if (delivery === null || delivery.state !== "delivered") return;
    const current = this.repositories.getRun(run.runId);
    if (current?.state === "completed") {
      this.database.raw.query("UPDATE message_deliveries SET state='acknowledged', acknowledged_at=? WHERE delivery_id=? AND state='delivered'")
        .run(new Date().toISOString(), delivery.delivery_id);
    } else if (current !== undefined && isTerminalRunState(current.state)) {
      this.rescheduleMessage(delivery.delivery_id, run.causationId, delivery.attempt, current.error ?? { code: "MESSAGE_HANDLER_FAILED", message: `Run ended as ${current.state}` });
    }
  }

  private rescheduleMessage(deliveryId: string, messageId: string, attempt: number, error: unknown): void {
    const serialized = JSON.stringify({
      code: error instanceof MarcusError ? error.code : "MESSAGE_DELIVERY_FAILED",
      message: error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error),
    });
    if (attempt >= 3) {
      this.database.transaction(() => {
        this.database.raw.query("UPDATE message_deliveries SET state='dead_lettered', error_json=? WHERE delivery_id=?").run(serialized, deliveryId);
        this.database.raw.query("INSERT INTO dead_letters(dead_letter_id, message_id, reason, error_json, created_at) VALUES (?, ?, 'delivery-attempts-exhausted', ?, ?)")
          .run(`dead_${Bun.randomUUIDv7()}`, messageId, serialized, new Date().toISOString());
      });
      return;
    }
    const availableAt = new Date(Date.now() + 2 ** Math.max(0, attempt - 1) * 1_000).toISOString();
    this.database.raw.query("UPDATE message_deliveries SET state='available', available_at=?, error_json=? WHERE delivery_id=?")
      .run(availableAt, serialized, deliveryId);
  }

  private reconcileMessageDeliveries(): void {
    type Row = { delivery_id: string; message_id: string; attempt: number };
    for (const delivery of this.database.raw.query<Row, []>("SELECT delivery_id, message_id, attempt FROM message_deliveries WHERE state IN ('delivering','delivered')").all()) {
      const completed = this.database.raw.query<{ value: number }, [string]>("SELECT COUNT(*) AS value FROM runs WHERE causation_id=? AND state='completed'").get(delivery.message_id)?.value ?? 0;
      if (completed > 0) {
        this.database.raw.query("UPDATE message_deliveries SET state='acknowledged', acknowledged_at=COALESCE(acknowledged_at, ?) WHERE delivery_id=?")
          .run(new Date().toISOString(), delivery.delivery_id);
      } else {
        this.rescheduleMessage(delivery.delivery_id, delivery.message_id, delivery.attempt, serviceError("MESSAGE_DELIVERY_INTERRUPTED", "Delivery was interrupted by daemon restart"));
      }
    }
  }

  private listMessages(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const limit = Math.max(1, Math.min(numberOr(input.limit, 100), 1_000));
    const address = optionalString(input, "address");
    type Row = { message_id: string; mailbox_sequence: number; message_type: string; sender_json: string; recipient_json: string; run_id: string | null; correlation_id: string; causation_id: string | null; priority: string; content_type: string; payload_json: string | null; trace_id: string; created_at: string; address: string; state: string };
    const rows = address === undefined
      ? this.database.raw.query<Row, [string, number]>(`SELECT m.*, b.address, d.state FROM messages m JOIN mailboxes b ON b.mailbox_id=m.mailbox_id
          JOIN message_deliveries d ON d.message_id=m.message_id WHERE m.project_id=? ORDER BY m.created_at DESC LIMIT ?`).all(projectId, limit)
      : this.database.raw.query<Row, [string, string, number]>(`SELECT m.*, b.address, d.state FROM messages m JOIN mailboxes b ON b.mailbox_id=m.mailbox_id
          JOIN message_deliveries d ON d.message_id=m.message_id WHERE m.project_id=? AND b.address=? ORDER BY m.created_at DESC LIMIT ?`).all(projectId, address, limit);
    return rows.map((row) => ({ messageId: row.message_id, address: row.address, sequence: row.mailbox_sequence, type: row.message_type, sender: JSON.parse(row.sender_json), recipient: JSON.parse(row.recipient_json), ...(row.run_id === null ? {} : { runId: row.run_id }), correlationId: row.correlation_id, ...(row.causation_id === null ? {} : { causationId: row.causation_id }), priority: row.priority, contentType: row.content_type, payload: row.payload_json === null ? null : JSON.parse(row.payload_json), traceId: row.trace_id, state: row.state, createdAt: row.created_at })) as unknown as JsonValue;
  }

  private ackMessage(projectId: string, messageId: string): JsonValue {
    const exists = this.database.raw.query<{ value: number }, [string, string]>("SELECT COUNT(*) AS value FROM messages WHERE message_id=? AND project_id=?").get(messageId, projectId)?.value ?? 0;
    if (exists === 0) throw serviceError("MESSAGE_NOT_FOUND", `Message ${messageId} not found`);
    const now = new Date().toISOString();
    this.database.raw.query("UPDATE message_deliveries SET state='acknowledged', acknowledged_at=? WHERE message_id=?").run(now, messageId);
    return { messageId, state: "acknowledged", acknowledgedAt: now };
  }

  private publishEvent(projectId: string, payload: JsonValue, actorId: string, parent?: RunRecord): JsonValue {
    const input = asObject(payload);
    const topic = requiredString(input, "topic");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(topic)) throw serviceError("EVENT_TOPIC_INVALID", "Event topic is invalid");
    const traceId = parent?.traceId ?? createId("trace");
    const correlationId = parent?.correlationId ?? traceId;
    const event = this.repositories.appendKernelEvent({
      eventType: "event.published", nodeId: this.config.nodeId, projectId, ...(parent === undefined ? {} : { agentId: parent.agentId, runId: parent.runId }),
      actor: { principalId: actorId }, correlationId, ...(parent === undefined ? {} : { causationId: parent.runId }), traceId,
      payload: { topic, payload: (input.payload ?? null) as JsonValue },
    });
    const triggered: string[] = [];
    for (const agent of this.repositories.listAgentDefinitions(projectId)) {
      if (agent.status !== "active" || agent.activeVersionId === undefined) continue;
      const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
      if (!(manifest?.entrypoints.events?.some((binding) => binding.topic === topic) ?? false)) continue;
      const handle = this.kernel.invokeAgent({ projectId, agentId: agent.agentId, entrypoint: "event", input: (input.payload ?? null) as JsonValue,
        principal: { id: actorId, type: parent === undefined ? "user" : "external" }, correlationId, causationId: event.eventId, traceId });
      triggered.push(handle.runId);
    }
    if (triggered.length > 0) this.kickDispatcher();
    return { eventId: event.eventId, eventSeq: event.eventSeq, triggeredRuns: triggered };
  }

  private listApprovals(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const limit = Math.max(1, Math.min(numberOr(input.limit, 100), 1_000));
    const status = optionalString(input, "status");
    type Row = { approval_id: string; project_id: string; run_id: string; action: string; prompt: string; data_json: string | null; status: string; requested_at: string; resolved_at: string | null; resolved_by: string | null; resolution_json: string | null };
    const rows = status === undefined
      ? this.database.raw.query<Row, [string, number]>("SELECT * FROM approval_requests WHERE project_id=? ORDER BY requested_at DESC LIMIT ?").all(projectId, limit)
      : this.database.raw.query<Row, [string, string, number]>("SELECT * FROM approval_requests WHERE project_id=? AND status=? ORDER BY requested_at DESC LIMIT ?").all(projectId, status, limit);
    return rows.map((row) => ({ approvalId: row.approval_id, projectId: row.project_id, runId: row.run_id, action: row.action, prompt: row.prompt, ...(row.data_json === null ? {} : { data: JSON.parse(row.data_json) }), status: row.status, requestedAt: row.requested_at, ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }), ...(row.resolved_by === null ? {} : { resolvedBy: row.resolved_by }), ...(row.resolution_json === null ? {} : { resolution: JSON.parse(row.resolution_json) }) })) as unknown as JsonValue;
  }

  private requestApproval(run: RunRecord, payload: JsonValue, onCreated?: (approvalId: string) => void): Promise<JsonValue> {
    const input = asObject(payload);
    const approvalId = `approval_${Bun.randomUUIDv7()}`;
    const action = requiredString(input, "action");
    const prompt = requiredString(input, "prompt");
    const now = new Date().toISOString();
    this.database.raw.query(`INSERT INTO approval_requests(approval_id, project_id, run_id, action, prompt, data_json, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(approvalId, run.projectId, run.runId, action, prompt, input.data === undefined ? null : JSON.stringify(input.data), now);
    onCreated?.(approvalId);
    this.kernel.markWaitingForApproval(run.runId);
    return new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(approvalId);
        this.database.raw.query("UPDATE approval_requests SET status='expired', resolved_at=? WHERE approval_id=? AND status='pending'").run(new Date().toISOString(), approvalId);
        reject(serviceError("APPROVAL_EXPIRED", `Approval ${approvalId} expired`));
      }, 86_400_000);
      this.pendingApprovals.set(approvalId, { runId: run.runId, resolve, reject, timer });
    });
  }

  private decideApproval(projectId: string, principalId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const approvalId = requiredString(input, "approvalId");
    const decision = requiredString(input, "decision");
    if (decision !== "approve" && decision !== "reject") throw serviceError("APPROVAL_DECISION_INVALID", "decision must be approve or reject");
    const row = this.database.raw.query<{ project_id: string; run_id: string; status: string }, [string]>("SELECT project_id, run_id, status FROM approval_requests WHERE approval_id=?").get(approvalId);
    if (row === null || row.project_id !== projectId) throw serviceError("APPROVAL_NOT_FOUND", `Approval ${approvalId} not found`);
    if (row.status !== "pending") throw serviceError("APPROVAL_ALREADY_RESOLVED", `Approval ${approvalId} is ${row.status}`);
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) throw serviceError("APPROVAL_RUNTIME_UNAVAILABLE", "Approval Run is not attached to this daemon instance");
    const resolution = (input.resolution ?? { approved: decision === "approve" }) as JsonValue;
    const now = new Date().toISOString();
    this.database.raw.query("UPDATE approval_requests SET status=?, resolved_at=?, resolved_by=?, resolution_json=? WHERE approval_id=?")
      .run(decision === "approve" ? "approved" : "rejected", now, principalId, JSON.stringify(resolution), approvalId);
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(approvalId);
    if (decision === "approve") {
      this.kernel.resumeRun(row.run_id);
      pending.resolve(resolution);
    } else {
      pending.reject(serviceError("APPROVAL_REJECTED", `Approval ${approvalId} was rejected`));
    }
    return { approvalId, status: decision === "approve" ? "approved" : "rejected", resolvedAt: now };
  }

  private listInstances(projectId: string, agentId?: string): JsonValue {
    type Row = { instance_id: string; agent_id: string; agent_version_id: string; runtime_profile: string; residency: string; mpid: string; os_pid: number | null; state: string; health: string; restarted_from_instance_id: string | null; started_at: string; stopped_at: string | null };
    const rows = agentId === undefined
      ? this.database.raw.query<Row, [string]>("SELECT i.* FROM agent_instances i JOIN agent_definitions a ON a.agent_id=i.agent_id WHERE a.project_id=? ORDER BY i.started_at DESC").all(projectId)
      : this.database.raw.query<Row, [string, string]>("SELECT i.* FROM agent_instances i JOIN agent_definitions a ON a.agent_id=i.agent_id WHERE a.project_id=? AND i.agent_id=? ORDER BY i.started_at DESC").all(projectId, agentId);
    return rows.map((row) => ({ instanceId: row.instance_id, agentId: row.agent_id, agentVersionId: row.agent_version_id, runtimeProfile: row.runtime_profile, residency: row.residency, mpid: row.mpid, ...(row.os_pid === null ? {} : { osPid: row.os_pid }), state: row.state, health: row.health, ...(row.restarted_from_instance_id === null ? {} : { restartedFromInstanceId: row.restarted_from_instance_id }), startedAt: row.started_at, ...(row.stopped_at === null ? {} : { stoppedAt: row.stopped_at }) })) as unknown as JsonValue;
  }

  private listProcesses(projectId: string | undefined, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const all = projectId === undefined
      ? this.database.raw.query<ProcessRow, []>("SELECT * FROM processes ORDER BY started_at DESC").all()
      : this.database.raw.query<ProcessRow, [string]>("SELECT * FROM processes WHERE project_id = ? ORDER BY started_at DESC").all(projectId);
    const state = optionalString(input, "state");
    const agent = optionalString(input, "agent");
    const includeTerminal = input.includeTerminal !== false;
    const filtered = all.filter((row) => (state === undefined || row.state === state)
      && (agent === undefined || row.agent_id === agent)
      && (includeTerminal || !["stopped", "failed", "killed", "zombie"].includes(row.state)));
    return filtered.map(mapProcess) as unknown as JsonValue;
  }

  private processTop(projectId: string | undefined, payload: JsonValue): JsonValue {
    const processes = this.listProcesses(projectId, payload) as JsonValue[];
    const running = processes.filter((item) => isJsonObject(item) && ["running", "ready", "waiting"].includes(String(item.state))).length;
    return { sampledAt: new Date().toISOString(), counts: { total: processes.length, running, activeRuns: this.activeRuns.size }, processes };
  }

  private getProcess(mpid: string, projectId?: string): JsonValue {
    const row = this.database.raw.query<ProcessRow, [string]>("SELECT * FROM processes WHERE mpid = ?").get(mpid);
    if (row === null || (projectId !== undefined && row.project_id !== projectId)) throw serviceError("PROCESS_NOT_FOUND", `Process ${mpid} not found`);
    return mapProcess(row) as unknown as JsonValue;
  }

  private async killProcess(mpid: string, projectId?: string): Promise<JsonValue> {
    const row = this.database.raw.query<ProcessRow, [string]>("SELECT * FROM processes WHERE mpid = ?").get(mpid);
    if (row === null || (projectId !== undefined && row.project_id !== projectId)) throw serviceError("PROCESS_NOT_FOUND", `Process ${mpid} not found`);
    const resident = [...this.residentInstances.values()].find((candidate) => candidate.runtime.mpid === mpid || candidate.instanceMpid === mpid);
    if (resident !== undefined) {
      await this.stopResidentInstance(resident, "killed");
      return this.getProcess(mpid, projectId);
    }
    const active = [...this.activeRuns.entries()].find(([, runtime]) => runtime.mpid === mpid);
    if (active === undefined) throw serviceError("PROCESS_NOT_ACTIVE", `Process ${mpid} is not active`);
    const [runId, runtime] = active;
    await runtime.close();
    const run = this.repositories.getRun(runId);
    if (run !== undefined && !isTerminalRunState(run.state)) this.kernel.killRun(runId, `Process ${mpid} was killed by an operator`);
    const now = new Date().toISOString();
    this.database.raw.query("UPDATE processes SET state='killed', health='unknown', signal='operator', last_heartbeat_at=COALESCE(last_heartbeat_at, ?) WHERE mpid=?").run(now, mpid);
    if (row.instance_id !== null) this.database.raw.query("UPDATE agent_instances SET state='killed', health='unknown', stopped_at=? WHERE instance_id=?").run(now, row.instance_id);
    return this.getProcess(mpid, projectId);
  }

  private listEvents(projectId: string, payload: JsonValue): JsonValue {
    const limit = Math.max(1, Math.min(numberOr(asObject(payload).limit, 100), 1_000));
    type Row = { event_seq: number; event_id: string; event_type: string; node_id: string; agent_id: string | null; run_id: string | null; mpid: string | null; correlation_id: string; causation_id: string | null; trace_id: string; occurred_at: string; payload_json: string };
    return this.database.raw.query<Row, [string, number]>("SELECT * FROM kernel_events WHERE project_id = ? ORDER BY event_seq DESC LIMIT ?").all(projectId, limit)
      .map((row) => ({ eventSeq: row.event_seq, eventId: row.event_id, eventType: row.event_type, nodeId: row.node_id, projectId, ...(row.agent_id === null ? {} : { agentId: row.agent_id }), ...(row.run_id === null ? {} : { runId: row.run_id }), ...(row.mpid === null ? {} : { mpid: row.mpid }), correlationId: row.correlation_id, ...(row.causation_id === null ? {} : { causationId: row.causation_id }), traceId: row.trace_id, occurredAt: row.occurred_at, payload: JSON.parse(row.payload_json) })) as unknown as JsonValue;
  }

  private listLogs(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const limit = Math.max(1, Math.min(numberOr(input.limit, 100), 1_000));
    const runId = optionalString(input, "runId");
    const agentId = optionalString(input, "agentId");
    const mpid = optionalString(input, "mpid");
    type Row = { event_seq: number; event_id: string; agent_id: string | null; run_id: string | null; mpid: string | null; trace_id: string; occurred_at: string; payload_json: string };
    const rows = this.database.raw.query<Row, [string, string | null, string | null, string | null, string | null, string | null, string | null, number]>(`SELECT event_seq, event_id, agent_id, run_id, mpid, trace_id, occurred_at, payload_json
      FROM kernel_events WHERE project_id=? AND event_type='runtime.log'
      AND (? IS NULL OR run_id=?) AND (? IS NULL OR agent_id=?) AND (? IS NULL OR mpid=?)
      ORDER BY event_seq DESC LIMIT ?`).all(projectId, runId ?? null, runId ?? null, agentId ?? null, agentId ?? null, mpid ?? null, mpid ?? null, limit);
    return rows.map((row) => ({ eventSeq: row.event_seq, eventId: row.event_id, projectId, ...(row.agent_id === null ? {} : { agentId: row.agent_id }), ...(row.run_id === null ? {} : { runId: row.run_id }), ...(row.mpid === null ? {} : { mpid: row.mpid }), traceId: row.trace_id, occurredAt: row.occurred_at, ...asObject(JSON.parse(row.payload_json) as JsonValue) })) as unknown as JsonValue;
  }

  private attachmentSnapshot(projectId: string, target: "run" | "process", reference: string, payload: JsonValue): JsonValue {
    if (target === "run") this.requiredRun(projectId, reference);
    else this.getProcess(reference, projectId);
    const input = asObject(payload);
    const after = Math.max(0, numberOr(input.afterEventSeq, 0));
    const limit = Math.max(1, Math.min(numberOr(input.limit, 500), 1_000));
    type Row = { event_seq: number; event_id: string; event_type: string; run_id: string | null; mpid: string | null; trace_id: string; occurred_at: string; payload_json: string };
    const rows = target === "run"
      ? this.database.raw.query<Row, [string, string, number, number]>(`SELECT event_seq, event_id, event_type, run_id, mpid, trace_id, occurred_at, payload_json
          FROM kernel_events WHERE project_id=? AND run_id=? AND event_seq>? ORDER BY event_seq LIMIT ?`).all(projectId, reference, after, limit)
      : this.database.raw.query<Row, [string, string, number, number]>(`SELECT event_seq, event_id, event_type, run_id, mpid, trace_id, occurred_at, payload_json
          FROM kernel_events WHERE project_id=? AND mpid=? AND event_seq>? ORDER BY event_seq LIMIT ?`).all(projectId, reference, after, limit);
    return {
      target: { type: target, id: reference },
      cursor: rows.at(-1)?.event_seq ?? after,
      events: rows.map((row) => ({ eventSeq: row.event_seq, eventId: row.event_id, eventType: row.event_type, ...(row.run_id === null ? {} : { runId: row.run_id }), ...(row.mpid === null ? {} : { mpid: row.mpid }), traceId: row.trace_id, occurredAt: row.occurred_at, payload: JSON.parse(row.payload_json) })),
    };
  }

  private listAudit(projectId: string, payload: JsonValue): JsonValue {
    const limit = Math.max(1, Math.min(numberOr(asObject(payload).limit, 100), 1_000));
    type Row = { audit_id: string; actor_json: string; operation: string; resource_json: string; before_json: string | null; after_json: string | null; source_ip: string | null; trace_id: string; result: string; occurred_at: string };
    return this.database.raw.query<Row, [string, number]>("SELECT * FROM audit_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT ?").all(projectId, limit)
      .map((row) => ({ auditId: row.audit_id, projectId, actor: JSON.parse(row.actor_json), operation: row.operation, resource: JSON.parse(row.resource_json), ...(row.before_json === null ? {} : { before: JSON.parse(row.before_json) }), ...(row.after_json === null ? {} : { after: JSON.parse(row.after_json) }), ...(row.source_ip === null ? {} : { sourceIp: row.source_ip }), traceId: row.trace_id, result: row.result, occurredAt: row.occurred_at })) as unknown as JsonValue;
  }

  private auditCommand(event: CommandAuditEvent): void {
    const traceId = createId("trace");
    const actor = {
      principal: { id: event.context.session.principal.id, type: event.context.session.principal.type ?? "user" },
      sessionId: event.context.session.sessionId,
      connectionId: event.context.session.connectionId,
    };
    const resource = {
      ...(event.context.projectId === undefined ? {} : { projectId: event.context.projectId }),
      requestId: event.context.request.requestId,
      input: redactAuditValue(event.payload, event.operation),
    };
    const projectId = event.context.projectId !== undefined && this.repositories.getProject(event.context.projectId) !== undefined
      ? event.context.projectId
      : null;
    this.database.raw.query(`INSERT INTO audit_events(audit_id, project_id, actor_json, operation, resource_json, before_json, after_json, source_ip, trace_id, result, occurred_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`)
      .run(
        `audit_${Bun.randomUUIDv7()}`,
        projectId,
        JSON.stringify(actor),
        event.operation,
        JSON.stringify(resource),
        event.result === undefined ? null : JSON.stringify(redactAuditValue(event.result, event.operation)),
        event.context.sourceAddress,
        traceId,
        event.error === undefined ? "success" : "failure",
        new Date().toISOString(),
      );
    const attributes = {
      operation: event.operation,
      requestId: event.context.request.requestId,
      principalId: event.context.session.principal.id,
      ...(event.context.projectId === undefined ? {} : { projectId: event.context.projectId }),
      result: event.error === undefined ? "success" : "failure",
      ...(event.error === undefined ? {} : { error: event.error }),
    };
    if (event.error === undefined) this.logger.info("command.mutation", attributes);
    else this.logger.error("command.mutation", attributes);
  }

  private async createProject(context: CommandContext, payload: JsonValue): Promise<ProjectRecord> {
    const input = asObject(payload);
    const slug = requiredString(input, "slug");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw serviceError("PROJECT_SLUG_INVALID", "Project slug must be kebab-case");
    const mode = input.mode === "linked" ? "linked" : "managed";
    const physicalPath = mode === "linked" ? requiredString(input, "physicalPath") : resolve(this.config.projectsDir, slug);
    if (mode === "linked") {
      if (!physicalPath.startsWith("/")) throw serviceError("PROJECT_HOME_PATH_INVALID", "Linked Project Home must be an absolute path");
      const info = await stat(physicalPath).catch(() => undefined);
      if (info === undefined || !info.isDirectory()) throw serviceError("PROJECT_HOME_NOT_FOUND", "Linked Project Home does not exist or is not a directory");
    } else {
      await mkdir(physicalPath, { recursive: true, mode: 0o700 });
    }
    const project = this.repositories.createProject({ slug, name: requiredString(input, "name") });
    this.repositories.registerProjectHome({ projectId: project.projectId, mode, physicalPath, status: "active", createdAt: project.createdAt, verifiedAt: project.createdAt });
    this.authentication.setProjectRole(project.projectId, context.session.principal.id, "project_owner");
    await this.projectStore(project.projectId).initialize();
    return project;
  }

  private async setAgentApiAccess(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const agent = this.requiredAgent(context.projectId!, requiredString(input, "agent"));
    const enabled = input.enabled;
    if (typeof enabled !== "boolean") throw serviceError("AGENT_API_ACCESS_INVALID", "enabled must be a boolean");
    if (agent.sourcePath === undefined || !agent.sourcePath.endsWith(".agent.md")) {
      throw serviceError("AGENT_API_ACCESS_SOURCE_UNSUPPORTED", "API access can only be changed automatically for Markdown agents");
    }
    const store = this.projectStore(context.projectId!);
    const metadata = await store.stat(agent.sourcePath);
    const source = Buffer.from(await store.read(agent.sourcePath)).toString("utf8");
    const updated = setMarkdownApiEnabled(source, enabled);
    await compileMarkdownAgent(updated);
    if (updated !== source) {
      await store.write(agent.sourcePath, updated, {
        actorId: context.session.principal.id,
        expectedRevision: metadata.revision,
      });
    }
    const build = asObject(await this.buildAgent(context, { sourcePath: agent.sourcePath, sourceKind: "markdown", activate: true }));
    return { ...build, apiEnabled: enabled, sourcePath: agent.sourcePath } as JsonValue;
  }

  private async generateAgentInputExample(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const agent = this.requiredAgent(context.projectId!, requiredString(asObject(payload), "agent"));
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Agent has no active version");
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    if (manifest === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", "Active AgentVersion manifest is unavailable");
    const exampleSchema = completeSchemaForExample(manifest.contract.inputSchema);
    const fallback = exampleFromInputSchema(exampleSchema);
    try {
      const response = await this.generateWithRole<JsonValue>("agent.default", [
        {
          role: "system",
          content: "Generate one realistic JSON request body for invoking the supplied Marcus agent. Use synthetic, non-sensitive sample data in Spanish. Populate every declared property when the schema permits it, not only required properties. Never include credentials, bearer tokens, API keys, passwords or real personal data. Return only the structured value requested by Marcus.",
        },
        {
          role: "user",
          content: `Agent: ${manifest.identity.name}\nDescription: ${manifest.identity.description ?? "No description provided."}`,
        },
      ], {
        maxOutputTokens: 2_048,
        outputSchema: exampleSchema,
        outputExample: fallback,
        thinking: false,
      }, context.projectId);
      return {
        input: completeInputExample(exampleSchema, response.output),
        source: "llm",
        provider: response.provider,
        model: response.model,
      } as JsonValue;
    } catch (error) {
      if (!(error instanceof MarcusError)) throw error;
      this.logger.warn("agent.input-example.fallback", {
        projectId: context.projectId!,
        agentId: agent.agentId,
        code: error.code,
      });
      return { input: fallback, source: "schema" } as JsonValue;
    }
  }

  private async buildAgent(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const sourcePath = requiredString(input, "sourcePath");
    const sourceKind = input.sourceKind === "markdown" ? "markdown" : "sdk";
    const store = this.projectStore(context.projectId!);
    const physicalSource = store.resolver.resolve(sourcePath).physicalPath;
    const outputDirectory = resolve(store.resolver.homePath, ".marcus", "builds", Bun.randomUUIDv7());
    let build: { manifest: AgentManifest; artifactPath: string; sourceHash: string; manifestHash: string; artifactHash: string };
    if (sourceKind === "sdk") {
      build = await new AgentBuildService().buildSdk({
        entrypoint: physicalSource,
        outputDirectory,
        installPolicy: "never-install",
        ...(this.config.manifestLoaderExecutable === undefined ? {} : { manifestLoaderExecutable: this.config.manifestLoaderExecutable }),
      });
    } else {
      const source = await Bun.file(physicalSource).text();
      let compilation = await compileMarkdownAgent(source);
      if (compilation.manifest.assets !== undefined) {
        await copyAgentAssets(resolve(physicalSource, ".."), compilation.manifest.assets.staticDir, outputDirectory);
        compilation = { ...compilation, manifest: { ...compilation.manifest, assets: { ...compilation.manifest.assets, staticDir: "assets" } } };
      }
      const artifact = await emitMarkdownArtifact(compilation, outputDirectory);
      build = {
        manifest: compilation.manifest,
        artifactPath: artifact.artifactPath,
        sourceHash: compilation.manifest.build.sourceHash,
        manifestHash: artifact.manifestHash,
        artifactHash: await hashArtifactTree(outputDirectory),
      };
    }
    const existing = this.repositories.getAgentBySlug(context.projectId!, build.manifest.identity.id);
    const now = new Date().toISOString();
    const agentId = existing?.agentId ?? createId("agent");
    if (existing === undefined) {
      this.repositories.createAgentDefinition({
        agentId,
        projectId: context.projectId!,
        slug: build.manifest.identity.id,
        name: build.manifest.identity.name,
        ...(build.manifest.identity.description === undefined ? {} : { description: build.manifest.identity.description }),
        kind: build.manifest.identity.kind,
        status: "draft",
        sourcePath,
        sourceState: "clean",
        createdAt: now,
        updatedAt: now,
      });
    }
    this.database.raw.query(`UPDATE agent_definitions SET name=?, description=?, kind=?, source_path=?, source_state='clean', updated_at=? WHERE agent_id=?`)
      .run(build.manifest.identity.name, build.manifest.identity.description ?? null, build.manifest.identity.kind, sourcePath, now, agentId);
    const agentVersionId = createId("agentVersion");
    const version: AgentVersionRecord = {
      agentVersionId,
      agentId,
      sourceKind,
      sourceHash: build.sourceHash,
      manifestHash: build.manifestHash,
      artifactHash: build.artifactHash,
      manifestSchemaVersion: "marcus.agent/v1",
      status: "valid",
      createdAt: now,
      ...(build.manifest.build.sdkVersion === undefined ? {} : { sdkVersion: build.manifest.build.sdkVersion }),
    };
    this.repositories.registerAgentVersion({ record: version, manifest: build.manifest, artifactUri: build.artifactPath });
    if (input.activate !== false) this.repositories.activateAgentVersion(agentId, agentVersionId, now);
    return { agentId, agentVersionId, manifest: build.manifest, activated: input.activate !== false } as unknown as JsonValue;
  }

  private async buildAuthValidator(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const sourcePath = requiredString(input, "sourcePath");
    const store = this.projectStore(context.projectId!);
    const physicalSource = store.resolver.resolve(sourcePath).physicalPath;
    const outputDirectory = resolve(store.resolver.homePath, ".marcus", "builds", "validators", Bun.randomUUIDv7());
    const build = await new AgentBuildService().buildAuthValidator({
      entrypoint: physicalSource,
      outputDirectory,
      installPolicy: "never-install",
      ...(this.config.manifestLoaderExecutable === undefined ? {} : { manifestLoaderExecutable: this.config.manifestLoaderExecutable }),
    });
    const now = new Date().toISOString();
    const existing = this.database.raw.query<AuthValidatorRow, [string, string]>("SELECT * FROM auth_validators WHERE project_id=? AND slug=?").get(context.projectId!, build.descriptor.id);
    const validatorId = existing?.validator_id ?? createId("authValidator");
    if (existing === null) {
      this.database.raw.query(`INSERT INTO auth_validators(validator_id, project_id, slug, active_version_id, created_at, source_path, source_state, status, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, 'clean', 'active', ?)`).run(validatorId, context.projectId!, build.descriptor.id, now, sourcePath, now);
    } else {
      this.database.raw.query("UPDATE auth_validators SET source_path=?, source_state='clean', status='active', updated_at=? WHERE validator_id=?")
        .run(sourcePath, now, validatorId);
    }
    const validatorVersionId = createId("authValidatorVersion");
    this.database.raw.query(`INSERT INTO auth_validator_versions(validator_version_id, validator_id, source_hash, artifact_hash, artifact_uri, scheme, status, created_at, activated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'valid', ?, NULL)`).run(validatorVersionId, validatorId, build.sourceHash, build.artifactHash, build.artifactPath, build.descriptor.scheme, now);
    if (input.activate !== false) this.activateAuthValidatorVersion(validatorId, validatorVersionId, now);
    return {
      validatorId,
      validatorVersionId,
      descriptor: build.descriptor,
      sourceHash: build.sourceHash,
      artifactHash: build.artifactHash,
      activated: input.activate !== false,
    };
  }

  private listAuthValidators(projectId: string): JsonValue {
    const rows = this.database.raw.query<AuthValidatorRow, [string]>("SELECT * FROM auth_validators WHERE project_id=? ORDER BY slug").all(projectId);
    return rows.map((row) => this.authValidatorJson(row, true)) as unknown as JsonValue;
  }

  private listAuthValidatorVersions(projectId: string, reference: string): JsonValue {
    const validator = this.requiredAuthValidator(projectId, reference);
    const rows = this.database.raw.query<AuthValidatorVersionRow, [string]>("SELECT * FROM auth_validator_versions WHERE validator_id=? ORDER BY created_at DESC").all(validator.validator_id);
    return rows.map((row) => this.authValidatorVersionJson(row)) as unknown as JsonValue;
  }

  private activateAuthValidator(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const validator = this.requiredAuthValidator(projectId, requiredString(input, "validator"));
    const versionId = optionalString(input, "validatorVersionId")
      ?? this.database.raw.query<{ validator_version_id: string }, [string]>("SELECT validator_version_id FROM auth_validator_versions WHERE validator_id=? ORDER BY created_at DESC LIMIT 1").get(validator.validator_id)?.validator_version_id;
    if (versionId === undefined) throw serviceError("AUTH_VALIDATOR_VERSION_NOT_FOUND", "Auth validator has no version to activate");
    this.activateAuthValidatorVersion(validator.validator_id, versionId, new Date().toISOString());
    return this.authValidatorJson(this.requiredAuthValidator(projectId, validator.validator_id));
  }

  private activateAuthValidatorVersion(validatorId: string, versionId: string, now: string): void {
    this.database.raw.transaction(() => {
      const version = this.database.raw.query<{ validator_id: string; status: string }, [string]>("SELECT validator_id, status FROM auth_validator_versions WHERE validator_version_id=?").get(versionId);
      if (version === null || version.validator_id !== validatorId || version.status === "invalid") throw serviceError("AUTH_VALIDATOR_VERSION_NOT_FOUND", "Auth validator version is unavailable");
      this.database.raw.query("UPDATE auth_validator_versions SET status='superseded' WHERE validator_id=? AND status='active'").run(validatorId);
      this.database.raw.query("UPDATE auth_validator_versions SET status='active', activated_at=? WHERE validator_version_id=?").run(now, versionId);
      this.database.raw.query("UPDATE auth_validators SET active_version_id=?, status='active', source_state='clean', updated_at=? WHERE validator_id=?").run(versionId, now, validatorId);
    })();
  }

  private disableAuthValidator(projectId: string, reference: string): JsonValue {
    const validator = this.requiredAuthValidator(projectId, reference);
    const now = new Date().toISOString();
    this.database.raw.transaction(() => {
      this.database.raw.query("UPDATE auth_validator_versions SET status='superseded' WHERE validator_id=? AND status='active'").run(validator.validator_id);
      this.database.raw.query("UPDATE auth_validators SET active_version_id=NULL, status='disabled', updated_at=? WHERE validator_id=?").run(now, validator.validator_id);
    })();
    return this.authValidatorJson(this.requiredAuthValidator(projectId, validator.validator_id));
  }

  private async testAuthValidator(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const validator = this.requiredAuthValidator(projectId, requiredString(input, "validator"));
    if (validator.active_version_id === null) throw serviceError("AUTH_SCHEME_UNAVAILABLE", "Auth validator is not active");
    const version = this.database.raw.query<AuthValidatorVersionRow, [string]>("SELECT * FROM auth_validator_versions WHERE validator_version_id=?").get(validator.active_version_id);
    if (version === null || version.status !== "active") throw serviceError("AUTH_SCHEME_UNAVAILABLE", "Auth validator has no active version");
    const credential = requiredString(input, "credential");
    const principal = await this.executeAuthValidator(
      projectId,
      validator.validator_id,
      version.validator_version_id,
      version.artifact_uri,
      version.scheme,
      { authorization: `Bearer ${credential}` },
      { method: "POST", path: `/validators/${validator.slug}/test`, bodySha256: new Bun.CryptoHasher("sha256").update("").digest("hex") },
    );
    return {
      authenticated: true,
      principal: {
        id: principal.id,
        ...(principal.type === undefined ? {} : { type: principal.type }),
        ...(principal.claims === undefined ? {} : { claims: principal.claims }),
        ...(principal.scopes === undefined ? {} : { scopes: [...principal.scopes] }),
      },
    };
  }

  private requiredAuthValidator(projectId: string, reference: string): AuthValidatorRow {
    const slug = reference.includes("/") ? reference.slice(reference.lastIndexOf("/") + 1) : reference;
    const row = this.database.raw.query<AuthValidatorRow, [string, string, string]>("SELECT * FROM auth_validators WHERE project_id=? AND (validator_id=? OR slug=?)").get(projectId, reference, slug);
    if (row === null) throw serviceError("AUTH_VALIDATOR_NOT_FOUND", `Auth validator ${reference} not found`);
    return row;
  }

  private authValidatorJson(row: AuthValidatorRow, includeUsage = false): JsonValue {
    const descriptorVersion = row.active_version_id === null
      ? this.database.raw.query<Pick<AuthValidatorVersionRow, "scheme">, [string]>("SELECT scheme FROM auth_validator_versions WHERE validator_id=? ORDER BY created_at DESC LIMIT 1").get(row.validator_id) ?? undefined
      : this.database.raw.query<Pick<AuthValidatorVersionRow, "scheme">, [string]>("SELECT scheme FROM auth_validator_versions WHERE validator_version_id=?").get(row.active_version_id) ?? undefined;
    const dependentAgents = includeUsage
      ? this.repositories.listAgentDefinitions(row.project_id).filter((agent) => {
          if (agent.activeVersionId === undefined) return false;
          const policy = this.repositories.getAgentManifest(agent.activeVersionId)?.entrypoints.api?.authentication;
          if (policy?.type !== "validator") return false;
          const reference = policy.validator ?? policy.scheme;
          return reference === row.validator_id || reference.split("/").at(-1) === row.slug;
        }).map((agent) => agent.slug)
      : [];
    return {
      validatorId: row.validator_id,
      projectId: row.project_id,
      slug: row.slug,
      ...(row.active_version_id === null ? {} : { activeVersionId: row.active_version_id }),
      ...(descriptorVersion === undefined ? {} : { scheme: descriptorVersion.scheme }),
      ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
      sourceState: row.source_state,
      status: row.status,
      timeoutMs: 3_000,
      ...(includeUsage ? { dependentAgents } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }

  private authValidatorVersionJson(row: AuthValidatorVersionRow): JsonValue {
    return {
      validatorVersionId: row.validator_version_id,
      validatorId: row.validator_id,
      sourceHash: row.source_hash,
      artifactHash: row.artifact_hash,
      scheme: row.scheme,
      status: row.status,
      createdAt: row.created_at,
      ...(row.activated_at === null ? {} : { activatedAt: row.activated_at }),
    };
  }

  private markProjectSourcesDirty(projectId: string, changedPath: string): void {
    const changed = changedPath.replace(/^project:\/+/u, "").replace(/^\/+|\/+$/gu, "");
    for (const agent of this.repositories.listAgentDefinitions(projectId)) {
      if (agent.sourcePath === undefined) continue;
      const source = agent.sourcePath.replace(/^project:\/+/u, "").replace(/^\/+|\/+$/gu, "");
      const sourceDirectory = dirname(source).replaceAll("\\", "/");
      if (changed === source || (sourceDirectory !== "." && changed.startsWith(`${sourceDirectory}/`))) {
        this.database.raw.query("UPDATE agent_definitions SET source_state='dirty', updated_at=? WHERE agent_id=? AND source_state!='source-missing'")
          .run(new Date().toISOString(), agent.agentId);
      }
    }
    const validators = this.database.raw.query<AuthValidatorRow, [string]>("SELECT * FROM auth_validators WHERE project_id=?").all(projectId);
    for (const validator of validators) {
      if (validator.source_path === null) continue;
      const source = validator.source_path.replace(/^project:\/+/u, "").replace(/^\/+|\/+$/gu, "");
      const sourceDirectory = dirname(source).replaceAll("\\", "/");
      if (changed === source || (sourceDirectory !== "." && changed.startsWith(`${sourceDirectory}/`))) {
        this.database.raw.query("UPDATE auth_validators SET source_state='dirty', updated_at=? WHERE validator_id=?")
          .run(new Date().toISOString(), validator.validator_id);
      }
    }
  }

  private async agentSourceStatus(projectId: string, reference: string): Promise<JsonValue> {
    const agent = this.requiredAgent(projectId, reference);
    if (agent.sourcePath === undefined) return { agentId: agent.agentId, state: "source-missing" };
    const store = this.projectStore(projectId);
    const physicalSource = store.resolver.resolve(agent.sourcePath).physicalPath;
    if (!(await Bun.file(physicalSource).exists())) {
      this.database.raw.query("UPDATE agent_definitions SET source_state='source-missing', updated_at=? WHERE agent_id=?").run(new Date().toISOString(), agent.agentId);
      return { agentId: agent.agentId, state: "source-missing", sourcePath: agent.sourcePath };
    }
    const currentHash = await hashSourceTree(resolve(physicalSource, ".."));
    const activeHash = agent.activeVersionId === undefined ? undefined : this.repositories.getAgentVersion(agent.activeVersionId)?.sourceHash;
    const state = activeHash === currentHash ? "clean" : "dirty";
    this.database.raw.query("UPDATE agent_definitions SET source_state=?, updated_at=? WHERE agent_id=?").run(state, new Date().toISOString(), agent.agentId);
    return { agentId: agent.agentId, state, sourcePath: agent.sourcePath, currentHash, ...(activeHash === undefined ? {} : { activeHash }) };
  }

  private async compiledAgent(projectId: string, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const agent = this.requiredAgent(projectId, requiredString(input, "agent"));
    const agentVersionId = optionalString(input, "agentVersionId") ?? agent.activeVersionId;
    if (agentVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", "Agent has no active version");
    const version = this.repositories.getAgentVersion(agentVersionId);
    if (version === undefined || version.agentId !== agent.agentId) throw serviceError("AGENT_VERSION_NOT_FOUND", `Agent version ${agentVersionId} not found`);
    if (version.sourceKind !== "markdown") throw serviceError("AGENT_COMPILED_VIEW_UNAVAILABLE", "Compiled source view is available for Markdown agents");
    const manifest = this.repositories.getAgentManifest(agentVersionId);
    const artifactPath = this.repositories.getAgentArtifactUri(agentVersionId);
    if (manifest === undefined || artifactPath === undefined || !(await Bun.file(artifactPath).exists())) {
      throw serviceError("AGENT_ARTIFACT_MISSING", `Compiled artifact for ${agentVersionId} is unavailable`);
    }
    const generatedPath = resolve(dirname(artifactPath), `${manifest.identity.id}.generated.ts`);
    const generated = Bun.file(generatedPath);
    return {
      agentId: agent.agentId,
      agentVersionId,
      sourceKind: version.sourceKind,
      status: version.status,
      manifest: manifest as unknown as JsonValue,
      ...(await generated.exists() ? { generatedTypeScript: await generated.text() } : {}),
      runtimeJavaScript: await Bun.file(artifactPath).text(),
    };
  }

  private activateAgent(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const agent = this.requiredAgent(projectId, requiredString(input, "agent"));
    const versionId = optionalString(input, "agentVersionId") ?? this.repositories.listAgentVersions(agent.agentId)[0]?.agentVersionId;
    if (versionId === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", "Agent has no version to activate");
    this.repositories.activateAgentVersion(agent.agentId, versionId);
    return this.requiredAgent(projectId, agent.agentId) as unknown as JsonValue;
  }

  private disableAgent(projectId: string, reference: string): JsonValue {
    const agent = this.requiredAgent(projectId, reference);
    this.database.raw.query("UPDATE agent_definitions SET status='disabled', updated_at=? WHERE agent_id=?").run(new Date().toISOString(), agent.agentId);
    return this.requiredAgent(projectId, agent.agentId) as unknown as JsonValue;
  }

  private async startResident(projectId: string, reference: string): Promise<JsonValue> {
    const agent = this.requiredAgent(projectId, reference);
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Resident agent has no active version");
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    const artifactPath = this.repositories.getAgentArtifactUri(agent.activeVersionId);
    if (manifest === undefined || artifactPath === undefined) throw serviceError("AGENT_ARTIFACT_MISSING", "Resident agent artifact is unavailable");
    if (manifest.runtime.residency !== "resident") throw serviceError("AGENT_NOT_RESIDENT", `Agent ${agent.slug} is not resident`);
    const resident = await this.ensureResidentInstance(projectId, agent.agentId, agent.activeVersionId, manifest, artifactPath);
    return this.getInstance(resident.instanceId) as unknown as JsonValue;
  }

  private async stopResident(projectId: string, reference: string, required = true): Promise<JsonValue> {
    const agent = this.requiredAgent(projectId, reference);
    const residents = [...this.residentInstances.values()].filter((resident) => resident.agentId === agent.agentId);
    if (residents.length === 0) {
      if (required) throw serviceError("RESIDENT_INSTANCE_NOT_RUNNING", `Agent ${agent.slug} has no running resident instance`);
      return { agentId: agent.agentId, stopped: false };
    }
    await Promise.all(residents.map((resident) => this.stopResidentInstance(resident, "stopped")));
    return { agentId: agent.agentId, stopped: true, instances: residents.map((resident) => resident.instanceId) };
  }

  private async recoverResidentAgents(): Promise<void> {
    type Row = { project_id: string; agent_id: string; agent_version_id: string; instance_id: string };
    const candidates = this.database.raw.query<Row, []>(`WITH orphaned AS (
        SELECT i.*, ROW_NUMBER() OVER (
          PARTITION BY i.agent_id, i.agent_version_id ORDER BY i.started_at DESC, i.instance_id DESC
        ) AS recovery_rank
        FROM agent_instances i WHERE i.residency='resident' AND i.state='orphaned'
      )
      SELECT a.project_id, a.agent_id, a.active_version_id AS agent_version_id, i.instance_id
      FROM agent_definitions a JOIN orphaned i ON i.agent_id=a.agent_id AND i.agent_version_id=a.active_version_id
      WHERE a.status='active' AND i.recovery_rank=1`).all();
    for (const candidate of candidates) {
      const manifest = this.repositories.getAgentManifest(candidate.agent_version_id);
      const artifactPath = this.repositories.getAgentArtifactUri(candidate.agent_version_id);
      if (manifest?.runtime.residency !== "resident" || manifest.recovery?.policy !== "restart-instance" || artifactPath === undefined) continue;
      try {
        const resident = await this.ensureResidentInstance(candidate.project_id, candidate.agent_id, candidate.agent_version_id, manifest, artifactPath, candidate.instance_id);
        this.repositories.appendKernelEvent({
          eventType: "resident.recovered",
          nodeId: this.config.nodeId,
          projectId: candidate.project_id,
          agentId: candidate.agent_id,
          mpid: resident.instanceMpid,
          correlationId: createId("trace"),
          traceId: createId("trace"),
          payload: { restartedFromInstanceId: candidate.instance_id, instanceId: resident.instanceId },
        });
      } catch (error) {
        this.repositories.appendKernelEvent({
          eventType: "resident.recovery_failed",
          nodeId: this.config.nodeId,
          projectId: candidate.project_id,
          agentId: candidate.agent_id,
          correlationId: createId("trace"),
          traceId: createId("trace"),
          payload: { code: error instanceof MarcusError ? error.code : "RESIDENT_RECOVERY_FAILED", message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  private ensureResidentInstance(
    projectId: string,
    agentId: string,
    agentVersionId: string,
    manifest: AgentManifest,
    artifactPath: string,
    restartedFromInstanceId?: string,
  ): Promise<ResidentInstance> {
    const key = agentVersionId;
    const existing = this.residentInstances.get(key);
    if (existing !== undefined) return Promise.resolve(existing);
    const starting = this.residentStarts.get(key);
    if (starting !== undefined) return starting;
    const promise = this.createResidentInstance(projectId, agentId, agentVersionId, manifest, artifactPath, restartedFromInstanceId)
      .finally(() => this.residentStarts.delete(key));
    this.residentStarts.set(key, promise);
    return promise;
  }

  private async createResidentInstance(
    projectId: string,
    agentId: string,
    agentVersionId: string,
    manifest: AgentManifest,
    artifactPath: string,
    restartedFromInstanceId?: string,
  ): Promise<ResidentInstance> {
    const runtime = this.createRuntimeController(manifest);
    const instanceId = createId("instance");
    const instanceMpid = manifest.runtime.profile === "worker" ? createId("process") : runtime.mpid;
    const startedAt = new Date().toISOString();
    this.database.transaction(() => {
      if (manifest.runtime.profile === "worker") {
        this.database.raw.query(`INSERT INTO processes(mpid, process_type, project_id, agent_id, agent_version_id, instance_id, parent_mpid, os_pid, state, health, started_at)
          VALUES (?, 'runtime-host', ?, ?, ?, NULL, NULL, NULL, 'starting', 'unknown', ?)`).run(runtime.mpid, projectId, agentId, agentVersionId, startedAt);
      }
      this.database.raw.query(`INSERT INTO agent_instances(instance_id, agent_id, agent_version_id, runtime_profile, residency, mpid, os_pid, state, health, restarted_from_instance_id, started_at)
        VALUES (?, ?, ?, ?, 'resident', ?, NULL, 'starting', 'unknown', ?, ?)`).run(instanceId, agentId, agentVersionId, manifest.runtime.profile, instanceMpid, restartedFromInstanceId ?? null, startedAt);
      this.database.raw.query(`INSERT INTO processes(mpid, process_type, project_id, agent_id, agent_version_id, instance_id, parent_mpid, os_pid, state, health, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'starting', 'unknown', ?)`).run(instanceMpid, manifest.runtime.profile === "process" ? "agent-process" : "worker", projectId, agentId, agentVersionId, instanceId, manifest.runtime.profile === "worker" ? runtime.mpid : null, startedAt);
    });
    try {
      await runtime.loadArtifact(instanceId, artifactPath);
      await runtime.startInstance(instanceId);
      const readyAt = new Date().toISOString();
      this.database.raw.query("UPDATE agent_instances SET os_pid=?, state='ready', health='healthy' WHERE instance_id=?").run(runtime.osPid ?? null, instanceId);
      this.database.raw.query("UPDATE processes SET os_pid=?, state='ready', health='healthy', last_heartbeat_at=? WHERE mpid=? OR mpid=?")
        .run(runtime.osPid ?? null, readyAt, runtime.mpid, instanceMpid);
      const resident = {
        key: agentVersionId,
        projectId,
        agentId,
        agentVersionId,
        instanceId,
        instanceMpid,
        shutdownTimeoutMs: manifest.runtime.shutdownTimeoutMs,
        runtime,
      };
      this.residentInstances.set(agentVersionId, resident);
      return resident;
    } catch (error) {
      await runtime.close();
      const failedAt = new Date().toISOString();
      this.database.raw.query("UPDATE agent_instances SET state='failed', health='unhealthy', stopped_at=? WHERE instance_id=?").run(failedAt, instanceId);
      this.database.raw.query("UPDATE processes SET state='failed', health='unhealthy' WHERE mpid=? OR mpid=?").run(runtime.mpid, instanceMpid);
      throw error;
    }
  }

  private async stopResidentInstance(resident: ResidentInstance, state: "stopped" | "killed"): Promise<void> {
    if (this.residentInstances.get(resident.key) !== resident) return;
    this.residentInstances.delete(resident.key);
    for (const [runId, runtime] of this.activeRuns) {
      if (runtime !== resident.runtime) continue;
      this.activeRuns.delete(runId);
      const run = this.repositories.getRun(runId);
      if (run !== undefined && !isTerminalRunState(run.state)) this.kernel.cancelRun(runId);
    }
    await Promise.race([
      resident.runtime.stopInstance(resident.instanceId).catch(() => undefined),
      Bun.sleep(resident.shutdownTimeoutMs),
    ]);
    await resident.runtime.close();
    const stoppedAt = new Date().toISOString();
    this.database.raw.query("UPDATE agent_instances SET state=?, health='unknown', stopped_at=? WHERE instance_id=?").run(state, stoppedAt, resident.instanceId);
    this.database.raw.query("UPDATE processes SET state=?, health='unknown', exit_code=COALESCE(exit_code, 0), last_heartbeat_at=COALESCE(last_heartbeat_at, ?) WHERE mpid=? OR mpid=?")
      .run(state, stoppedAt, resident.runtime.mpid, resident.instanceMpid);
  }

  private getInstance(instanceId: string): JsonValue {
    type Row = { instance_id: string; agent_id: string; agent_version_id: string; runtime_profile: string; residency: string; mpid: string; os_pid: number | null; state: string; health: string; restarted_from_instance_id: string | null; started_at: string; stopped_at: string | null };
    const row = this.database.raw.query<Row, [string]>("SELECT * FROM agent_instances WHERE instance_id=?").get(instanceId);
    if (row === null) throw serviceError("AGENT_INSTANCE_NOT_FOUND", `Instance ${instanceId} not found`);
    return { instanceId: row.instance_id, agentId: row.agent_id, agentVersionId: row.agent_version_id, runtimeProfile: row.runtime_profile, residency: row.residency, mpid: row.mpid, ...(row.os_pid === null ? {} : { osPid: row.os_pid }), state: row.state, health: row.health, ...(row.restarted_from_instance_id === null ? {} : { restartedFromInstanceId: row.restarted_from_instance_id }), startedAt: row.started_at, ...(row.stopped_at === null ? {} : { stoppedAt: row.stopped_at }) };
  }

  private listCheckpoints(projectId: string, runId: string): JsonValue {
    const run = this.requiredRun(projectId, runId);
    type Row = { checkpoint_id: string; run_id: string; agent_version_id: string; schema_version: number; resume_key: string; payload_hash: string; created_at: string };
    return this.database.raw.query<Row, [string]>("SELECT checkpoint_id, run_id, agent_version_id, schema_version, resume_key, payload_hash, created_at FROM checkpoints WHERE run_id=? ORDER BY created_at DESC").all(run.runId)
      .map((row) => ({ checkpointId: row.checkpoint_id, runId: row.run_id, agentVersionId: row.agent_version_id, schemaVersion: row.schema_version, resumeKey: row.resume_key, payloadHash: row.payload_hash, createdAt: row.created_at })) as unknown as JsonValue;
  }

  private getExecutionGraph(projectId: string, runId: string): JsonValue {
    this.requiredRun(projectId, runId);
    type GraphRow = { graph_id: string; project_id: string; root_run_id: string; status: string; created_at: string; updated_at: string };
    const graph = this.database.raw.query<GraphRow, [string, string, string, string]>(`SELECT DISTINCT g.* FROM execution_graphs g LEFT JOIN execution_edges e ON e.graph_id=g.graph_id
      WHERE g.project_id=? AND (g.root_run_id=? OR e.parent_run_id=? OR e.child_run_id=?) LIMIT 1`).get(projectId, runId, runId, runId);
    if (graph === null) return { graph: null, nodes: [this.requiredRun(projectId, runId)], edges: [] } as unknown as JsonValue;
    type EdgeRow = { parent_run_id: string; child_run_id: string; relationship: string; join_group_id: string | null; parent_close_policy: string };
    const edges = this.database.raw.query<EdgeRow, [string]>("SELECT parent_run_id, child_run_id, relationship, join_group_id, parent_close_policy FROM execution_edges WHERE graph_id=?").all(graph.graph_id);
    const runIds = new Set([graph.root_run_id, ...edges.flatMap((edge) => [edge.parent_run_id, edge.child_run_id])]);
    return {
      graph: { graphId: graph.graph_id, projectId: graph.project_id, rootRunId: graph.root_run_id, status: graph.status, createdAt: graph.created_at, updatedAt: graph.updated_at },
      nodes: [...runIds].map((id) => this.repositories.getRun(id)).filter((run): run is RunRecord => run !== undefined),
      edges: edges.map((edge) => ({ parentRunId: edge.parent_run_id, childRunId: edge.child_run_id, relationship: edge.relationship, ...(edge.join_group_id === null ? {} : { joinGroupId: edge.join_group_id }), parentClosePolicy: edge.parent_close_policy })),
    } as unknown as JsonValue;
  }

  private invoke(context: CommandContext, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const agent = this.requiredAgent(context.projectId!, requiredString(input, "agent"));
    const handle = this.kernel.invokeAgent({
      projectId: context.projectId!,
      agentId: agent.agentId,
      entrypoint: (optionalString(input, "entrypoint") ?? "cli") as "cli",
      input: (input.input ?? {}) as JsonValue,
      principal: context.session.principal,
      connectionId: context.session.connectionId,
      remoteAddress: context.sourceAddress,
      ...(typeof input.chatId === "string" ? { chatId: input.chatId } : {}),
      ...(context.request.idempotencyKey === undefined ? {} : { idempotencyKey: context.request.idempotencyKey }),
      ...(context.request.deadlineAt === undefined ? {} : { deadlineAt: context.request.deadlineAt }),
    });
    this.kickDispatcher();
    return handle as unknown as JsonValue;
  }

  private async invokeExternal(context: CommandContext, payload: JsonValue): Promise<JsonValue> {
    const input = asObject(payload);
    const agent = this.requiredAgent(context.projectId!, requiredString(input, "agent"));
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Agent has no active version");
    const manifest = this.repositories.getAgentManifest(agent.activeVersionId);
    const policy = manifest?.entrypoints.api?.authentication;
    if (manifest?.entrypoints.api?.enabled !== true || policy === undefined) throw serviceError("ENTRYPOINT_DISABLED", "Agent API entrypoint is disabled");
    if (policy.type === "marcus-token") throw serviceError("AUTH_POLICY_MISMATCH", "marcus-token entrypoints must use an authenticated Marcus principal");
    const headers = lowerHeaders(input.headers);
    let principal: Principal;
    if (policy.type === "none") {
      principal = { id: "anonymous", type: "anonymous" };
    } else if (policy.type === "bearer-secret") {
      const authorization = headers.authorization;
      if (authorization?.startsWith("Bearer ") !== true) throw serviceError("AUTH_REQUIRED", "Bearer credential is required");
      const expected = await this.secrets.resolve(policy.secret, context.projectId);
      if (!constantTimeStringEqual(authorization.slice(7), expected)) throw serviceError("AUTH_CREDENTIALS_INVALID", "Bearer credential is invalid");
      principal = { id: externalPrincipalId(authorization), type: "external", claims: { scheme: "bearer-secret" } };
    } else if (policy.type === "hmac") {
      const signatureHeader = (policy.header ?? "x-signature").toLowerCase();
      const timestampHeader = (policy.timestampHeader ?? "x-timestamp").toLowerCase();
      const signature = headers[signatureHeader];
      const timestamp = headers[timestampHeader];
      const nonce = headers["x-nonce"];
      if (signature === undefined || timestamp === undefined || nonce === undefined) throw serviceError("AUTH_REQUIRED", "HMAC signature, timestamp, and nonce are required");
      const timestampMs = /^\d+$/u.test(timestamp) ? Number(timestamp) * (timestamp.length <= 10 ? 1_000 : 1) : Date.parse(timestamp);
      const replayWindowMs = policy.replayWindowMs ?? 300_000;
      const nowMs = Date.now();
      if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > replayWindowMs) throw serviceError("AUTH_HMAC_TIMESTAMP_INVALID", "HMAC timestamp is outside the replay window");
      const secret = await this.secrets.resolve(policy.secret, context.projectId);
      const canonical = `${timestamp}\n${nonce}\n${requiredString(input, "method").toUpperCase()}\n${requiredString(input, "path")}\n${requiredString(input, "bodySha256")}`;
      const expected = new Bun.CryptoHasher("sha256", secret).update(canonical).digest("hex");
      const received = signature.replace(/^sha256=/iu, "");
      if (!constantTimeStringEqual(received, expected)) throw serviceError("AUTH_HMAC_SIGNATURE_INVALID", "HMAC signature is invalid");
      this.consumeHmacReplay(context.projectId!, hmacReplayFingerprint(nonce, received), timestampMs + replayWindowMs, nowMs);
      principal = { id: externalPrincipalId(signature), type: "external", claims: { scheme: "hmac" } };
    } else if (policy.type === "custom") {
      principal = await this.validateCustomAuthentication(context.projectId!, agent, policy.scheme, headers, input);
    } else {
      principal = await this.validateRegisteredAuthentication(context.projectId!, policy.validator ?? policy.scheme, headers, input);
    }
    const handle = this.kernel.invokeAgent({
      projectId: context.projectId!,
      agentId: agent.agentId,
      entrypoint: "api",
      input: (input.input ?? {}) as JsonValue,
      principal,
      ...(optionalString(input, "remoteAddress") === undefined ? {} : { remoteAddress: optionalString(input, "remoteAddress")! }),
      ...(typeof input.chatId === "string" ? { chatId: input.chatId } : {}),
      ...(typeof input.idempotencyKey === "string" ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    this.kickDispatcher();
    return handle as unknown as JsonValue;
  }

  private consumeHmacReplay(projectId: string, replayKeyHash: string, expiresAt: number, nowMs: number): void {
    const inserted = this.database.transaction(() => {
      this.database.raw.query("DELETE FROM hmac_replay_entries WHERE project_id=? AND replay_key_hash=? AND expires_at<=?")
        .run(projectId, replayKeyHash, nowMs);
      this.database.raw.query(`DELETE FROM hmac_replay_entries WHERE rowid IN (
        SELECT rowid FROM hmac_replay_entries WHERE expires_at<=? ORDER BY expires_at LIMIT 1000
      )`).run(nowMs);
      return this.database.raw.query(`INSERT INTO hmac_replay_entries(project_id, replay_key_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(project_id, replay_key_hash) DO NOTHING`)
        .run(projectId, replayKeyHash, expiresAt, nowMs).changes === 1;
    });
    if (!inserted) throw serviceError("AUTH_HMAC_REPLAY", "HMAC signature was already used");
  }

  private async validateCustomAuthentication(
    projectId: string,
    agent: AgentDefinitionRecord,
    scheme: string,
    headers: Record<string, string>,
    request: Record<string, JsonValue | Uint8Array>,
  ): Promise<Principal> {
    if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", "Agent has no active version");
    const artifactPath = this.repositories.getAgentArtifactUri(agent.activeVersionId);
    if (artifactPath === undefined) throw serviceError("AGENT_ARTIFACT_MISSING", "Authentication validator artifact is missing");
    return this.executeAuthValidator(projectId, agent.agentId, agent.activeVersionId, artifactPath, scheme, headers, request);
  }

  private async validateRegisteredAuthentication(
    projectId: string,
    reference: string,
    headers: Record<string, string>,
    request: Record<string, JsonValue | Uint8Array>,
  ): Promise<Principal> {
    const validator = this.requiredAuthValidator(projectId, reference);
    if (validator.status !== "active" || validator.active_version_id === null) throw serviceError("AUTH_SCHEME_UNAVAILABLE", `Registered validator ${reference} is not active`);
    const version = this.database.raw.query<AuthValidatorVersionRow, [string]>("SELECT * FROM auth_validator_versions WHERE validator_version_id=?").get(validator.active_version_id);
    if (version === null || version.validator_id !== validator.validator_id || version.status !== "active") throw serviceError("AUTH_SCHEME_UNAVAILABLE", `Registered validator ${reference} has no active version`);
    return this.executeAuthValidator(projectId, validator.validator_id, version.validator_version_id, version.artifact_uri, version.scheme, headers, request);
  }

  private async executeAuthValidator(
    projectId: string,
    validatorId: string,
    validatorVersionId: string,
    artifactPath: string,
    scheme: string,
    headers: Record<string, string>,
    request: Record<string, JsonValue | Uint8Array>,
  ): Promise<Principal> {
    const project = this.requiredProject(projectId);
    const instanceId = createId("instance");
    const runtime = new RuntimeHostController({
      ...(this.config.runtimeHostExecutable === undefined ? {} : { hostExecutable: this.config.runtimeHostExecutable }),
      requestTimeoutMs: 3_000,
      handlers: {
        [RuntimeMessageType.SECRET_GET]: (envelope) => this.secrets.resolve(requiredString(asObject(envelope.payload as JsonValue), "name"), projectId),
        [RuntimeMessageType.LOG]: () => undefined,
      },
    });
    try {
      await runtime.loadArtifact(instanceId, artifactPath);
      await runtime.startInstance(instanceId, { authOnly: true });
      const authorization = headers.authorization;
      const result = await runtime.validateAuthentication(instanceId, {
        project: { id: project.projectId, slug: project.slug },
        agent: { id: validatorId, versionId: validatorVersionId },
        request: {
          method: requiredString(request, "method"),
          path: requiredString(request, "path"),
          ...(optionalString(request, "remoteAddress") === undefined ? {} : { remoteAddress: optionalString(request, "remoteAddress")! }),
          headers,
        },
        credential: {
          scheme,
          ...(authorization === undefined ? {} : { token: authorization.replace(/^Bearer\s+/iu, "") }),
          ...(headers["x-signature"] === undefined ? {} : { signature: headers["x-signature"] }),
          ...(headers["x-timestamp"] === undefined ? {} : { timestamp: headers["x-timestamp"] }),
          headers,
        },
      });
      if (!result.authenticated || result.principal === undefined) throw serviceError(result.code ?? "AUTH_CREDENTIALS_INVALID", "Custom authentication rejected the credential");
      return { ...result.principal, type: result.principal.type ?? "external" };
    } catch (error) {
      if (error instanceof MarcusError) throw error;
      throw serviceError("AUTH_VALIDATOR_FAILED", error instanceof Error ? error.message : String(error));
    } finally {
      await runtime.close();
    }
  }

  private cancel(context: CommandContext, payload: JsonValue): RunRecord {
    const runId = requiredString(asObject(payload), "runId");
    this.requiredRun(context.projectId!, runId);
    const run = this.kernel.cancelRun(runId);
    this.cancelToolExecutions(runId, "Run cancelled");
    this.cancelRunApprovals(runId, "Run cancelled");
    const runtime = this.activeRuns.get(runId);
    if (runtime !== undefined) void runtime.cancelRun(runId).catch(() => undefined);
    return run;
  }

  private kickDispatcher(): void {
    if (this.dispatching || this.closed) return;
    this.dispatching = true;
    queueMicrotask(() => {
      try {
        for (;;) {
          const run = this.kernel.dispatchNext();
          if (run === undefined) break;
          const execution = this.executeRun(run).finally(() => {
            this.settleMessageDelivery(run);
            this.activeExecutions.delete(run.runId);
            this.kickDispatcher();
          });
          this.activeExecutions.set(run.runId, execution);
        }
      } finally {
        this.dispatching = false;
      }
    });
  }

  private createRuntimeController(manifest: AgentManifest): RuntimeController {
    const common = {
      requestTimeoutMs: Math.max(86_400_000, manifest.runtime.heartbeatTimeoutMs * 3),
      handlers: this.runtimeHandlers(),
      onEvent: (envelope: RuntimeEnvelope) => this.recordRuntimeEvent(envelope),
    };
    if (manifest.runtime.profile === "process") {
      return new ProcessRuntimeController({
        ...common,
        ...(this.config.agentProcessExecutable === undefined ? {} : { processExecutable: this.config.agentProcessExecutable }),
      });
    }
    return new RuntimeHostController({
      ...common,
      ...(this.config.runtimeHostExecutable === undefined ? {} : { hostExecutable: this.config.runtimeHostExecutable }),
    });
  }

  private async executeResidentRun(run: RunRecord, manifest: AgentManifest, artifactPath: string, input: JsonValue): Promise<void> {
    let resident: ResidentInstance;
    try {
      resident = await this.ensureResidentInstance(run.projectId, run.agentId, run.agentVersionId, manifest, artifactPath);
    } catch (error) {
      this.failRuntimeRun(run, error);
      return;
    }
    this.database.raw.query("UPDATE runs SET instance_id=? WHERE run_id=?").run(resident.instanceId, run.runId);
    this.activeRuns.set(run.runId, resident.runtime);
    try {
      this.kernel.markRunning(run.runId);
      this.database.raw.query("UPDATE agent_instances SET state='running', health='healthy' WHERE instance_id=?").run(resident.instanceId);
      this.database.raw.query("UPDATE processes SET state='running', health='healthy' WHERE mpid=? OR mpid=?").run(resident.runtime.mpid, resident.instanceMpid);
      const project = this.requiredProject(run.projectId);
      const home = this.repositories.getProjectHome(run.projectId);
      const conversation = run.conversationId === undefined ? undefined : this.conversationRuntimeContext(run.conversationId);
      const result = await resident.runtime.invoke({
        instanceId: resident.instanceId,
        runId: run.runId,
        project: { id: project.projectId, slug: project.slug, homePath: home?.physicalPath ?? "" },
        agent: { id: run.agentId, versionId: run.agentVersionId },
        entrypoint: run.entrypoint,
        input,
        ...(run.principalId === undefined ? {} : { principal: { id: run.principalId, type: "user" as const } }),
        ...(conversation === undefined ? {} : { conversation }),
        traceId: run.traceId,
        correlationId: run.correlationId,
      });
      this.kernel.completeRun(run.runId, result.output);
    } catch (error) {
      this.failRuntimeRun(run, error);
    } finally {
      this.applyParentClosePolicy(run.runId);
      this.activeRuns.delete(run.runId);
      if (this.residentInstances.get(resident.key) === resident) {
        const stillRunning = [...this.activeRuns.values()].some((runtime) => runtime === resident.runtime);
        this.database.raw.query("UPDATE agent_instances SET state=?, health='healthy' WHERE instance_id=?").run(stillRunning ? "running" : "ready", resident.instanceId);
        this.database.raw.query("UPDATE processes SET state=?, health='healthy' WHERE mpid=? OR mpid=?").run(stillRunning ? "running" : "ready", resident.runtime.mpid, resident.instanceMpid);
      }
    }
  }

  private failRuntimeRun(run: RunRecord, error: unknown): void {
    const current = this.repositories.getRun(run.runId);
    if (current?.state === "cancelling") {
      if (error instanceof MarcusError && error.code === "RUN_KILLED") this.kernel.killRun(run.runId, error.message);
      else this.kernel.finishCancelled(run.runId);
    } else if (current !== undefined && !isTerminalRunState(current.state)) {
      this.kernel.failRun(run.runId, {
        code: error instanceof MarcusError ? error.code : "AGENT_RUN_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: error instanceof MarcusError ? error.retryable : false,
      });
    }
  }

  private async executeRun(run: RunRecord): Promise<void> {
    const manifest = this.repositories.getAgentManifest(run.agentVersionId);
    const artifactPath = this.repositories.getAgentArtifactUri(run.agentVersionId);
    const input = this.repositories.getRunInput(run.runId);
    if (manifest === undefined || artifactPath === undefined || input === undefined) {
      this.kernel.failRun(run.runId, { code: "AGENT_ARTIFACT_MISSING", message: "Run artifact or input is unavailable", retryable: false });
      return;
    }
    if (manifest.runtime.residency === "resident") {
      await this.executeResidentRun(run, manifest, artifactPath, input);
      return;
    }
    const instanceId = createId("instance");
    const startedAt = new Date().toISOString();
    const runtime = this.createRuntimeController(manifest);
    const instanceMpid = manifest.runtime.profile === "worker" ? createId("process") : runtime.mpid;
    this.database.transaction(() => {
      if (manifest.runtime.profile === "worker") {
        this.database.raw.query(`INSERT INTO processes(mpid, process_type, project_id, agent_id, agent_version_id, instance_id, parent_mpid, os_pid, state, health, started_at)
          VALUES (?, 'runtime-host', ?, ?, ?, NULL, NULL, NULL, 'starting', 'unknown', ?)`)
          .run(runtime.mpid, run.projectId, run.agentId, run.agentVersionId, startedAt);
      }
      this.database.raw.query(`INSERT INTO agent_instances(instance_id, agent_id, agent_version_id, runtime_profile, residency, mpid, os_pid, state, health, started_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 'starting', 'unknown', ?)`)
        .run(instanceId, run.agentId, run.agentVersionId, manifest.runtime.profile, manifest.runtime.residency, instanceMpid, startedAt);
      this.database.raw.query(`INSERT INTO processes(mpid, process_type, project_id, agent_id, agent_version_id, instance_id, parent_mpid, os_pid, state, health, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'starting', 'unknown', ?)`)
        .run(instanceMpid, manifest.runtime.profile === "process" ? "agent-process" : "worker", run.projectId, run.agentId, run.agentVersionId, instanceId, manifest.runtime.profile === "worker" ? runtime.mpid : null, startedAt);
      this.database.raw.query("UPDATE runs SET instance_id = ? WHERE run_id = ?").run(instanceId, run.runId);
    });
    this.activeRuns.set(run.runId, runtime);
    try {
      await runtime.loadArtifact(instanceId, artifactPath);
      await runtime.startInstance(instanceId);
      const readyAt = new Date().toISOString();
      this.database.raw.query("UPDATE agent_instances SET os_pid=?, state='ready', health='healthy' WHERE instance_id=?").run(runtime.osPid ?? null, instanceId);
      this.database.raw.query("UPDATE processes SET os_pid=?, state='ready', health='healthy', last_heartbeat_at=? WHERE mpid=? OR mpid=?")
        .run(runtime.osPid ?? null, readyAt, runtime.mpid, instanceMpid);
      this.kernel.markRunning(run.runId);
      this.database.raw.query("UPDATE agent_instances SET state='running' WHERE instance_id=?").run(instanceId);
      this.database.raw.query("UPDATE processes SET state='running' WHERE mpid=? OR mpid=?").run(runtime.mpid, instanceMpid);
      const project = this.requiredProject(run.projectId);
      const home = this.repositories.getProjectHome(run.projectId);
      const conversation = run.conversationId === undefined ? undefined : this.conversationRuntimeContext(run.conversationId);
      const result = await runtime.invoke({
        instanceId,
        runId: run.runId,
        project: { id: project.projectId, slug: project.slug, homePath: home?.physicalPath ?? "" },
        agent: { id: run.agentId, versionId: run.agentVersionId },
        entrypoint: run.entrypoint,
        input,
        ...(run.principalId === undefined ? {} : { principal: { id: run.principalId, type: "user" as const } }),
        ...(conversation === undefined ? {} : { conversation }),
        traceId: run.traceId,
        correlationId: run.correlationId,
      });
      this.kernel.completeRun(run.runId, result.output);
    } catch (error) {
      this.failRuntimeRun(run, error);
    } finally {
      this.applyParentClosePolicy(run.runId);
      this.activeRuns.delete(run.runId);
      await runtime.close();
      const finishedAt = new Date().toISOString();
      const current = this.repositories.getRun(run.runId);
      const processState = current?.state === "killed" ? "killed" : current?.state === "failed" ? "failed" : "stopped";
      this.database.raw.query("UPDATE agent_instances SET state=?, health='unknown', stopped_at=? WHERE instance_id=?")
        .run(processState, finishedAt, instanceId);
      this.database.raw.query("UPDATE processes SET state=?, health='unknown', exit_code=COALESCE(exit_code, 0), last_heartbeat_at=COALESCE(last_heartbeat_at, ?) WHERE mpid=? OR mpid=?")
        .run(processState, finishedAt, runtime.mpid, instanceMpid);
    }
  }

  private listTools(projectId: string, payload: JsonValue): JsonValue {
    const input = asObject(payload);
    const agentReference = optionalString(input, "agent");
    const requestedVersionId = optionalString(input, "agentVersionId");
    if (agentReference === undefined && requestedVersionId === undefined) {
      return { scope: "official", tools: MARCUS_OFFICIAL_TOOL_CATALOG } as unknown as JsonValue;
    }
    let agent: AgentDefinitionRecord;
    let versionId: string;
    if (requestedVersionId !== undefined) {
      const version = this.repositories.getAgentVersion(requestedVersionId);
      if (version === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", `Agent version ${requestedVersionId} not found`);
      agent = this.requiredAgent(projectId, version.agentId);
      versionId = version.agentVersionId;
      if (agentReference !== undefined && this.requiredAgent(projectId, agentReference).agentId !== agent.agentId) {
        throw serviceError("AGENT_VERSION_MISMATCH", `Agent version ${requestedVersionId} does not belong to ${agentReference}`);
      }
    } else {
      agent = this.requiredAgent(projectId, agentReference!);
      if (agent.activeVersionId === undefined) throw serviceError("AGENT_VERSION_NOT_ACTIVE", `Agent ${agent.slug} has no active version`);
      versionId = agent.activeVersionId;
    }
    return {
      scope: "agent-version",
      projectId,
      agentId: agent.agentId,
      agentVersionId: versionId,
      tools: this.versionTools(versionId),
    } as unknown as JsonValue;
  }

  private discoverRuntimeTools(envelope: RuntimeEnvelope): JsonValue {
    const run = this.runtimeRun(envelope);
    const input = asObject(envelope.payload as JsonValue);
    const tools = this.versionTools(run.agentVersionId);
    const requested = optionalString(input, "tool");
    if (requested === undefined) return tools as unknown as JsonValue;
    const tool = tools.find((candidate) => candidate.id === requested);
    if (tool === undefined) throw serviceError("TOOL_NOT_ALLOWED", `Tool ${requested} is not allowlisted by AgentVersion ${run.agentVersionId}`);
    return tool as unknown as JsonValue;
  }

  private versionTools(agentVersionId: string): ToolManifest[] {
    const manifest = this.repositories.getAgentManifest(agentVersionId);
    if (manifest === undefined) throw serviceError("AGENT_VERSION_NOT_FOUND", `AgentVersion ${agentVersionId} manifest not found`);
    return ((manifest.tools ?? []) as readonly unknown[]).map((entry) => {
      if (isToolManifest(entry)) return entry;
      const id = typeof entry === "object" && entry !== null && "id" in entry ? String((entry as { id: unknown }).id) : "";
      const official = officialToolManifest(id);
      if (official === undefined) throw serviceError("TOOL_MANIFEST_INVALID", `Tool ${id || "<unknown>"} has no versioned descriptor`);
      return official;
    });
  }

  private requiredRunTool(run: RunRecord, toolId: string): ToolManifest {
    const tool = this.versionTools(run.agentVersionId).find((candidate) => candidate.id === toolId);
    if (tool === undefined) throw serviceError("TOOL_NOT_ALLOWED", `Tool ${toolId} is not allowlisted by AgentVersion ${run.agentVersionId}`);
    return tool;
  }

  private async invokeRuntimeTool(envelope: RuntimeEnvelope): Promise<JsonValue> {
    const run = this.runtimeRun(envelope);
    const payload = asObject(envelope.payload as JsonValue);
    const toolId = requiredString(payload, "tool");
    const rawInput = payload.input === undefined ? null : payload.input;
    let tool: ToolManifest;
    try {
      tool = this.requiredRunTool(run, toolId);
    } catch (error) {
      this.rejectToolCall(run, toolId, rawInput, error);
      throw error;
    }
    let input: JsonValue;
    let options: ToolCallOptions;
    try {
      if (rawInput instanceof Uint8Array) throw serviceError("TOOL_INPUT_INVALID", "Tool input must be JSON");
      input = validateToolValue(tool.inputSchema, rawInput, "TOOL_INPUT_INVALID", toolId);
      options = toolCallOptions(payload.options);
    } catch (error) {
      this.rejectToolCall(run, toolId, rawInput, error, tool);
      throw error;
    }
    const idempotencyKey = this.toolIdempotencyKey(run, tool, input, options);
    const replay = idempotencyKey === undefined ? undefined : this.findToolReplay(run.agentVersionId, tool.id, idempotencyKey);
    if (replay !== undefined) {
      if (replay.state !== "completed" || replay.output_json === null) {
        const error = serviceError("TOOL_IDEMPOTENCY_IN_PROGRESS", `Equivalent call ${replay.tool_call_id} is ${replay.state}`);
        this.rejectToolCall(run, toolId, input, error, tool);
        throw error;
      }
      const replayCallId = this.insertToolCall(run, tool, input, undefined, "completed", replay.tool_call_id, replay.output_json);
      const output = JSON.parse(replay.output_json) as JsonValue;
      this.appendToolEvent(run, tool, replayCallId, "replayed", { cachedFromToolCallId: replay.tool_call_id });
      this.auditToolCall(run, tool, replayCallId, "replay", replay.tool_call_id);
      return { kind: "result", output, toolCallId: replayCallId, idempotentReplay: true };
    }

    const toolCallId = this.insertToolCall(run, tool, input, idempotencyKey, "running");
    this.appendToolEvent(run, tool, toolCallId, "requested");
    try {
      if (tool.risk === "critical") {
        this.database.raw.query("UPDATE tool_calls SET state='waiting_for_approval' WHERE tool_call_id=?").run(toolCallId);
        await this.requestApproval(run, {
          action: `tool:${tool.id}`,
          prompt: `Authorize critical tool ${tool.id} for Run ${run.runId}`,
          data: { toolCallId, toolId: tool.id, toolVersion: tool.version, risk: tool.risk },
        }, (approvalId) => {
          this.database.raw.query("UPDATE tool_calls SET approval_id=? WHERE tool_call_id=?").run(approvalId, toolCallId);
          this.appendToolEvent(run, tool, toolCallId, "waiting_for_approval", { approvalId });
        });
        this.database.raw.query("UPDATE tool_calls SET state='running' WHERE tool_call_id=?").run(toolCallId);
      }
      const inputTimeoutMs = tool.id === "marcus/http.request" && isJsonObject(input) && typeof input.timeoutMs === "number"
        ? input.timeoutMs
        : tool.timeoutMs;
      const timeoutMs = Math.min(tool.timeoutMs, inputTimeoutMs, options.timeoutMs ?? tool.timeoutMs);
      if (tool.source === "agent") {
        return { kind: "execute", toolCallId, timeoutMs, descriptor: tool } as unknown as JsonValue;
      }
      const output = await this.runOfficialTool(run, tool, input, timeoutMs, toolCallId, envelope);
      const validated = validateToolValue(tool.outputSchema, output, "TOOL_OUTPUT_INVALID", tool.id);
      this.finishToolCall(run, tool, toolCallId, validated);
      return { kind: "result", output: validated, toolCallId, idempotentReplay: false };
    } catch (error) {
      this.failToolCall(run, tool, toolCallId, error);
      throw error;
    }
  }

  private completeRuntimeTool(envelope: RuntimeEnvelope): JsonValue {
    const run = this.runtimeRun(envelope);
    const payload = asObject(envelope.payload as JsonValue);
    const toolCallId = requiredString(payload, "toolCallId");
    const toolId = requiredString(payload, "tool");
    const tool = this.requiredRunTool(run, toolId);
    const row = this.database.raw.query<ToolCallRow, [string]>("SELECT * FROM tool_calls WHERE tool_call_id=?").get(toolCallId);
    if (row === null || row.run_id !== run.runId || row.tool_id !== tool.id) throw serviceError("TOOL_CALL_NOT_FOUND", `Tool call ${toolCallId} not found`);
    if (row.state !== "running") throw serviceError("TOOL_CALL_ALREADY_FINISHED", `Tool call ${toolCallId} is ${row.state}`);
    if (isJsonObject(payload.error)) {
      const error = new MarcusError({
        code: typeof payload.error.code === "string" ? payload.error.code : "TOOL_EXECUTION_FAILED",
        message: typeof payload.error.message === "string" ? payload.error.message : `Tool ${tool.id} failed`,
        retryable: payload.error.retryable === true,
      });
      this.failToolCall(run, tool, toolCallId, error);
      return { recorded: true, state: "failed" };
    }
    const rawOutput = payload.output === undefined ? null : payload.output;
    if (rawOutput instanceof Uint8Array) throw serviceError("TOOL_OUTPUT_INVALID", "Tool output must be JSON");
    const output = validateToolValue(tool.outputSchema, rawOutput, "TOOL_OUTPUT_INVALID", tool.id);
    this.finishToolCall(run, tool, toolCallId, output);
    return { recorded: true, state: "completed" };
  }

  private insertToolCall(
    run: RunRecord,
    tool: ToolManifest,
    input: JsonValue,
    idempotencyKey: string | undefined,
    state: "running" | "completed",
    cachedFromToolCallId?: string,
    outputJson?: string,
  ): string {
    const toolCallId = `toolcall_${Bun.randomUUIDv7().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    this.database.raw.query(`INSERT INTO tool_calls(tool_call_id, run_id, task_id, tool_id, state, input_json, output_json, error_json,
      trace_id, created_at, finished_at, agent_version_id, tool_version, risk, side_effects, idempotency_key, approval_id, cached_from_call_id)
      VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
      .run(
        toolCallId,
        run.runId,
        tool.id,
        state,
        JSON.stringify(redactAuditValue(input, "tools.call")),
        outputJson ?? null,
        run.traceId,
        now,
        state === "completed" ? now : null,
        run.agentVersionId,
        tool.version,
        tool.risk,
        tool.sideEffects ? 1 : 0,
        idempotencyKey ?? null,
        cachedFromToolCallId ?? null,
      );
    return toolCallId;
  }

  private rejectToolCall(run: RunRecord, toolId: string, input: unknown, error: unknown, descriptor?: ToolManifest): string {
    const tool = descriptor ?? officialToolManifest(toolId) ?? {
      id: toolId,
      version: "unknown",
      source: "agent",
      description: "Unregistered tool call attempt",
      inputSchema: {},
      outputSchema: {},
      timeoutMs: 0,
      cancellable: false,
      sideEffects: false,
      risk: "high",
      idempotency: { strategy: "none" },
    } satisfies ToolManifest;
    const toolCallId = `toolcall_${Bun.randomUUIDv7().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    const failure = toolError(error);
    const safeInput = input instanceof Uint8Array ? { binary: true, size: input.byteLength } : sanitizeRuntimePayload(input);
    this.database.raw.query(`INSERT INTO tool_calls(tool_call_id, run_id, task_id, tool_id, state, input_json, output_json, error_json,
      trace_id, created_at, finished_at, agent_version_id, tool_version, risk, side_effects, idempotency_key, approval_id, cached_from_call_id)
      VALUES (?, ?, NULL, ?, 'failed', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`)
      .run(toolCallId, run.runId, tool.id, JSON.stringify(redactAuditValue(safeInput, "tools.call")), JSON.stringify(failure), run.traceId, now, now, run.agentVersionId, tool.version, tool.risk, tool.sideEffects ? 1 : 0);
    this.appendToolEvent(run, tool, toolCallId, "failed", { error: failure, rejectedBeforeExecution: true });
    this.auditToolCall(run, tool, toolCallId, "failure");
    return toolCallId;
  }

  private findToolReplay(agentVersionId: string, toolId: string, idempotencyKey: string): ToolCallRow | undefined {
    return this.database.raw.query<ToolCallRow, [string, string, string]>(`SELECT * FROM tool_calls
      WHERE agent_version_id=? AND tool_id=? AND idempotency_key=? AND state IN ('waiting_for_approval','running','completed')
      ORDER BY created_at DESC LIMIT 1`).get(agentVersionId, toolId, idempotencyKey) ?? undefined;
  }

  private toolIdempotencyKey(run: RunRecord, tool: ToolManifest, input: JsonValue, options: ToolCallOptions): string | undefined {
    if (tool.idempotency.strategy === "none") return undefined;
    const material = tool.idempotency.strategy === "input-hash"
      ? stableToolJson(input)
      : options.idempotencyKey;
    if (material === undefined || material.length === 0) return undefined;
    const scope = tool.idempotency.scope === "run" ? run.runId : run.agentVersionId;
    return new Bun.CryptoHasher("sha256").update(`${scope}\0${tool.id}\0${tool.version}\0${material}`).digest("hex");
  }

  private finishToolCall(run: RunRecord, tool: ToolManifest, toolCallId: string, output: JsonValue): void {
    const finishedAt = new Date().toISOString();
    const result = this.database.raw.query(`UPDATE tool_calls SET state='completed', output_json=?, error_json=NULL, finished_at=?
      WHERE tool_call_id=? AND state='running'`).run(JSON.stringify(output), finishedAt, toolCallId);
    if (result.changes !== 1) throw serviceError("TOOL_CALL_ALREADY_FINISHED", `Tool call ${toolCallId} is no longer running`);
    this.appendToolEvent(run, tool, toolCallId, "completed");
    this.auditToolCall(run, tool, toolCallId, "success");
  }

  private failToolCall(run: RunRecord, tool: ToolManifest, toolCallId: string, error: unknown): void {
    const failure = toolError(error);
    const result = this.database.raw.query(`UPDATE tool_calls SET state='failed', error_json=?, finished_at=?
      WHERE tool_call_id=? AND state IN ('running','waiting_for_approval')`)
      .run(JSON.stringify(failure), new Date().toISOString(), toolCallId);
    if (result.changes !== 1) return;
    this.appendToolEvent(run, tool, toolCallId, "failed", { error: failure });
    this.auditToolCall(run, tool, toolCallId, "failure");
  }

  private appendToolEvent(
    run: RunRecord,
    tool: ToolManifest,
    toolCallId: string,
    state: string,
    extra: Record<string, JsonValue> = {},
  ): void {
    this.repositories.appendKernelEvent({
      eventType: `tool.${state}`,
      nodeId: this.config.nodeId,
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.runId,
      actor: { principalId: run.agentId },
      correlationId: run.correlationId,
      causationId: run.runId,
      traceId: run.traceId,
      occurredAt: new Date().toISOString(),
      payload: { toolCallId, toolId: tool.id, toolVersion: tool.version, risk: tool.risk, sideEffects: tool.sideEffects, state, ...extra },
    });
  }

  private auditToolCall(run: RunRecord, tool: ToolManifest, toolCallId: string, result: string, cachedFromToolCallId?: string): void {
    this.database.raw.query(`INSERT INTO audit_events(audit_id, project_id, actor_json, operation, resource_json, before_json, after_json, source_ip, trace_id, result, occurred_at)
      VALUES (?, ?, ?, 'tools.call', ?, NULL, NULL, NULL, ?, ?, ?)`)
      .run(
        `audit_${Bun.randomUUIDv7()}`,
        run.projectId,
        JSON.stringify({ principal: { id: run.agentId, type: "external" }, runId: run.runId, agentVersionId: run.agentVersionId }),
        JSON.stringify({ runId: run.runId, agentVersionId: run.agentVersionId, toolCallId, toolId: tool.id, toolVersion: tool.version, risk: tool.risk, sideEffects: tool.sideEffects, ...(cachedFromToolCallId === undefined ? {} : { cachedFromToolCallId }) }),
        run.traceId,
        result,
        new Date().toISOString(),
      );
  }

  private cancelToolExecutions(runId: string, reason: string): void {
    for (const [toolCallId, execution] of this.activeToolExecutions) {
      if (execution.runId !== runId) continue;
      if (!execution.cancellable) continue;
      execution.controller.abort(reason);
      this.activeToolExecutions.delete(toolCallId);
    }
  }

  private cancelRunApprovals(runId: string, reason: string): void {
    for (const [approvalId, approval] of this.pendingApprovals) {
      if (approval.runId !== runId) continue;
      clearTimeout(approval.timer);
      this.pendingApprovals.delete(approvalId);
      this.database.raw.query("UPDATE approval_requests SET status='cancelled', resolved_at=? WHERE approval_id=? AND status='pending'")
        .run(new Date().toISOString(), approvalId);
      approval.reject(serviceError("APPROVAL_CANCELLED", reason));
    }
  }

  private async runOfficialTool(
    run: RunRecord,
    tool: ToolManifest,
    input: JsonValue,
    timeoutMs: number,
    toolCallId: string,
    envelope: RuntimeEnvelope,
  ): Promise<JsonValue> {
    const controller = new AbortController();
    this.activeToolExecutions.set(toolCallId, { runId: run.runId, controller, cancellable: tool.cancellable });
    const timer = setTimeout(() => controller.abort(`Tool ${tool.id} timed out after ${timeoutMs}ms`), timeoutMs);
    try {
      return await Promise.race([
        this.executeOfficialTool(run, tool, asObject(input), controller.signal, envelope),
        abortedTool(controller.signal, tool.id),
      ]);
    } finally {
      clearTimeout(timer);
      this.activeToolExecutions.delete(toolCallId);
    }
  }

  private async executeOfficialTool(
    run: RunRecord,
    tool: ToolManifest,
    input: Record<string, JsonValue | Uint8Array>,
    signal: AbortSignal,
    envelope: RuntimeEnvelope,
  ): Promise<JsonValue> {
    const store = this.projectStore(run.projectId);
    if (tool.id === "marcus/files.read") {
      return { data: (await store.read(requiredString(input, "path"))).toBase64(), encoding: "base64" };
    }
    if (tool.id === "marcus/files.search") {
      const path = optionalString(input, "path");
      return await store.search(requiredString(input, "query"), path === undefined ? {} : { path }) as unknown as JsonValue;
    }
    if (tool.id === "marcus/files.list") {
      return (await store.list(optionalString(input, "path") ?? "project:/")).map(projectFileMetadata) as unknown as JsonValue;
    }
    if (tool.id === "marcus/files.stat") return projectFileMetadata(await store.stat(requiredString(input, "path")));
    if (tool.id === "marcus/files.write") {
      const content = requiredStringAllowEmpty(input, "content");
      const bytes = input.encoding === "base64" ? new Uint8Array(Buffer.from(content, "base64")) : content;
      const metadata = await store.write(requiredString(input, "path"), bytes, {
        ...(typeof input.expectedRevision === "number" ? { expectedRevision: input.expectedRevision } : {}),
        ...(typeof input.mediaType === "string" ? { mediaType: input.mediaType } : {}),
        actorId: run.agentId,
      });
      return projectFileMetadata(metadata);
    }
    if (tool.id === "marcus/files.move") {
      const from = requiredString(input, "from");
      const to = requiredString(input, "to");
      await store.move(from, to, run.agentId);
      return { from, to, moved: true };
    }
    if (tool.id === "marcus/files.delete") {
      const path = requiredString(input, "path");
      await store.purge(path);
      return { path, deleted: true };
    }
    if (tool.id === "marcus/http.request") return this.executeHttpTool(input, signal);
    if (tool.id === "marcus/artifacts.create") return this.createToolArtifact(run, input);
    if (tool.id === "marcus/agents.invoke") return this.invokeSubagent(run, input, envelope);
    if (tool.id === "marcus/runs.get") return this.requiredRun(run.projectId, requiredString(input, "runId")) as unknown as JsonValue;
    if (tool.id === "marcus/events.publish") return this.publishEvent(run.projectId, input as JsonValue, run.agentId, run);
    if (tool.id === "marcus/approvals.request") return this.requestApproval(run, input as JsonValue);
    throw serviceError("TOOL_NOT_FOUND", `Official tool ${tool.id} has no runtime implementation`);
  }

  private async executeHttpTool(input: Record<string, JsonValue | Uint8Array>, signal: AbortSignal): Promise<JsonValue> {
    const url = new URL(requiredString(input, "url"));
    if (url.protocol !== "http:" && url.protocol !== "https:") throw serviceError("TOOL_HTTP_URL_INVALID", "HTTP tool only supports http and https URLs");
    if (url.username !== "" || url.password !== "") throw serviceError("TOOL_HTTP_URL_INVALID", "HTTP URL credentials are forbidden");
    const method = optionalString(input, "method") ?? "GET";
    const headers = input.headers === undefined ? {} : lowerHeaders(input.headers);
    const rawBody = optionalString(input, "body");
    const body = rawBody === undefined
      ? undefined
      : input.bodyEncoding === "base64" ? new Uint8Array(Buffer.from(rawBody, "base64")) : rawBody;
    if (typeof body === "string" ? new TextEncoder().encode(body).byteLength > 1_048_576 : (body?.byteLength ?? 0) > 1_048_576) {
      throw serviceError("TOOL_HTTP_BODY_TOO_LARGE", "HTTP request body exceeds 1 MiB");
    }
    const response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }), redirect: "manual", signal });
    const maxBytes = Math.max(1, Math.min(numberOr(input.maxResponseBytes, 1_048_576), 4_194_304));
    const { bytes, truncated } = await readBoundedBody(response, maxBytes, signal);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const text = /(^text\/|json|javascript|xml|x-www-form-urlencoded)/u.test(contentType);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") responseHeaders[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: text ? new TextDecoder().decode(bytes) : bytes.toBase64(),
      encoding: text ? "utf8" : "base64",
      truncated,
    };
  }

  private async createToolArtifact(run: RunRecord, input: Record<string, JsonValue | Uint8Array>): Promise<JsonValue> {
    const projectPath = optionalString(input, "projectPath");
    const content = optionalString(input, "content");
    if ((projectPath === undefined) === (content === undefined)) {
      throw serviceError("TOOL_ARTIFACT_SOURCE_INVALID", "Provide exactly one of content or projectPath");
    }
    const home = this.repositories.getProjectHome(run.projectId);
    if (home === undefined) throw serviceError("PROJECT_HOME_NOT_FOUND", "Project Home is unavailable");
    const bytes = projectPath === undefined
      ? input.encoding === "base64" ? new Uint8Array(Buffer.from(content!, "base64")) : content!
      : await this.projectStore(run.projectId).read(projectPath);
    const artifact = await new DiskArtifactStore(home.physicalPath).create({
      projectId: run.projectId,
      agentId: run.agentId,
      agentVersionId: run.agentVersionId,
      runId: run.runId,
      name: requiredString(input, "name"),
      mediaType: requiredString(input, "mediaType"),
      bytes,
      visibility: input.visibility === "public" || input.visibility === "signed" ? input.visibility : "private",
    });
    this.database.raw.query("INSERT INTO artifacts(artifact_id, project_id, agent_id, agent_version_id, run_id, task_id, name, media_type, size, sha256, storage_uri, visibility, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)")
      .run(artifact.artifactId, artifact.projectId, artifact.agentId, artifact.agentVersionId, artifact.runId, artifact.name, artifact.mediaType, artifact.size, artifact.sha256, artifact.storageUri, artifact.visibility, artifact.createdAt);
    return { artifactId: artifact.artifactId };
  }

  private recordRuntimeEvent(envelope: RuntimeEnvelope): void {
    const now = new Date().toISOString();
    if (envelope.type === RuntimeMessageType.HEARTBEAT) {
      this.database.raw.query("UPDATE processes SET last_heartbeat_at=?, health='healthy' WHERE instance_id=? OR mpid=?")
        .run(now, envelope.instanceId ?? null, envelope.mpid ?? null);
    } else if (envelope.type === RuntimeMessageType.PROGRESS) {
      this.database.raw.query("UPDATE processes SET last_progress_at=?, last_heartbeat_at=?, health='healthy' WHERE instance_id=? OR mpid=?")
        .run(now, now, envelope.instanceId ?? null, envelope.mpid ?? null);
    }
    if (envelope.runId === undefined) return;
    const run = this.repositories.getRun(envelope.runId);
    if (run === undefined) return;
    const journaled = new Set<RuntimeMessageType>([RuntimeMessageType.HEARTBEAT, RuntimeMessageType.PROGRESS, RuntimeMessageType.LOG, RuntimeMessageType.EVENT_PUBLISH]).has(envelope.type);
    if (!journaled) return;
    this.repositories.appendKernelEvent({
      eventType: `runtime.${envelope.type.toLowerCase()}`,
      nodeId: this.config.nodeId,
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.runId,
      ...(envelope.mpid === undefined ? {} : { mpid: envelope.mpid }),
      correlationId: envelope.correlationId,
      ...(envelope.causationId === undefined ? {} : { causationId: envelope.causationId }),
      traceId: envelope.traceId,
      occurredAt: now,
      payload: sanitizeRuntimePayload(envelope.payload),
    });
  }

  private runtimeHandlers(): Partial<Record<RuntimeMessageType, (envelope: RuntimeEnvelope) => unknown | Promise<unknown>>> {
    return {
      [RuntimeMessageType.MODEL_GENERATE]: async (envelope) => {
        const run = this.runtimeRun(envelope);
        const payload = asObject(envelope.payload as JsonValue);
        const manifest = this.repositories.getAgentManifest(run.agentVersionId);
        const manifestRole = typeof manifest?.model?.role === "string" ? manifest.model.role : undefined;
        const role = optionalString(payload, "role") ?? manifestRole ?? "agent.default";
        const binding = this.getModelRole(role);
        if (binding === undefined) throw serviceError("MODEL_ROLE_NOT_CONFIGURED", `Model role ${role} is not configured`);
        const configuration = JSON.parse(binding.configuration_json) as Record<string, JsonValue>;
        const providerRow = this.requiredProvider(binding.provider_id);
        const messages = modelMessages(payload.messages);
        const history = manifest?.conversation?.injection === "automatic" && run.conversationId !== undefined
          ? this.conversationModelHistory(run.conversationId, run.runId, manifest.conversation.history.maxMessages)
          : [];
        const system = optionalString(payload, "system");
        const request: ModelGenerationRequest = {
          model: binding.model_name,
          messages: [...(system === undefined ? [] : [{ role: "system" as const, content: system }]), ...history, ...messages],
          ...(typeof payload.temperature === "number"
            ? { temperature: payload.temperature }
            : typeof configuration.temperature === "number" ? { temperature: configuration.temperature } : {}),
          ...(typeof payload.maxOutputTokens === "number"
            ? { maxOutputTokens: payload.maxOutputTokens }
            : typeof configuration.maxOutputTokens === "number" ? { maxOutputTokens: configuration.maxOutputTokens } : {}),
          ...(typeof payload.thinking === "boolean"
            ? { thinking: payload.thinking }
            : typeof configuration.thinking === "boolean" ? { thinking: configuration.thinking } : {}),
          ...(isReasoningEffort(payload.reasoningEffort)
            ? { reasoningEffort: payload.reasoningEffort }
            : isReasoningEffort(configuration.reasoningEffort) ? { reasoningEffort: configuration.reasoningEffort } : {}),
          ...(isJsonObject(payload.output) ? { outputSchema: payload.output as SerializedSchema } : {}),
        };
        const response = await this.createProvider(providerRow, run.projectId).generate(request);
        const { reasoningContent: _providerPrivateReasoning, ...publicResponse } = response;
        return publicResponse;
      },
      [RuntimeMessageType.FILE_OPERATION]: async (envelope) => {
        const run = this.runtimeRun(envelope);
        const payload = asObject(envelope.payload as JsonValue);
        const store = this.projectStore(run.projectId);
        if (payload.operation === "read") return store.read(requiredString(payload, "path"));
        if (payload.operation === "write") return store.write(requiredString(payload, "path"), payload.content instanceof Uint8Array ? payload.content : String(payload.content ?? ""));
        throw serviceError("FILE_OPERATION_UNSUPPORTED", "Unsupported managed file operation");
      },
      [RuntimeMessageType.TOOL_CALL]: async (envelope) => {
        return this.invokeRuntimeTool(envelope);
      },
      [RuntimeMessageType.TOOL_DISCOVERY]: (envelope) => this.discoverRuntimeTools(envelope),
      [RuntimeMessageType.TOOL_RESULT]: (envelope) => this.completeRuntimeTool(envelope),
      [RuntimeMessageType.SUBAGENT_REQUEST]: async (envelope) => {
        const parent = this.runtimeRun(envelope);
        const payload = asObject(envelope.payload as JsonValue);
        if (payload.operation === "run") return this.invokeSubagent(parent, asObject(payload.input), envelope);
        if (payload.operation === "parallel") {
          if (!Array.isArray(payload.tasks)) throw serviceError("SUBAGENT_REQUEST_INVALID", "parallel tasks must be an array");
          const handles = await Promise.all(payload.tasks.map((task) => this.invokeSubagent(parent, asObject(task), envelope, false)));
          return Promise.all(handles.map((handle) => this.waitForRunOutput(requiredString(asObject(handle), "runId"))));
        }
        throw serviceError("SUBAGENT_OPERATION_UNSUPPORTED", `Subagent operation ${String(payload.operation)} is unsupported`);
      },
      [RuntimeMessageType.MESSAGE_SEND]: (envelope) => {
        const run = this.runtimeRun(envelope);
        return this.sendMessage(run.projectId, { agentId: run.agentId, runId: run.runId }, envelope.payload as JsonValue);
      },
      [RuntimeMessageType.EVENT_PUBLISH]: (envelope) => {
        const run = this.runtimeRun(envelope);
        return this.publishEvent(run.projectId, envelope.payload as JsonValue, run.agentId, run);
      },
      [RuntimeMessageType.CONVERSATION_OPERATION]: (envelope) => {
        const run = this.runtimeRun(envelope);
        if (run.conversationId === undefined) throw serviceError("CONVERSATION_NOT_AVAILABLE", "Run has no conversation context");
        const payload = asObject(envelope.payload as JsonValue);
        if (payload.operation === "list") {
          const options = isJsonObject(payload.options) ? payload.options : {};
          return this.conversationMessages(run.conversationId, numberOr(options.limit, 100), typeof options.beforeSequence === "number" ? options.beforeSequence : undefined);
        }
        if (payload.operation === "append") {
          const result = this.repositories.appendConversationMessage({
            conversationId: run.conversationId,
            role: "event",
            content: (payload.message ?? null) as JsonValue,
            runId: run.runId,
            agentVersionId: run.agentVersionId,
          });
          return result;
        }
        if (payload.operation === "getMetadata") {
          const row = this.database.raw.query<{ metadata_json: string }, [string]>("SELECT metadata_json FROM conversations WHERE conversation_id=?").get(run.conversationId);
          return row === null ? undefined : JSON.parse(row.metadata_json);
        }
        if (payload.operation === "setMetadata") {
          this.database.raw.query("UPDATE conversations SET metadata_json=?, updated_at=? WHERE conversation_id=?")
            .run(JSON.stringify(payload.value ?? null), new Date().toISOString(), run.conversationId);
          return { updated: true };
        }
        if (payload.operation === "clear") return this.clearConversation(run.projectId, run.conversationId);
        throw serviceError("CONVERSATION_OPERATION_UNSUPPORTED", `Conversation operation ${String(payload.operation)} is unsupported`);
      },
      [RuntimeMessageType.CHECKPOINT_SAVE]: (envelope) => {
        const run = this.runtimeRun(envelope);
        const payload = asObject(envelope.payload as JsonValue);
        const checkpointId = `cp_${Bun.randomUUIDv7().replaceAll("-", "")}`;
        const state = payload.domainState ?? null;
        this.database.raw.query("INSERT INTO checkpoints(checkpoint_id, run_id, agent_version_id, schema_version, resume_key, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(checkpointId, run.runId, run.agentVersionId, numberOr(payload.schemaVersion, 1), requiredString(payload, "resumeKey"), JSON.stringify(state), new Bun.CryptoHasher("sha256").update(JSON.stringify(state)).digest("hex"), new Date().toISOString());
        return { checkpointId };
      },
      [RuntimeMessageType.ARTIFACT_COMMIT]: async (envelope) => {
        const run = this.runtimeRun(envelope);
        const payload = asObject(envelope.payload as JsonValue);
        const home = this.repositories.getProjectHome(run.projectId);
        if (home === undefined) throw serviceError("PROJECT_HOME_NOT_FOUND", "Project Home is unavailable");
        const store = new DiskArtifactStore(home.physicalPath);
        const projectFilePath = payload.operation === "projectFile" ? requiredString(payload, "path") : undefined;
        const bytes = projectFilePath === undefined
          ? (payload.bytes instanceof Uint8Array ? payload.bytes : String(payload.bytes ?? ""))
          : await this.projectStore(run.projectId).read(projectFilePath);
        const name = projectFilePath === undefined ? requiredString(payload, "name") : projectFilePath.split("/").at(-1) ?? "artifact.bin";
        const mediaType = projectFilePath === undefined ? requiredString(payload, "mediaType") : "application/octet-stream";
        const visibility = payload.visibility === "public" || payload.visibility === "signed" ? payload.visibility : "private";
        const artifact = await store.create({ projectId: run.projectId, agentId: run.agentId, agentVersionId: run.agentVersionId, runId: run.runId, name, mediaType, bytes, visibility });
        this.database.raw.query("INSERT INTO artifacts(artifact_id, project_id, agent_id, agent_version_id, run_id, task_id, name, media_type, size, sha256, storage_uri, visibility, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)")
          .run(artifact.artifactId, artifact.projectId, artifact.agentId, artifact.agentVersionId, artifact.runId, artifact.name, artifact.mediaType, artifact.size, artifact.sha256, artifact.storageUri, artifact.visibility, artifact.createdAt);
        return { artifactId: artifact.artifactId };
      },
      [RuntimeMessageType.SECRET_GET]: async (envelope) => {
        const run = this.runtimeRun(envelope);
        return this.secrets.resolve(requiredString(asObject(envelope.payload as JsonValue), "name"), run.projectId);
      },
      [RuntimeMessageType.APPROVAL_REQUEST]: (envelope) => this.requestApproval(this.runtimeRun(envelope), envelope.payload as JsonValue),
    };
  }

  private runtimeRun(envelope: RuntimeEnvelope): RunRecord {
    if (envelope.runId === undefined) throw serviceError("RUN_CONTEXT_MISSING", "Runtime message has no runId");
    const run = this.repositories.getRun(envelope.runId);
    if (run === undefined) throw serviceError("RUN_NOT_FOUND", "Runtime Run not found");
    return run;
  }

  private projectStore(projectId: string): DiskProjectFileStore {
    let store = this.fileStores.get(projectId);
    if (store !== undefined) return store;
    const project = this.requiredProject(projectId);
    const home = this.repositories.getProjectHome(projectId);
    if (home === undefined || home.status !== "active") throw serviceError("PROJECT_HOME_NOT_FOUND", "Project Home is unavailable");
    store = new DiskProjectFileStore({
      projectId,
      projectSlug: project.slug,
      homePath: home.physicalPath,
      metadata: new SqliteProjectFileMetadataRepository(this.database),
    });
    this.fileStores.set(projectId, store);
    void store.initialize();
    return store;
  }

  private requiredProject(projectId: string): ProjectRecord {
    const project = this.repositories.getProject(projectId);
    if (project === undefined) throw serviceError("PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    return project;
  }

  private requiredProjectByReference(reference: string): ProjectRecord {
    const project = this.repositories.getProject(reference);
    if (project === undefined) throw serviceError("PROJECT_NOT_FOUND", `Project ${reference} not found`);
    return project;
  }

  private requiredAgent(projectId: string, reference: string): AgentDefinitionRecord {
    const agent = this.repositories.getAgentDefinition(reference) ?? this.repositories.getAgentBySlug(projectId, reference);
    if (agent === undefined || agent.projectId !== projectId) throw serviceError("AGENT_NOT_FOUND", `Agent ${reference} not found`);
    return agent;
  }

  private requiredRun(projectId: string, runId: string): RunRecord {
    const run = this.repositories.getRun(runId);
    if (run === undefined || run.projectId !== projectId) throw serviceError("RUN_NOT_FOUND", `Run ${runId} not found`);
    return run;
  }
}

async function loadOrCreateMasterKey(config: MarcusdConfig, database: MarcusSqliteDatabase): Promise<Uint8Array> {
  try {
    const value = await Bun.file(config.secrets.keyFile).text();
    await chmod(config.secrets.keyFile, 0o600);
    return SecretStore.decodeMasterKey(value);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (config.secrets.masterKey !== undefined) return SecretStore.decodeMasterKey(config.secrets.masterKey);
  const existing = database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM secrets").get()?.value ?? 0;
  if (existing > 0) throw serviceError("SECRETS_MASTER_KEY_REQUIRED", "Secrets exist but the configured master key file is missing");
  await mkdir(resolve(config.secrets.keyFile, ".."), { recursive: true, mode: 0o700 });
  const key = SecretStore.generateMasterKey();
  try {
    const handle = await open(config.secrets.keyFile, "wx", 0o600);
    try { await handle.writeFile(Buffer.from(key).toString("base64")); }
    finally { await handle.close(); }
    return key;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return SecretStore.decodeMasterKey(await Bun.file(config.secrets.keyFile).text());
    }
    throw error;
  }
}

async function writeProtectedFile(target: string, value: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${Bun.randomUUIDv7()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(value); }
    finally { await handle.close(); }
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function recoverAuthorityLock(lockPath: string): Promise<void> {
  let raw: string;
  try { raw = await Bun.file(lockPath).text(); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  let pid: number | undefined;
  try {
    const value = JSON.parse(raw) as { pid?: unknown };
    if (typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0) pid = value.pid;
  } catch { /* explicit recovery can remove malformed stale metadata */ }
  if (pid !== undefined) {
    try {
      process.kill(pid, 0);
      throw serviceError("KERNEL_AUTHORITY_STILL_RUNNING", `Authority process ${pid} is still running`);
    } catch (error) {
      if (error instanceof MarcusError) throw error;
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  }
  await rm(lockPath, { force: true });
}

async function prepareBootstrap(config: MarcusdConfig, database: MarcusSqliteDatabase): Promise<NonNullable<MarcusdConfig["bootstrap"]> | undefined> {
  const hasAdmin = (database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM user_roles WHERE role='system_admin'").get()?.value ?? 0) > 0;
  const tokenFile = config.bootstrap?.tokenFile;
  if (hasAdmin) {
    if (tokenFile !== undefined) await rm(tokenFile, { force: true });
    return undefined;
  }
  if (config.bootstrap?.token !== undefined) return config.bootstrap;
  const target = tokenFile ?? resolve(config.dataDir, "bootstrap.token");
  try {
    const token = (await Bun.file(target).text()).trim();
    if (token.length < 32) throw serviceError("AUTH_BOOTSTRAP_INVALID", "Bootstrap token file is invalid");
    await chmod(target, 0o600);
    return { token, tokenFile: target };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const token = `bootstrap_${Bun.randomUUIDv7().replaceAll("-", "")}${Bun.randomUUIDv7().replaceAll("-", "")}`;
  await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(token); }
    finally { await handle.close(); }
    return { token, tokenFile: target };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return { token: (await Bun.file(target).text()).trim(), tokenFile: target };
    }
    throw error;
  }
}

function validateConfig(config: MarcusdConfig): void {
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(config.listen.host);
  if (!loopback && config.listen.tlsOptions === undefined) {
    throw serviceError("TLS_REQUIRED", "Remote MNP listeners require TLS");
  }
  if (config.listen.tls === "required" && config.listen.tlsOptions === undefined) throw serviceError("TLS_REQUIRED", "TLS configuration is required");
}

function asObject(value: JsonValue | unknown): Record<string, JsonValue | Uint8Array> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw serviceError("REQUEST_PAYLOAD_INVALID", "Payload must be an object");
  return value as Record<string, JsonValue | Uint8Array>;
}
function requiredString(value: Record<string, JsonValue | Uint8Array>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) throw serviceError("REQUEST_PAYLOAD_INVALID", `${key} is required`);
  return item;
}
function requiredStringAllowEmpty(value: Record<string, JsonValue | Uint8Array>, key: string): string {
  const item = value[key];
  if (typeof item !== "string") throw serviceError("REQUEST_PAYLOAD_INVALID", `${key} must be a string`);
  return item;
}
function optionalString(value: Record<string, JsonValue | Uint8Array>, key: string): string | undefined { return typeof value[key] === "string" ? value[key] : undefined; }
function numberOr(value: JsonValue | Uint8Array | undefined, fallback: number): number { return typeof value === "number" ? value : fallback; }
function serviceError(code: string, message: string): MarcusError { return new MarcusError({ code, message, retryable: false }); }

function toolCallOptions(value: JsonValue | Uint8Array | undefined): ToolCallOptions {
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw serviceError("TOOL_OPTIONS_INVALID", "Tool call options must be an object");
  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw serviceError("TOOL_OPTIONS_INVALID", "timeoutMs must be a positive integer");
  }
  const idempotencyKey = value.idempotencyKey;
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 256)) {
    throw serviceError("TOOL_OPTIONS_INVALID", "idempotencyKey must contain between 1 and 256 characters");
  }
  return {
    ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  };
}

function validateToolValue(schema: SerializedSchema, value: unknown, code: string, toolId: string): JsonValue {
  const validation = validateSchema<JsonValue>(schema, value);
  if (validation.success) return validation.data;
  throw new MarcusError({
    code,
    message: `${toolId}: ${validation.issues.map((issue) => `${issue.path || "$"} ${issue.message}`).join("; ")}`,
    retryable: false,
    details: { issues: validation.issues } as unknown as JsonValue,
  });
}

function stableToolJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableToolJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableToolJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolError(error: unknown): Record<string, JsonValue> {
  if (error instanceof MarcusError) return error.toJSON() as unknown as Record<string, JsonValue>;
  return {
    code: error instanceof DOMException && error.name === "AbortError" ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function projectFileMetadata(metadata: ProjectFileMetadata): JsonValue {
  return {
    path: `project:/${metadata.relativePath}`,
    kind: metadata.kind,
    size: metadata.size,
    revision: metadata.revision,
    updatedAt: metadata.updatedAt,
    ...(metadata.sha256 === undefined ? {} : { sha256: metadata.sha256 }),
    ...(metadata.mediaType === undefined ? {} : { mediaType: metadata.mediaType }),
  };
}

function projectTokenMetadata(row: ProjectTokenRow): JsonValue {
  return {
    tokenId: row.token_id,
    label: row.label ?? row.token_id,
    scopes: parseStringArray(row.scopes_json),
    status: row.revoked_at !== null ? "revoked" : row.expires_at !== null && Date.parse(row.expires_at) <= Date.now() ? "expired" : "active",
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at }),
    createdAt: row.created_at,
  };
}

function abortedTool(signal: AbortSignal, toolId: string): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new MarcusError({
      code: String(signal.reason).includes("timed out") ? "TOOL_TIMEOUT" : "TOOL_CANCELLED",
      message: signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? `Tool ${toolId} cancelled`),
      retryable: false,
    }));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (response.body === null) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const result = await reader.read();
      if (result.done) break;
      const remaining = maxBytes - size;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel("Response limit reached");
        break;
      }
      if (result.value.byteLength > remaining) {
        chunks.push(result.value.slice(0, remaining));
        size += remaining;
        truncated = true;
        await reader.cancel("Response limit reached");
        break;
      }
      chunks.push(result.value);
      size += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function stringSchema(description: string): SerializedSchema {
  return { type: "string", minLength: 1, maxLength: 20_000, "x-description": description };
}

function tool(
  name: string,
  description: string,
  properties: Readonly<Record<string, SerializedSchema>>,
  required: readonly string[] = [],
): NonNullable<ModelGenerationRequest["tools"]>[number] {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}

function requiredProjectId(projectId: string | undefined): string {
  if (projectId === undefined) throw serviceError("PROJECT_REQUIRED", "Assistant tool requires projectId");
  return projectId;
}

function assertAssistantConfirmation(message: string, phrase: string, target: string): void {
  const normalized = message.toLocaleUpperCase("es");
  if (!normalized.includes(phrase) || !normalized.includes(target.toLocaleUpperCase("es"))) {
    throw serviceError("ASSISTANT_CONFIRMATION_REQUIRED", `Write ${phrase} ${target} to authorize this action`);
  }
}

function assistantSystemMessage(projectId: string | undefined, editPath?: string): ModelMessage {
  if (editPath !== undefined) {
    return {
      role: "system",
      content: `You are Marcus AI operating in restricted single-file agent editor mode. Answer in Spanish. The only allowed tools are files_read and files_write, the only allowed Project is ${projectId}, and the only allowed path is ${editPath}. First read the complete current source, then apply only the user's requested change, preserve every unrelated field and section, keep schema: marcus.agent/v1 as the first frontmatter field, and write the complete updated source back to the same path. Never create, delete, rename or run anything. Marcus validates the Markdown and automatically registers and activates an immutable AgentVersion after your write succeeds. Summarize the exact change concisely.\n\nOfficial Marcus documentation:${marcusDocumentationCorpus}`,
    };
  }
  return {
    role: "system",
    content: `You are Marcus AI, the expert assistant embedded in Marcus Backoffice. Answer in Spanish unless the user explicitly requests another language. Use the official documentation below as the only source of truth for Marcus behavior and commands. Use tools whenever current installation state is needed; never invent IDs, projects, agents, files, runs, providers or health. You may perform constructive actions requested by the user. Destructive or overwriting tools state their exact confirmation phrase: ask for it and do not call the tool until the latest user message contains that exact phrase and target. Be concise, technical and operational. The currently selected project is ${projectId ?? "none"}.\n\nOfficial Marcus documentation:${marcusDocumentationCorpus}`,
  };
}

function trimAssistantMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  if (messages.length <= ASSISTANT_MAX_PROVIDER_MESSAGES) return [...messages];
  const system = messages[0]!;
  const tail = messages.slice(-(ASSISTANT_MAX_PROVIDER_MESSAGES - 1));
  const firstUser = tail.findIndex((message) => message.role === "user");
  return [system, ...tail.slice(firstUser < 0 ? 0 : firstUser)];
}

function stripOuterMarkdownFence(value: string): string {
  const source = value.trim();
  if (!/^```(?:markdown|md)?\s*\n/iu.test(source)) return source;
  return source.replace(/^```(?:markdown|md)?\s*\n/iu, "").replace(/\n```\s*$/u, "");
}

function canonicalizeGeneratedAgentSource(value: string): { source: string; changed: boolean } {
  const source = value.replace(/\r\n?/gu, "\n").trim();
  if (!source.startsWith("---\n")) return { source, changed: false };
  const end = source.indexOf("\n---", 4);
  if (end < 0) return { source, changed: false };
  const frontmatter = source.slice(4, end);
  const withoutSchema = frontmatter.split("\n").filter((line) => !/^schema\s*:/u.test(line));
  const nextFrontmatter = ["schema: marcus.agent/v1", ...withoutSchema].join("\n");
  if (nextFrontmatter === frontmatter) return { source, changed: false };
  return { source: `---\n${nextFrontmatter}${source.slice(end)}`, changed: true };
}

function setMarkdownApiEnabled(source: string, enabled: boolean): string {
  const normalized = source.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) throw serviceError("MD_FRONTMATTER_REQUIRED", "Markdown Agent must start with frontmatter");
  const closing = normalized.indexOf("\n---", 4);
  if (closing < 0) throw serviceError("MD_FRONTMATTER_UNCLOSED", "Markdown Agent frontmatter is not closed");
  const frontmatter = normalized.slice(4, closing);
  const value = enabled ? "true" : "false";
  const updatedFrontmatter = /^api-enabled\s*:/mu.test(frontmatter)
    ? frontmatter.replace(/^api-enabled\s*:.*$/mu, `api-enabled: ${value}`)
    : `${frontmatter}\napi-enabled: ${value}`;
  return `${normalized.slice(0, 4)}${updatedFrontmatter}${normalized.slice(closing)}`;
}

function projectRole(value: string): "project_owner" | "project_operator" | "project_developer" | "project_viewer" {
  if (value === "project_owner" || value === "project_operator" || value === "project_developer" || value === "project_viewer") return value;
  throw serviceError("PROJECT_ROLE_INVALID", "Project role is invalid");
}

function mapProjectMember(row: ProjectMemberRow): Record<string, JsonValue> {
  return {
    userId: row.user_id,
    username: row.username,
    status: row.status,
    role: row.role,
    systemAdmin: row.system_admin === 1,
    createdAt: row.created_at,
  };
}

function stringArray(value: JsonValue | Uint8Array): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw serviceError("REQUEST_PAYLOAD_INVALID", "Expected an array of strings");
  return value;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function isReasoningEffort(value: unknown): value is "low" | "high" | "max" {
  return value === "low" || value === "high" || value === "max";
}

function validateProviderUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    throw serviceError("PROVIDER_BASE_URL_INVALID", "Provider baseUrl must be an absolute HTTP(S) URL");
  }
}

function emptyCapabilities(): ProviderCapabilities {
  return { modelListing: false, chat: false, streaming: false, toolCalling: false, structuredOutput: false, thinking: false, vision: false, embeddings: false };
}

function publicProvider(row: ProviderRow): Record<string, JsonValue> {
  const catalogId = providerCatalogEntry(row.type)?.id ?? (row.base_url === null ? undefined : inferProviderCatalogId(row.base_url));
  return {
    providerId: row.provider_id,
    name: row.name,
    type: row.type,
    ...(catalogId === undefined ? {} : { catalogId }),
    ...(row.base_url === null ? {} : { baseUrl: row.base_url }),
    secretRefs: parseStringArray(row.secret_refs_json),
    status: row.status,
    capabilities: JSON.parse(row.capabilities_json) as JsonValue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapModelRole(row: ModelRoleRow): Record<string, JsonValue> {
  return { role: row.role, providerId: row.provider_id, model: row.model_name, configuration: JSON.parse(row.configuration_json) as JsonValue, updatedAt: row.updated_at };
}

function modelMessages(value: JsonValue | Uint8Array | undefined): ModelGenerationRequest["messages"] {
  if (!Array.isArray(value)) throw serviceError("MODEL_REQUEST_INVALID", "messages must be an array");
  return value.map((item) => {
    if (!isJsonObject(item)) throw serviceError("MODEL_REQUEST_INVALID", "Each model message must be an object");
    const role = item.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") throw serviceError("MODEL_REQUEST_INVALID", "Model message role is invalid");
    if (!("content" in item)) throw serviceError("MODEL_REQUEST_INVALID", "Model message content is required");
    return { role, content: item.content! };
  });
}

function redactAuditValue(value: JsonValue, operation: string): JsonValue {
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, operation));
  if (typeof value !== "object" || value === null) return value;
  const redacted: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const sensitive = /password|token|api.?key|authorization|credential|signature/iu.test(key)
      || (operation === "secrets.set" && key === "value")
      || (operation === "files.write" && key === "content")
      || (operation === "tools.call" && new Set(["content", "body", "data"]).has(key))
      || (operation === "uploads.chunk" && key === "data")
      || (operation === "agents.generateMarkdown" && key === "prompt")
      || (operation === "assistant.chat" && new Set(["messages", "message", "actions"]).has(key));
    redacted[key] = sensitive ? "[REDACTED]" : redactAuditValue(item, operation);
  }
  return redacted;
}

function lowerHeaders(value: JsonValue | Uint8Array | undefined): Record<string, string> {
  if (!isJsonObject(value)) throw serviceError("REQUEST_PAYLOAD_INVALID", "headers must be an object");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === "string") result[key.toLowerCase()] = item;
  return result;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftHash = new Bun.CryptoHasher("sha256").update(left).digest();
  const rightHash = new Bun.CryptoHasher("sha256").update(right).digest();
  let difference = leftHash.byteLength ^ rightHash.byteLength;
  for (let index = 0; index < Math.max(leftHash.byteLength, rightHash.byteLength); index += 1) {
    difference |= (leftHash[index % leftHash.byteLength] ?? 0) ^ (rightHash[index % rightHash.byteLength] ?? 0);
  }
  return difference === 0;
}

function externalPrincipalId(credential: string): string {
  return `external_${new Bun.CryptoHasher("sha256").update(credential).digest("hex").slice(0, 24)}`;
}

function hmacReplayFingerprint(nonce: string, signature: string): string {
  return new Bun.CryptoHasher("sha256")
    .update("marcus:hmac-replay:v1\0")
    .update(nonce)
    .update("\0")
    .update(signature)
    .digest("hex");
}

function mediaTypeFor(path: string): string {
  const extension = path.toLowerCase().split(".").at(-1);
  return ({ html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", pdf: "application/pdf" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function mapProcess(row: ProcessRow): Record<string, JsonValue> {
  return {
    mpid: row.mpid,
    processType: row.process_type,
    state: row.state,
    health: row.health,
    startedAt: row.started_at,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
    ...(row.agent_version_id === null ? {} : { agentVersionId: row.agent_version_id }),
    ...(row.instance_id === null ? {} : { instanceId: row.instance_id }),
    ...(row.parent_mpid === null ? {} : { parentMpid: row.parent_mpid }),
    ...(row.os_pid === null ? {} : { osPid: row.os_pid }),
    ...(row.last_heartbeat_at === null ? {} : { lastHeartbeatAt: row.last_heartbeat_at }),
    ...(row.last_progress_at === null ? {} : { lastProgressAt: row.last_progress_at }),
    ...(row.exit_code === null ? {} : { exitCode: row.exit_code }),
    ...(row.signal === null ? {} : { signal: row.signal }),
  };
}

function mapConversation(row: ConversationRow): Record<string, JsonValue> {
  return {
    conversationId: row.conversation_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    scope: row.scope,
    nextSequence: row.next_sequence,
    metadata: JSON.parse(row.metadata_json) as JsonValue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.principal_id === null ? {} : { principalId: row.principal_id }),
    ...(row.chat_id === null ? {} : { chatId: row.chat_id }),
  };
}

function isTerminalRunState(state: RunRecord["state"]): boolean {
  return ["completed", "failed", "cancelled", "timed_out", "killed"].includes(state);
}

function internalEntrypoint(manifest: AgentManifest): "cli" | "message" | "event" | "api" | "schedule" | "adapter" {
  if (manifest.entrypoints.cli?.enabled === true) return "cli";
  if (manifest.entrypoints.messages?.enabled === true) return "message";
  if ((manifest.entrypoints.events?.length ?? 0) > 0) return "event";
  if (manifest.entrypoints.api?.enabled === true) return "api";
  if ((manifest.entrypoints.schedules?.length ?? 0) > 0) return "schedule";
  if ((manifest.entrypoints.adapters?.length ?? 0) > 0) return "adapter";
  throw serviceError("ENTRYPOINT_DISABLED", "Subagent has no enabled internal entrypoint");
}

function sanitizeRuntimePayload(value: unknown, key = ""): JsonValue {
  if (/password|token|secret|authorization|credential|signature/iu.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Uint8Array) return { binary: true, size: value.byteLength };
  if (Array.isArray(value)) return value.map((item) => sanitizeRuntimePayload(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeRuntimePayload(item, name)]));
  return String(value);
}

function publicManifest(manifest: AgentManifest): AgentManifest {
  const authentication = manifest.entrypoints.api?.authentication;
  const safeAuthentication = authentication?.type === "bearer-secret" || authentication?.type === "hmac"
    ? { ...authentication, secret: "[SECRET_REF]" }
    : authentication;
  return {
    ...manifest,
    entrypoints: {
      ...manifest.entrypoints,
      ...(manifest.entrypoints.api === undefined
        ? {}
        : { api: { ...manifest.entrypoints.api, authentication: safeAuthentication! } }),
    },
  };
}

function exampleFromInputSchema(schema: SerializedSchema, property = ""): JsonValue {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (schema.enum?.[0] !== undefined) return structuredClone(schema.enum[0]);
  if (schema.anyOf?.[0] !== undefined) return exampleFromInputSchema(schema.anyOf[0], property);
  if (schema.type === "object") {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, exampleFromInputSchema(child, key)]));
  }
  if (schema.type === "array") {
    const count = Math.max(1, schema.minItems ?? 0);
    return Array.from({ length: count }, () => schema.items === undefined ? null : exampleFromInputSchema(schema.items, property));
  }
  if (schema.type === "number" || schema.type === "integer") {
    const minimum = schema.minimum ?? 0;
    return schema.type === "integer" ? Math.ceil(minimum) : minimum;
  }
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  return boundedExampleString(exampleString(property, schema.format), schema.minLength, schema.maxLength);
}

function completeSchemaForExample(schema: SerializedSchema, property = ""): SerializedSchema {
  if (schema.anyOf !== undefined) return { ...schema, anyOf: schema.anyOf.map((branch) => completeSchemaForExample(branch, property)) };
  if (schema.type === "array") return { ...schema, ...(schema.items === undefined ? {} : { items: completeSchemaForExample(schema.items, property) }) };
  if (schema.type !== "object") return { ...schema };
  const properties = schema.properties ?? {};
  const keys = new Set([...Object.keys(properties), ...(schema.required ?? [])]);
  return {
    ...schema,
    properties: Object.fromEntries([...keys].map((key) => [key, completeSchemaForExample(properties[key] ?? inferredExampleSchema(key), key)])),
  };
}

function inferredExampleSchema(property: string): SerializedSchema {
  if (/ingredients|ingredientes|items|pasos|steps|messages|mensajes/iu.test(property)) {
    return { type: "array", items: { type: "string" }, minItems: 1 };
  }
  if (/enabled|activo|active|habilitado/iu.test(property)) return { type: "boolean" };
  if (/count|cantidad|total|calorias|calories|minutes|minutos/iu.test(property)) return { type: "number", minimum: 0 };
  return { type: "string" };
}

function completeInputExample(schema: SerializedSchema, generated: JsonValue, property = ""): JsonValue {
  if (schema.anyOf?.[0] !== undefined) return completeInputExample(schema.anyOf[0], generated, property);
  if (schema.type === "object" && isJsonObject(generated)) {
    const declared = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [
      key,
      generated[key] === undefined ? exampleFromInputSchema(child, key) : completeInputExample(child, generated[key], key),
    ]));
    return { ...generated, ...declared };
  }
  if (schema.type === "array" && Array.isArray(generated) && schema.items !== undefined) {
    return generated.map((value) => completeInputExample(schema.items!, value, property));
  }
  return generated;
}

function exampleString(property: string, format: string | undefined): string {
  if (format === "email" || /email|correo/iu.test(property)) return "usuario@example.com";
  if (format === "date-time") return "2026-08-14T12:00:00Z";
  if (format === "date" || /fecha|date/iu.test(property)) return "2026-08-14";
  if (format === "uri" || format === "url" || /url|uri/iu.test(property)) return "https://example.com/recurso";
  if (/caso|case/iu.test(property)) return "El cliente no puede ingresar a su cuenta desde ayer.";
  if (/mensaje|message|prompt|query|consulta|text/iu.test(property)) return "Necesito ayuda con mi cuenta.";
  if (/nombre|name/iu.test(property)) return "Ejemplo";
  if (/(?:^|_)id$/iu.test(property)) return "example-id";
  return "valor de ejemplo";
}

function boundedExampleString(value: string, minimum = 0, maximum = Number.POSITIVE_INFINITY): string {
  const padded = value.length >= minimum ? value : value.padEnd(minimum, "x");
  return padded.slice(0, maximum);
}
