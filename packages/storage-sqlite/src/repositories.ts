import type { Database } from "bun:sqlite";
import {
  MarcusError,
  createId,
  type AgentDefinitionRecord,
  type AgentManifest,
  type AgentVersionRecord,
  type JsonValue,
  type KernelEvent,
  type RunRecord,
} from "@marcus/contracts";
import type { MarcusSqliteDatabase } from "./database";

export interface ProjectRecord {
  projectId: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHomeRecord {
  projectId: string;
  mode: "managed" | "linked";
  physicalPath: string;
  status: "active" | "missing" | "unavailable";
  createdAt: string;
  verifiedAt?: string;
}

export interface DeletedProjectRecord {
  project: ProjectRecord;
  home?: ProjectHomeRecord;
  deletedRows: number;
}

export interface RegisterAgentVersionInput {
  record: AgentVersionRecord;
  manifest: AgentManifest;
  artifactUri: string;
  buildMetadata?: JsonValue;
}

export interface CreateRunInput extends RunRecord {
  input: JsonValue;
}

export interface AppendKernelEventInput {
  eventId?: string;
  eventType: string;
  nodeId: string;
  projectId?: string;
  agentId?: string;
  runId?: string;
  mpid?: string;
  actor?: JsonValue;
  correlationId: string;
  causationId?: string;
  traceId: string;
  occurredAt?: string;
  payload: JsonValue;
}

export interface MarcusRepositoriesOptions {
  onKernelEvent?(event: KernelEvent): void;
}

export interface ConversationKey {
  projectId: string;
  agentId: string;
  scope: "principal+chat" | "chat-only" | "principal-only";
  principalId?: string;
  chatId?: string;
}

type ProjectRow = {
  project_id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type AgentDefinitionRow = {
  agent_id: string;
  project_id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: AgentDefinitionRecord["kind"];
  status: AgentDefinitionRecord["status"];
  active_version_id: string | null;
  source_path: string | null;
  source_state: NonNullable<AgentDefinitionRecord["sourceState"]> | null;
  created_at: string;
  updated_at: string;
};

type AgentVersionRow = {
  agent_version_id: string;
  agent_id: string;
  version_label: string | null;
  source_kind: AgentVersionRecord["sourceKind"];
  source_hash: string;
  manifest_hash: string;
  artifact_hash: string;
  manifest_schema_version: "marcus.agent/v1";
  sdk_version: string | null;
  status: AgentVersionRecord["status"];
  created_at: string;
  activated_at: string | null;
};

type RunRow = {
  run_id: string;
  project_id: string;
  agent_id: string;
  agent_version_id: string;
  instance_id: string | null;
  entrypoint: RunRecord["entrypoint"];
  state: RunRecord["state"];
  result: RunRecord["result"];
  principal_id: string | null;
  conversation_id: string | null;
  idempotency_key: string | null;
  input_hash: string;
  output_json: string | null;
  error_json: string | null;
  trace_id: string;
  correlation_id: string;
  causation_id: string | null;
  accepted_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export class MarcusRepositories {
  private readonly sql: Database;

  constructor(database: MarcusSqliteDatabase, private readonly options: MarcusRepositoriesOptions = {}) {
    this.sql = database.raw;
  }

  createProject(input: { slug: string; name: string; projectId?: string; now?: string }): ProjectRecord {
    const projectId = input.projectId ?? createId("project");
    const now = input.now ?? new Date().toISOString();
    this.sql
      .query("INSERT INTO projects(project_id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(projectId, input.slug, input.name, now, now);
    return { projectId, slug: input.slug, name: input.name, status: "active", createdAt: now, updatedAt: now };
  }

  getProject(reference: string): ProjectRecord | undefined {
    const row = this.sql
      .query<ProjectRow, [string, string]>(
        "SELECT project_id, slug, name, status, created_at, updated_at FROM projects WHERE project_id = ? OR slug = ?",
      )
      .get(reference, reference);
    return row === null ? undefined : mapProject(row);
  }

  listProjects(): ProjectRecord[] {
    return this.sql
      .query<ProjectRow, []>("SELECT project_id, slug, name, status, created_at, updated_at FROM projects ORDER BY slug")
      .all()
      .map(mapProject);
  }

  registerProjectHome(input: ProjectHomeRecord): void {
    this.sql.query(`INSERT INTO project_homes(project_id, mode, physical_path, status, created_at, verified_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(project_id) DO UPDATE SET mode=excluded.mode, physical_path=excluded.physical_path, status=excluded.status, verified_at=excluded.verified_at`)
      .run(input.projectId, input.mode, input.physicalPath, input.status, input.createdAt, input.verifiedAt ?? null);
  }

  getProjectHome(projectId: string): ProjectHomeRecord | undefined {
    const row = this.sql.query<{ project_id: string; mode: "managed" | "linked"; physical_path: string; status: "active" | "missing" | "unavailable"; created_at: string; verified_at: string | null }, [string]>(
      "SELECT project_id, mode, physical_path, status, created_at, verified_at FROM project_homes WHERE project_id = ?",
    ).get(projectId);
    return row === null ? undefined : {
      projectId: row.project_id,
      mode: row.mode,
      physicalPath: row.physical_path,
      status: row.status,
      createdAt: row.created_at,
      ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
    };
  }

  deleteProject(reference: string): DeletedProjectRecord {
    const project = this.getProject(reference);
    if (project === undefined) {
      throw new MarcusError({ code: "PROJECT_NOT_FOUND", message: `Project ${reference} not found`, retryable: false });
    }
    const home = this.getProjectHome(project.projectId);
    let deletedRows = 0;
    let agentIdsForRateLimitState: string[] = [];
    this.sql.transaction(() => {
      const projectId = project.projectId;
      const runIds = "SELECT run_id FROM runs WHERE project_id = ?";
      const agentIds = "SELECT agent_id FROM agent_definitions WHERE project_id = ?";
      const versionIds = `SELECT agent_version_id FROM agent_versions WHERE agent_id IN (${agentIds})`;
      const conversationIds = "SELECT conversation_id FROM conversations WHERE project_id = ?";
      const messageIds = "SELECT message_id FROM messages WHERE project_id = ?";
      const taskIds = `SELECT task_id FROM tasks WHERE run_id IN (${runIds})`;
      const validatorIds = "SELECT validator_id FROM auth_validators WHERE project_id = ?";
      const fileIds = "SELECT file_id FROM project_files WHERE project_id = ?";
      agentIdsForRateLimitState = this.sql.query<{ agent_id: string }, [string]>(`SELECT agent_id FROM agent_definitions WHERE project_id = ?`)
        .all(projectId)
        .map((row) => row.agent_id);

      // Immutable versions may only be removed by this complete Project deletion transaction.
      this.sql.run("DROP TRIGGER agent_versions_no_delete");
      this.sql.run("DROP TRIGGER auth_validator_versions_no_delete");

      deletedRows += this.sql.query(`DELETE FROM message_deliveries WHERE message_id IN (${messageIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM dead_letters WHERE message_id IN (${messageIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM steps WHERE task_id IN (${taskIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM tool_calls WHERE run_id IN (${runIds}) OR task_id IN (${taskIds})`).run(projectId, projectId).changes;
      deletedRows += this.sql.query("DELETE FROM artifacts WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM conversation_messages WHERE conversation_id IN (${conversationIds}) OR run_id IN (${runIds})`).run(projectId, projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM checkpoints WHERE run_id IN (${runIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM concurrency_leases WHERE run_id IN (${runIds})`).run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM execution_edges WHERE graph_id IN (SELECT graph_id FROM execution_graphs WHERE project_id = ?)").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM kernel_events WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM audit_events WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM approval_requests WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM messages WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM schedule_firings WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM execution_graphs WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM tasks WHERE run_id IN (${runIds})`).run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM runs WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM conversations WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM processes WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM agent_entrypoints WHERE agent_version_id IN (${versionIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM agent_instances WHERE agent_id IN (${agentIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM agent_versions WHERE agent_id IN (${agentIds})`).run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM auth_validator_versions WHERE validator_id IN (${validatorIds})`).run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM auth_validators WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM agent_definitions WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM mailboxes WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query(`DELETE FROM file_revisions WHERE file_id IN (${fileIds})`).run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM project_files WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM trash_entries WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM uploads WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM sync_sessions WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM hmac_replay_entries WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM access_tokens WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM secrets WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM project_memberships WHERE project_id = ?").run(projectId).changes;
      const scopedIds = [projectId, ...agentIdsForRateLimitState];
      for (const scopeId of scopedIds) {
        deletedRows += this.sql.query("DELETE FROM rate_limit_counters WHERE rule_id IN (SELECT rule_id FROM rate_limit_rules WHERE scope_id = ?)").run(scopeId).changes;
        deletedRows += this.sql.query("DELETE FROM rate_limit_rules WHERE scope_id = ?").run(scopeId).changes;
        deletedRows += this.sql.query("DELETE FROM budget_usage WHERE budget_id IN (SELECT budget_id FROM budgets WHERE scope_id = ?)").run(scopeId).changes;
        deletedRows += this.sql.query("DELETE FROM budgets WHERE scope_id = ?").run(scopeId).changes;
      }
      deletedRows += this.sql.query("DELETE FROM rate_limit_state WHERE instr(state_key, ?) > 0").run(projectId).changes;
      for (const agentId of agentIdsForRateLimitState) {
        deletedRows += this.sql.query("DELETE FROM rate_limit_state WHERE instr(state_key, ?) > 0").run(agentId).changes;
      }
      deletedRows += this.sql.query("DELETE FROM project_homes WHERE project_id = ?").run(projectId).changes;
      deletedRows += this.sql.query("DELETE FROM projects WHERE project_id = ?").run(projectId).changes;

      this.sql.run(AGENT_VERSION_DELETE_TRIGGER);
      this.sql.run(AUTH_VALIDATOR_VERSION_DELETE_TRIGGER);
    })();
    return { project, ...(home === undefined ? {} : { home }), deletedRows };
  }

  createAgentDefinition(record: AgentDefinitionRecord): void {
    this.sql
      .query(`
        INSERT INTO agent_definitions(
          agent_id, project_id, slug, name, description, kind, status,
          active_version_id, source_path, source_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.agentId,
        record.projectId,
        record.slug,
        record.name,
        record.description ?? null,
        record.kind,
        record.status,
        record.activeVersionId ?? null,
        record.sourcePath ?? null,
        record.sourceState ?? null,
        record.createdAt,
        record.updatedAt,
      );
  }

  getAgentDefinition(agentId: string): AgentDefinitionRecord | undefined {
    const row = this.sql.query<AgentDefinitionRow, [string]>("SELECT * FROM agent_definitions WHERE agent_id = ?").get(agentId);
    return row === null ? undefined : mapAgentDefinition(row);
  }

  getAgentBySlug(projectId: string, slug: string): AgentDefinitionRecord | undefined {
    const row = this.sql
      .query<AgentDefinitionRow, [string, string]>("SELECT * FROM agent_definitions WHERE project_id = ? AND slug = ?")
      .get(projectId, slug);
    return row === null ? undefined : mapAgentDefinition(row);
  }

  listAgentDefinitions(projectId?: string): AgentDefinitionRecord[] {
    const rows = projectId === undefined
      ? this.sql.query<AgentDefinitionRow, []>("SELECT * FROM agent_definitions ORDER BY project_id, slug").all()
      : this.sql.query<AgentDefinitionRow, [string]>("SELECT * FROM agent_definitions WHERE project_id = ? ORDER BY slug").all(projectId);
    return rows.map(mapAgentDefinition);
  }

  registerAgentVersion(input: RegisterAgentVersionInput): void {
    const { record } = input;
    this.sql
      .query(`
        INSERT INTO agent_versions(
          agent_version_id, agent_id, version_label, source_kind, source_hash,
          manifest_hash, artifact_hash, manifest_schema_version, sdk_version,
          status, manifest_json, artifact_uri, build_metadata_json, created_at, activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.agentVersionId,
        record.agentId,
        record.versionLabel ?? null,
        record.sourceKind,
        record.sourceHash,
        record.manifestHash,
        record.artifactHash,
        record.manifestSchemaVersion,
        record.sdkVersion ?? null,
        record.status,
        JSON.stringify(input.manifest),
        input.artifactUri,
        JSON.stringify(input.buildMetadata ?? {}),
        record.createdAt,
        record.activatedAt ?? null,
      );
  }

  activateAgentVersion(agentId: string, versionId: string, now = new Date().toISOString()): void {
    this.sql.transaction(() => {
      const version = this.sql
        .query<{ agent_id: string; status: string }, [string]>(
          "SELECT agent_id, status FROM agent_versions WHERE agent_version_id = ?",
        )
        .get(versionId);
      if (version === null || version.agent_id !== agentId) {
        throw new MarcusError({ code: "AGENT_VERSION_NOT_FOUND", message: "Agent version not found", retryable: false });
      }
      if (version.status === "invalid" || version.status === "building") {
        throw new MarcusError({
          code: "AGENT_VERSION_NOT_ACTIVATABLE",
          message: `Agent version in state ${version.status} cannot be activated`,
          retryable: false,
        });
      }
      this.sql.query("UPDATE agent_versions SET status = 'superseded' WHERE agent_id = ? AND status = 'active'").run(agentId);
      this.sql
        .query("UPDATE agent_versions SET status = 'active', activated_at = ? WHERE agent_version_id = ?")
        .run(now, versionId);
      const changed = this.sql
        .query("UPDATE agent_definitions SET active_version_id = ?, status = 'active', updated_at = ? WHERE agent_id = ?")
        .run(versionId, now, agentId);
      if (changed.changes !== 1) {
        throw new MarcusError({ code: "AGENT_NOT_FOUND", message: "Agent definition not found", retryable: false });
      }
    })();
  }

  getAgentVersion(versionId: string): AgentVersionRecord | undefined {
    const row = this.sql.query<AgentVersionRow, [string]>("SELECT * FROM agent_versions WHERE agent_version_id = ?").get(versionId);
    return row === null ? undefined : mapAgentVersion(row);
  }

  listAgentVersions(agentId: string): AgentVersionRecord[] {
    return this.sql
      .query<AgentVersionRow, [string]>("SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY created_at DESC")
      .all(agentId)
      .map(mapAgentVersion);
  }

  getAgentArtifactUri(versionId: string): string | undefined {
    return this.sql
      .query<{ artifact_uri: string }, [string]>("SELECT artifact_uri FROM agent_versions WHERE agent_version_id = ?")
      .get(versionId)?.artifact_uri;
  }

  getAgentManifest(versionId: string): AgentManifest | undefined {
    const row = this.sql
      .query<{ manifest_json: string }, [string]>("SELECT manifest_json FROM agent_versions WHERE agent_version_id = ?")
      .get(versionId);
    return row === null ? undefined : (JSON.parse(row.manifest_json) as AgentManifest);
  }

  createRun(input: CreateRunInput): void {
    this.sql
      .query(`
        INSERT INTO runs(
          run_id, project_id, agent_id, agent_version_id, instance_id, entrypoint,
          state, result, principal_id, conversation_id, idempotency_key, input_hash,
          input_json, output_json, error_json, trace_id, correlation_id, causation_id,
          accepted_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.runId,
        input.projectId,
        input.agentId,
        input.agentVersionId,
        input.instanceId ?? null,
        input.entrypoint,
        input.state,
        input.result,
        input.principalId ?? null,
        input.conversationId ?? null,
        input.idempotencyKey ?? null,
        input.inputHash,
        JSON.stringify(input.input),
        input.output === undefined ? null : JSON.stringify(input.output),
        input.error === undefined ? null : JSON.stringify(input.error),
        input.traceId,
        input.correlationId,
        input.causationId ?? null,
        input.acceptedAt,
        input.startedAt ?? null,
        input.finishedAt ?? null,
      );
  }

  getRun(runId: string): RunRecord | undefined {
    const row = this.sql.query<RunRow, [string]>("SELECT * FROM runs WHERE run_id = ?").get(runId);
    return row === null ? undefined : mapRun(row);
  }

  getRunInput(runId: string): JsonValue | undefined {
    const row = this.sql.query<{ input_json: string }, [string]>("SELECT input_json FROM runs WHERE run_id = ?").get(runId);
    return row === null ? undefined : (JSON.parse(row.input_json) as JsonValue);
  }

  listRuns(projectId?: string, limit = 100): RunRecord[] {
    const bounded = Math.max(1, Math.min(limit, 1_000));
    const rows = projectId === undefined
      ? this.sql.query<RunRow, [number]>("SELECT * FROM runs ORDER BY accepted_at DESC LIMIT ?").all(bounded)
      : this.sql.query<RunRow, [string, number]>("SELECT * FROM runs WHERE project_id = ? ORDER BY accepted_at DESC LIMIT ?").all(projectId, bounded);
    return rows.map(mapRun);
  }

  findIdempotentRun(input: {
    projectId: string;
    agentId: string;
    principalId?: string;
    idempotencyKey: string;
  }): RunRecord | undefined {
    const row = this.sql
      .query<RunRow, [string, string, string | null, string]>(`
        SELECT * FROM runs
        WHERE project_id = ? AND agent_id = ? AND principal_id IS ? AND idempotency_key = ?
      `)
      .get(input.projectId, input.agentId, input.principalId ?? null, input.idempotencyKey);
    return row === null ? undefined : mapRun(row);
  }

  transitionRun(
    runId: string,
    expected: readonly RunRecord["state"][],
    next: RunRecord["state"],
    update: { result?: RunRecord["result"]; output?: JsonValue; error?: RunRecord["error"]; now?: string } = {},
  ): RunRecord {
    const now = update.now ?? new Date().toISOString();
    const placeholders = expected.map(() => "?").join(", ");
    const terminal = ["completed", "failed", "cancelled", "timed_out", "killed"].includes(next);
    const starting = next === "running";
    const result = this.sql
      .query(`
        UPDATE runs SET
          state = ?,
          result = COALESCE(?, result),
          output_json = COALESCE(?, output_json),
          error_json = COALESCE(?, error_json),
          started_at = CASE WHEN ? THEN COALESCE(started_at, ?) ELSE started_at END,
          finished_at = CASE WHEN ? THEN ? ELSE finished_at END
        WHERE run_id = ? AND state IN (${placeholders})
      `)
      .run(
        next,
        update.result ?? null,
        update.output === undefined ? null : JSON.stringify(update.output),
        update.error === undefined ? null : JSON.stringify(update.error),
        starting ? 1 : 0,
        now,
        terminal ? 1 : 0,
        now,
        runId,
        ...expected,
      );
    if (result.changes !== 1) {
      throw new MarcusError({
        code: "RUN_STATE_CONFLICT",
        message: `Run ${runId} is not in expected state ${expected.join("/")}`,
        retryable: false,
      });
    }
    return this.getRun(runId)!;
  }

  resolveConversation(key: ConversationKey, now = new Date().toISOString()): string {
    validateConversationKey(key);
    const existing = this.sql
      .query<{ conversation_id: string }, [string, string, string, string | null, string | null]>(`
        SELECT conversation_id FROM conversations
        WHERE project_id = ? AND agent_id = ? AND scope = ?
          AND principal_id IS ? AND chat_id IS ?
      `)
      .get(key.projectId, key.agentId, key.scope, key.principalId ?? null, key.chatId ?? null);
    if (existing !== null) return existing.conversation_id;
    const conversationId = createId("conversation");
    this.sql
      .query(`
        INSERT INTO conversations(
          conversation_id, project_id, agent_id, principal_id, chat_id, scope,
          next_sequence, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, '{}', ?, ?)
      `)
      .run(
        conversationId,
        key.projectId,
        key.agentId,
        key.principalId ?? null,
        key.chatId ?? null,
        key.scope,
        now,
        now,
      );
    return conversationId;
  }

  appendConversationMessage(input: {
    conversationId: string;
    role: "system" | "user" | "assistant" | "tool" | "event";
    content: JsonValue;
    runId?: string;
    agentVersionId?: string;
    metadata?: JsonValue;
    now?: string;
  }): { conversationMessageId: string; sequence: number } {
    return this.sql.transaction(() => {
      const row = this.sql
        .query<{ next_sequence: number }, [string]>("SELECT next_sequence FROM conversations WHERE conversation_id = ?")
        .get(input.conversationId);
      if (row === null) {
        throw new MarcusError({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found", retryable: false });
      }
      const id = createId("message");
      const now = input.now ?? new Date().toISOString();
      this.sql
        .query(`
          INSERT INTO conversation_messages(
            conversation_message_id, conversation_id, sequence, role, content_json,
            run_id, agent_version_id, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.conversationId,
          row.next_sequence,
          input.role,
          JSON.stringify(input.content),
          input.runId ?? null,
          input.agentVersionId ?? null,
          JSON.stringify(input.metadata ?? {}),
          now,
        );
      this.sql
        .query("UPDATE conversations SET next_sequence = next_sequence + 1, updated_at = ? WHERE conversation_id = ?")
        .run(now, input.conversationId);
      return { conversationMessageId: id, sequence: row.next_sequence };
    })();
  }

  appendKernelEvent(input: AppendKernelEventInput): KernelEvent {
    const eventId = input.eventId ?? createId("event");
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const result = this.sql
      .query(`
        INSERT INTO kernel_events(
          event_id, event_type, node_id, project_id, agent_id, run_id, mpid,
          actor_json, correlation_id, causation_id, trace_id, occurred_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        eventId,
        input.eventType,
        input.nodeId,
        input.projectId ?? null,
        input.agentId ?? null,
        input.runId ?? null,
        input.mpid ?? null,
        input.actor === undefined ? null : JSON.stringify(input.actor),
        input.correlationId,
        input.causationId ?? null,
        input.traceId,
        occurredAt,
        JSON.stringify(input.payload),
      );
    const event: KernelEvent = {
      eventId,
      eventSeq: Number(result.lastInsertRowid),
      eventType: input.eventType,
      nodeId: input.nodeId,
      correlationId: input.correlationId,
      traceId: input.traceId,
      occurredAt,
      payload: input.payload,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      ...(input.mpid === undefined ? {} : { mpid: input.mpid }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    };
    this.options.onKernelEvent?.(event);
    return event;
  }
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentDefinition(row: AgentDefinitionRow): AgentDefinitionRecord {
  return {
    agentId: row.agent_id,
    projectId: row.project_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.active_version_id === null ? {} : { activeVersionId: row.active_version_id }),
    ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
    ...(row.source_state === null ? {} : { sourceState: row.source_state }),
  };
}

function mapAgentVersion(row: AgentVersionRow): AgentVersionRecord {
  return {
    agentVersionId: row.agent_version_id,
    agentId: row.agent_id,
    sourceKind: row.source_kind,
    sourceHash: row.source_hash,
    manifestHash: row.manifest_hash,
    artifactHash: row.artifact_hash,
    manifestSchemaVersion: row.manifest_schema_version,
    status: row.status,
    createdAt: row.created_at,
    ...(row.version_label === null ? {} : { versionLabel: row.version_label }),
    ...(row.sdk_version === null ? {} : { sdkVersion: row.sdk_version }),
    ...(row.activated_at === null ? {} : { activatedAt: row.activated_at }),
  };
}

function mapRun(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    entrypoint: row.entrypoint,
    state: row.state,
    result: row.result,
    inputHash: row.input_hash,
    traceId: row.trace_id,
    correlationId: row.correlation_id,
    acceptedAt: row.accepted_at,
    ...(row.instance_id === null ? {} : { instanceId: row.instance_id }),
    ...(row.principal_id === null ? {} : { principalId: row.principal_id }),
    ...(row.conversation_id === null ? {} : { conversationId: row.conversation_id }),
    ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
    ...(row.output_json === null ? {} : { output: JSON.parse(row.output_json) as JsonValue }),
    ...(row.error_json === null ? {} : { error: JSON.parse(row.error_json) as NonNullable<RunRecord["error"]> }),
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  };
}

function validateConversationKey(key: ConversationKey): void {
  if (key.scope === "principal+chat" && (key.principalId === undefined || key.chatId === undefined)) {
    throw new MarcusError({
      code: "CONVERSATION_KEY_INVALID",
      message: "principal+chat scope requires principalId and chatId",
      retryable: false,
    });
  }
  if (key.scope === "chat-only" && key.chatId === undefined) {
    throw new MarcusError({ code: "CONVERSATION_KEY_INVALID", message: "chat-only scope requires chatId", retryable: false });
  }
  if (key.scope === "principal-only" && key.principalId === undefined) {
    throw new MarcusError({
      code: "CONVERSATION_KEY_INVALID",
      message: "principal-only scope requires principalId",
      retryable: false,
    });
  }
}

const AGENT_VERSION_DELETE_TRIGGER = `CREATE TRIGGER agent_versions_no_delete
BEFORE DELETE ON agent_versions
BEGIN
  SELECT RAISE(ABORT, 'AGENT_VERSION_IMMUTABLE');
END`;

const AUTH_VALIDATOR_VERSION_DELETE_TRIGGER = `CREATE TRIGGER auth_validator_versions_no_delete
BEFORE DELETE ON auth_validator_versions
BEGIN
  SELECT RAISE(ABORT, 'AUTH_VALIDATOR_VERSION_IMMUTABLE');
END`;
