export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type MarcusErrorBody = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type ApiEnvelope<T> =
  | { ok: true; data: T; meta?: { requestId?: string; timestamp?: string } }
  | { ok: false; error: MarcusErrorBody };

export type SessionStatus = {
  authenticated: boolean;
  csrf?: string;
  principal?: {
    id: string;
    username?: string;
    roles: string[];
  };
};

export type User = {
  userId: string;
  username: string;
  status: "active" | "disabled";
  roles: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectMember = {
  userId: string;
  username: string;
  status: "active" | "disabled";
  role: "project_owner" | "project_operator" | "project_developer" | "project_viewer";
  systemAdmin: boolean;
  createdAt: string;
};

export type Project = {
  projectId: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type ProjectDashboard = {
  files: number;
  agents: number;
  activeAgents: number;
  apiAgents: number;
  runs: number;
  consumption: Array<{ day: string; runs: number; completed: number; failed: number }>;
};

export type SystemOverview = {
  health: { status: string; database: string; schedulerReady: boolean; activeRuns: number; residentInstances: number; nodeId: string; realtime?: { activeConnections: number; publishedEvents: number; deliveredEvents: number } };
  totals: { projects: number; files: number; agents: number; activeAgents: number; runs24h: number; failed24h: number; pendingApprovals: number; activeProcesses: number };
  providers?: { total: number; healthy: number };
  trend: Array<{ day: string; runs: number; failed: number }>;
  recentRuns: Array<{ runId: string; projectId: string; agentId: string; agentName: string; agentSlug: string; state: Run["state"]; result: Run["result"]; entrypoint: string; acceptedAt: string; finishedAt?: string }>;
  sampledAt: string;
};

export type SystemLogEntry = {
  timestamp?: string;
  level?: string;
  source?: string;
  message?: string;
  [key: string]: Json | undefined;
};

export type SystemLogs = { entries: SystemLogEntry[]; truncated?: boolean; sampledAt: string };

export type SearchResult = {
  kind: "project" | "agent" | "run" | "file" | "documentation";
  projectId?: string;
  agent?: string;
  runId?: string;
  path?: string;
  line?: number;
  title: string;
  detail: string;
};

export type SystemSearch = { query: string; results: SearchResult[]; sampledAt: string };

export type ProjectAccessToken = {
  tokenId: string;
  label: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
};

export type CreatedProjectAccessToken = {
  tokenId: string;
  token: string;
  projectId: string;
  label: string;
  scopes: string[];
  expiresAt?: string;
};

export type McpAccessToken = {
  tokenId: string;
  userId: string;
  label: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
};

export type CreatedMcpAccessToken = {
  tokenId: string;
  token: string;
  label: string;
  scopes: string[];
  expiresAt?: string;
};

export type DeletedProject = {
  projectId: string;
  slug: string;
  deleted: true;
  deletedRows: number;
  projectHome: "managed" | "linked" | "missing";
  homeDeleted: boolean;
};

export type Provider = {
  providerId: string;
  name: string;
  type: string;
  catalogId?: "openai" | "deepseek";
  baseUrl?: string;
  secretRefs: string[];
  status: "unverified" | "healthy" | "degraded" | "unavailable";
  capabilities: Record<string, Json>;
  createdAt: string;
  updatedAt: string;
};

export type ProviderCatalogEntry = {
  id: "openai" | "deepseek";
  name: string;
  type: "openai-compatible";
  baseUrl: string;
  description: string;
  defaultModel?: string;
  modelExamples: string[];
  capabilities: Record<string, Json>;
};

export type ModelRole = {
  role: string;
  providerId: string;
  model: string;
  configuration: Record<string, Json>;
  updatedAt: string;
};

export type DefaultLlmConfiguration =
  | { configured: false }
  | { configured: true; provider: Provider; role: ModelRole; probe?: { healthy: boolean; models: string[]; latencyMs: number } };

export type Run = {
  runId: string;
  projectId: string;
  agentId: string;
  agentVersionId: string;
  instanceId?: string;
  entrypoint: string;
  state: "accepted" | "queued" | "starting" | "running" | "waiting_for_input" | "waiting_for_approval" | "waiting_for_child" | "cancelling" | "completed" | "failed" | "cancelled" | "timed_out" | "killed";
  result: "none" | "success" | "failure" | "cancelled" | "timeout" | "killed";
  traceId: string;
  correlationId: string;
  acceptedAt: string;
  startedAt?: string;
  finishedAt?: string;
  output?: Json;
  error?: { code: string; message: string; retryable?: boolean };
};

export type ProjectFile = {
  fileId: string;
  projectId: string;
  relativePath: string;
  kind: "file" | "directory" | "symlink";
  size: number;
  mediaType?: string;
  revision: number;
  indexStatus: "pending" | "indexed" | "ignored" | "failed";
  updatedAt: string;
};

export type ProjectFileContent = {
  encoding: "base64";
  data: string;
  size: number;
};

export type AgentDefinition = {
  agentId: string;
  projectId: string;
  slug: string;
  name: string;
  description?: string;
  kind: "agent" | "prompt-task" | "assistant";
  status: "draft" | "active" | "disabled" | "archived" | "source-missing";
  activeVersionId?: string;
  sourcePath?: string;
  sourceState?: "clean" | "dirty" | "unregistered" | "source-missing" | "invalid";
  createdAt: string;
  updatedAt: string;
};

export type AgentVersion = {
  agentVersionId: string;
  agentId: string;
  sourceKind: "sdk" | "markdown";
  sourceHash: string;
  manifestHash: string;
  artifactHash: string;
  status: string;
  createdAt: string;
  activatedAt?: string;
};

export type CompiledAgentArtifact = {
  agentId: string;
  agentVersionId: string;
  sourceKind: "markdown";
  status: string;
  manifest: Json;
  generatedTypeScript?: string;
  runtimeJavaScript: string;
};

export type AgentContract = {
  entrypoints: {
    api?: {
      enabled: boolean;
      response: { mode: "sync" | "async" | "auto"; waitMs?: number };
      authentication: { type: string; public?: boolean };
    };
  };
  contract: { inputSchema: Json; outputSchema: Json };
};

export type AgentInputExample = {
  input: Json;
  source: "llm" | "schema";
  provider?: string;
  model?: string;
};

export type AgentPlan = {
  slug: string;
  name: string;
  summary: string;
  sourceKind: "markdown" | "sdk";
  architecture: string;
  inputs: string[];
  outputs: string[];
  tools: string[];
  files: string[];
  steps: string[];
  testCases: string[];
  risks: string[];
  provider: string;
  model: string;
  plannedAt: string;
};

export type RuntimeProcess = {
  mpid: string;
  processType: string;
  projectId?: string;
  agentId?: string;
  agentVersionId?: string;
  osPid?: number;
  state: string;
  health: string;
  startedAt: string;
  lastHeartbeatAt?: string;
  lastProgressAt?: string;
};

export type Approval = {
  approvalId: string;
  projectId: string;
  runId: string;
  action: string;
  prompt: string;
  status: string;
  requestedAt: string;
  resolvedAt?: string;
};

export type AgentSchedule = {
  agentId: string;
  agent: string;
  agentVersionId: string;
  id: string;
  cron: string;
  timezone: string;
  input?: Json;
};

export type GeneratedAgent = {
  agentId: string;
  agentVersionId: string;
  sourcePath: string;
  summary: string;
  activated: boolean;
  manifest: { identity: { id: string; name: string; description?: string; kind: string } };
};

export type AgentGenerationStage = "analyzing" | "generating" | "normalizing" | "validating" | "repairing" | "activating" | "completed" | "failed";

export type AgentGenerationProgress = {
  activityId: string;
  activityKind: "agent.generate" | "agent.plan" | "assistant.chat";
  progressId: string;
  projectId?: string;
  status: "running" | "completed" | "failed";
  stage: AgentGenerationStage;
  message: string;
  sequence: number;
  startedAt: string;
  updatedAt: string;
  events: Array<{
    sequence: number;
    timestamp: string;
    stage: AgentGenerationStage;
    kind: "analysis" | "provider" | "compiler" | "tool" | "result" | "error";
    title: string;
    message: string;
    operation: string;
    provider?: string;
    model?: string;
  }>;
  provider?: string;
  model?: string;
  error?: { code: string; message: string };
};

export type AgentActivity<T extends Json = Json> = AgentGenerationProgress & { result?: T };
export type AcceptedAgentActivity = { activityId: string; progressId?: string; status: "accepted" };

export type AssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantResponse = {
  conversationId: string;
  message: string;
  actions: Array<{ tool: string; arguments: Record<string, Json>; result: Json }>;
  provider: string;
  model: string;
  rounds: number;
};

export type UploadSession = {
  uploadId: string;
  fileName: string;
  destination?: string;
  expectedSize: number;
  receivedSize: number;
  status: string;
};
