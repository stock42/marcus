import { describe, expect, test } from "bun:test";
import { createId, type AgentDefinitionRecord, type AgentManifest, type AgentVersionRecord } from "@marcus/contracts";
import { MarcusRepositories, MarcusSqliteDatabase } from "./index";

function fixture() {
  const database = new MarcusSqliteDatabase(":memory:");
  const repositories = new MarcusRepositories(database);
  const project = repositories.createProject({ slug: "test-project", name: "Test Project", now: "2026-08-11T00:00:00Z" });
  const agent: AgentDefinitionRecord = {
    agentId: createId("agent"),
    projectId: project.projectId,
    slug: "hello",
    name: "Hello",
    kind: "agent",
    status: "draft",
    sourceState: "clean",
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
  };
  repositories.createAgentDefinition(agent);
  const manifest: AgentManifest = {
    schemaVersion: "marcus.agent/v1",
    identity: { id: "hello", name: "Hello", kind: "agent" },
    runtime: {
      profile: "worker",
      residency: "on-demand",
      startupTimeoutMs: 15_000,
      shutdownTimeoutMs: 10_000,
      heartbeatIntervalMs: 5_000,
      heartbeatTimeoutMs: 20_000,
    },
    contract: { inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    entrypoints: { cli: { enabled: true } },
    handlers: { onRun: "default:onRun" },
    build: { sourceKind: "sdk", sourceHash: "source", compilerVersion: "test" },
  };
  const version: AgentVersionRecord = {
    agentVersionId: createId("agentVersion"),
    agentId: agent.agentId,
    sourceKind: "sdk",
    sourceHash: "source",
    manifestHash: "manifest",
    artifactHash: "artifact",
    manifestSchemaVersion: "marcus.agent/v1",
    status: "valid",
    createdAt: "2026-08-11T00:00:00Z",
  };
  repositories.registerAgentVersion({ record: version, manifest, artifactUri: "file:///artifact" });
  return { database, repositories, project, agent, version };
}

describe("SQLite migrations and repositories", () => {
  test("creates the complete v1 schema and passes integrity check", () => {
    const database = new MarcusSqliteDatabase(":memory:");
    const tables = database.raw
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toContain("agent_versions");
    expect(tables).toContain("auth_validator_versions");
    expect(tables).toContain("hmac_replay_entries");
    expect(tables).toContain("kernel_events");
    expect(tables).toContain("project_files");
    expect(tables).toContain("rate_limit_counters");
    expect(tables.length).toBeGreaterThanOrEqual(40);
    const tokenColumns = database.raw.query<{ name: string }, []>("PRAGMA table_info(access_tokens)").all().map((column) => column.name);
    expect(tokenColumns).toContain("project_id");
    expect(tokenColumns).toContain("label");
    const toolCallColumns = database.raw.query<{ name: string }, []>("PRAGMA table_info(tool_calls)").all().map((column) => column.name);
    expect(toolCallColumns).toEqual(expect.arrayContaining([
      "agent_version_id",
      "tool_version",
      "risk",
      "side_effects",
      "idempotency_key",
      "approval_id",
      "cached_from_call_id",
    ]));
    expect(database.raw.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get("tool_calls_idempotency_idx")?.name)
      .toBe("tool_calls_idempotency_idx");
    expect(database.integrityCheck()).toEqual({ ok: true, messages: ["ok"] });
    database.close();
  });

  test("activates versions transactionally and protects immutable content", () => {
    const { database, repositories, agent, version } = fixture();
    repositories.activateAgentVersion(agent.agentId, version.agentVersionId, "2026-08-11T00:01:00Z");
    expect(repositories.getAgentDefinition(agent.agentId)?.activeVersionId).toBe(version.agentVersionId);
    expect(repositories.getAgentVersion(version.agentVersionId)?.status).toBe("active");
    expect(() =>
      database.raw.query("UPDATE agent_versions SET source_hash = 'changed' WHERE agent_version_id = ?").run(version.agentVersionId),
    ).toThrow("AGENT_VERSION_IMMUTABLE");
    database.close();
  });

  test("protects reusable auth validator version content", () => {
    const { database, project } = fixture();
    const validatorId = createId("authValidator");
    const validatorVersionId = createId("authValidatorVersion");
    database.raw.query("INSERT INTO auth_validators (validator_id, project_id, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(validatorId, project.projectId, "project-token", "2026-08-11T00:00:00Z", "2026-08-11T00:00:00Z");
    database.raw.query("INSERT INTO auth_validator_versions (validator_version_id, validator_id, source_hash, artifact_hash, artifact_uri, scheme, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(validatorVersionId, validatorId, "source", "artifact", "file:///validator.js", "Bearer", "active", "2026-08-11T00:00:00Z");
    expect(() => database.raw.query("UPDATE auth_validator_versions SET artifact_hash='changed' WHERE validator_version_id=?").run(validatorVersionId))
      .toThrow("AUTH_VALIDATOR_VERSION_IMMUTABLE");
    expect(() => database.raw.query("DELETE FROM auth_validator_versions WHERE validator_version_id=?").run(validatorVersionId))
      .toThrow("AUTH_VALIDATOR_VERSION_IMMUTABLE");
    database.close();
  });

  test("enforces one durable HMAC replay fingerprint per Project", () => {
    const { database, project } = fixture();
    database.raw.query("INSERT INTO hmac_replay_entries(project_id, replay_key_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(project.projectId, "fingerprint", 2_000, 1_000);
    expect(() => database.raw.query("INSERT INTO hmac_replay_entries(project_id, replay_key_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(project.projectId, "fingerprint", 3_000, 1_500)).toThrow();
    expect(database.raw.query<{ expires_at: number }, [string, string]>("SELECT expires_at FROM hmac_replay_entries WHERE project_id=? AND replay_key_hash=?")
      .get(project.projectId, "fingerprint")).toEqual({ expires_at: 2_000 });
    database.close();
  });

  test("deletes a Project and every dependent authoritative row", () => {
    const { database, repositories, project, agent, version } = fixture();
    const now = "2026-08-11T00:00:00Z";
    repositories.registerProjectHome({ projectId: project.projectId, mode: "managed", physicalPath: "/tmp/marcus-deleted-project", status: "active", createdAt: now });
    database.raw.query("INSERT INTO project_memberships(project_id, user_id, role, created_at) VALUES (?, ?, 'project_owner', ?)")
      .run(project.projectId, createUser(database, now), now);
    database.raw.query("INSERT INTO agent_entrypoints(entrypoint_id, agent_version_id, entrypoint_type, binding_key, manifest_json, enabled, created_at) VALUES (?, ?, 'cli', 'default', '{}', 1, ?)")
      .run("entrypoint-delete-test", version.agentVersionId, now);
    database.raw.query("INSERT INTO hmac_replay_entries(project_id, replay_key_hash, expires_at, created_at) VALUES (?, 'delete-test', 2000, 1000)")
      .run(project.projectId);
    database.raw.query("INSERT INTO access_tokens(token_id, token_hash, token_type, scopes_json, created_at, project_id, label) VALUES ('project-token-delete-test', 'hash-delete-test', 'personal-access-token', '[\"runs.invoke\"]', ?, ?, 'Delete test')")
      .run(now, project.projectId);
    database.raw.query("INSERT INTO project_files(file_id, project_id, relative_path, kind, size, revision, source, index_status, created_at, updated_at) VALUES (?, ?, 'agent.md', 'file', 10, 1, 'managed', 'indexed', ?, ?)")
      .run("file-delete-test", project.projectId, now, now);
    database.raw.query("INSERT INTO file_revisions(file_id, revision, size, source, created_at) VALUES ('file-delete-test', 1, 10, 'managed', ?)").run(now);
    database.raw.query("INSERT INTO secrets(secret_id, project_id, name, encrypted_value, key_version, status, created_at, updated_at) VALUES ('secret-delete-test', ?, 'provider.key', ?, 1, 'active', ?, ?)")
      .run(project.projectId, new Uint8Array([1, 2, 3]), now, now);
    repositories.appendKernelEvent({
      eventType: "project.delete-test",
      nodeId: "node-delete-test",
      projectId: project.projectId,
      agentId: agent.agentId,
      correlationId: "cor-delete-test",
      traceId: "trc-delete-test",
      payload: {},
    });
    database.raw.query("INSERT INTO rate_limit_rules(rule_id, scope_type, scope_id, name, algorithm, limit_value, window_ms, configuration_json, created_at) VALUES ('rule-delete-test', 'agent', ?, 'test', 'fixed-window', 10, 60000, '{}', ?)")
      .run(agent.agentId, now);
    database.raw.query("INSERT INTO rate_limit_counters(rule_id, counter_key, window_start_ms, value, updated_at_ms) VALUES ('rule-delete-test', 'test', 0, 1, 0)").run();
    database.raw.query("INSERT INTO budgets(budget_id, scope_type, scope_id, metric, limit_value, action, created_at) VALUES ('budget-delete-test', 'agent', ?, 'tokens', 1000, 'reject', ?)")
      .run(agent.agentId, now);
    database.raw.query("INSERT INTO budget_usage(budget_id, period_key, used_value, updated_at) VALUES ('budget-delete-test', 'all', 10, ?)").run(now);

    const deleted = repositories.deleteProject(project.projectId);

    expect(deleted.project).toEqual(project);
    expect(deleted.home?.mode).toBe("managed");
    expect(deleted.deletedRows).toBeGreaterThan(8);
    expect(repositories.getProject(project.projectId)).toBeUndefined();
    expect(repositories.getAgentDefinition(agent.agentId)).toBeUndefined();
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM project_files").get()?.value).toBe(0);
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM secrets").get()?.value).toBe(0);
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM hmac_replay_entries").get()?.value).toBe(0);
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM access_tokens WHERE project_id IS NOT NULL").get()?.value).toBe(0);
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM kernel_events").get()?.value).toBe(0);
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM rate_limit_rules").get()?.value).toBe(0);
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM budgets").get()?.value).toBe(0);
    expect(database.integrityCheck()).toEqual({ ok: true, messages: ["ok"] });
    expect(database.raw.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM sqlite_master WHERE type='trigger' AND name IN ('agent_versions_no_delete','auth_validator_versions_no_delete')").get()?.value).toBe(2);

    const replacement = repositories.createProject({ slug: project.slug, name: "Recreated", now });
    expect(replacement.slug).toBe(project.slug);
    database.close();
  });

  test("serializes conversation messages with monotonic sequence", () => {
    const { database, repositories, project, agent } = fixture();
    const conversationId = repositories.resolveConversation({
      projectId: project.projectId,
      agentId: agent.agentId,
      scope: "principal+chat",
      principalId: "user-1",
      chatId: "chat-1",
    });
    const first = repositories.appendConversationMessage({ conversationId, role: "user", content: "Hello" });
    const second = repositories.appendConversationMessage({ conversationId, role: "assistant", content: "Hi" });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(
      repositories.resolveConversation({
        projectId: project.projectId,
        agentId: agent.agentId,
        scope: "principal+chat",
        principalId: "user-1",
        chatId: "chat-1",
      }),
    ).toBe(conversationId);
    database.close();
  });

  test("appends events with a durable global sequence", () => {
    const { database, repositories, project } = fixture();
    const first = repositories.appendKernelEvent({
      eventType: "project.created",
      nodeId: "node-1",
      projectId: project.projectId,
      correlationId: "cor-1",
      traceId: "trc-1",
      payload: {},
    });
    const second = repositories.appendKernelEvent({
      eventType: "project.updated",
      nodeId: "node-1",
      projectId: project.projectId,
      correlationId: "cor-1",
      causationId: first.eventId,
      traceId: "trc-1",
      payload: {},
    });
    expect(second.eventSeq).toBe(first.eventSeq + 1);
    database.close();
  });

  test("notifies realtime observers only after a kernel event is durable", () => {
    const database = new MarcusSqliteDatabase(":memory:");
    const observed: Array<{ eventId: string; eventSeq: number }> = [];
    const repositories = new MarcusRepositories(database, {
      onKernelEvent: (event) => observed.push({ eventId: event.eventId, eventSeq: event.eventSeq }),
    });
    const project = repositories.createProject({ slug: "realtime", name: "Realtime" });
    const event = repositories.appendKernelEvent({
      eventType: "run.progress",
      nodeId: "node-realtime",
      projectId: project.projectId,
      correlationId: "cor-realtime",
      traceId: "trc-realtime",
      payload: { step: "working" },
    });

    expect(observed).toEqual([{ eventId: event.eventId, eventSeq: event.eventSeq }]);
    expect(database.raw.query<{ event_id: string }, [number]>("SELECT event_id FROM kernel_events WHERE event_seq=?").get(event.eventSeq)?.event_id).toBe(event.eventId);
    database.close();
  });
});

function createUser(database: MarcusSqliteDatabase, now: string): string {
  const userId = createId("user");
  database.raw.query("INSERT INTO users(user_id, username, password_hash, status, created_at, updated_at) VALUES (?, 'delete-owner', NULL, 'active', ?, ?)")
    .run(userId, now, now);
  return userId;
}
