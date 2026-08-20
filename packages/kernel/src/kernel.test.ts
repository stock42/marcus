import { describe, expect, test } from "bun:test";
import { createId, type AgentDefinitionRecord, type AgentManifest, type AgentVersionRecord } from "@marcus/contracts";
import { m } from "@marcus/schema";
import { MarcusKernel, type KernelRepository } from "./kernel";

class MemoryRepository implements KernelRepository {
  definition: AgentDefinitionRecord;
  version: AgentVersionRecord;
  manifest: AgentManifest;
  runs = new Map<string, any>();
  conversations = new Map<string, string>();
  messages: Array<{ conversationId: string; role: string }> = [];
  events: string[] = [];

  constructor(manifest: AgentManifest) {
    const projectId = createId("project");
    const agentId = createId("agent");
    const versionId = createId("agentVersion");
    this.definition = {
      agentId,
      projectId,
      slug: manifest.identity.id,
      name: manifest.identity.name,
      kind: manifest.identity.kind,
      status: "active",
      activeVersionId: versionId,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.version = {
      agentVersionId: versionId,
      agentId,
      sourceKind: "sdk",
      sourceHash: "source",
      manifestHash: "manifest",
      artifactHash: "artifact",
      manifestSchemaVersion: "marcus.agent/v1",
      status: "active",
      createdAt: new Date(0).toISOString(),
    };
    this.manifest = manifest;
  }

  getAgentDefinition() { return this.definition; }
  getAgentVersion() { return this.version; }
  getAgentManifest() { return this.manifest; }
  createRun(input: any) { this.runs.set(input.runId, { ...input }); }
  getRun(runId: string) { return this.runs.get(runId); }
  findIdempotentRun(input: any) {
    return [...this.runs.values()].find((run) => run.idempotencyKey === input.idempotencyKey && run.principalId === input.principalId);
  }
  transitionRun(runId: string, expected: readonly any[], next: any, update: any = {}) {
    const run = this.runs.get(runId);
    if (!expected.includes(run.state)) throw new Error("conflict");
    Object.assign(run, update, { state: next });
    if (next === "running") run.startedAt ??= update.now;
    if (["completed", "failed", "cancelled", "timed_out", "killed"].includes(next)) run.finishedAt = update.now;
    return run;
  }
  resolveConversation(key: any) {
    const serialized = JSON.stringify(key);
    let id = this.conversations.get(serialized);
    if (id === undefined) {
      id = createId("conversation");
      this.conversations.set(serialized, id);
    }
    return id;
  }
  appendConversationMessage(input: any) {
    this.messages.push(input);
    return { conversationMessageId: createId("message"), sequence: this.messages.length };
  }
  appendKernelEvent(input: any) {
    this.events.push(input.eventType);
    return { ...input, eventId: createId("event"), eventSeq: this.events.length, occurredAt: input.occurredAt ?? new Date(0).toISOString() };
  }
}

function manifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    schemaVersion: "marcus.agent/v1",
    identity: { id: "assistant", name: "Assistant", kind: "assistant" },
    runtime: {
      profile: "worker",
      residency: "on-demand",
      startupTimeoutMs: 15_000,
      shutdownTimeoutMs: 10_000,
      heartbeatIntervalMs: 5_000,
      heartbeatTimeoutMs: 20_000,
    },
    contract: {
      inputSchema: m.object({ chatId: m.string(), message: m.string() }).definition,
      outputSchema: m.object({ text: m.string() }).definition,
    },
    entrypoints: { cli: { enabled: true }, api: { enabled: true, response: { mode: "auto" }, authentication: { type: "marcus-token" } } },
    conversation: {
      enabled: true,
      chatIdPath: "input.chatId",
      missingChatId: "required",
      scope: "principal+chat",
      history: { maxMessages: 100 },
      injection: "automatic",
    },
    concurrency: { total: 2, perConversation: 1, queueLimit: 10, saturation: "queue" },
    handlers: { onRun: "default:onRun" },
    build: { sourceKind: "sdk", sourceHash: "source", compilerVersion: "test" },
    ...overrides,
  };
}

describe("MarcusKernel admission and lifecycle", () => {
  test("creates a version-pinned run and persists conversation in order", () => {
    const repository = new MemoryRepository(manifest());
    const kernel = new MarcusKernel({ nodeId: "node-1", repository, now: () => 1_000 });
    const handle = kernel.invokeAgent({
      projectId: repository.definition.projectId,
      agentId: repository.definition.agentId,
      entrypoint: "api",
      principal: { id: "user-1" },
      input: { chatId: "chat-1", message: "Hello" },
    });
    expect(handle.state).toBe("queued");
    expect(handle.agentVersionId).toBe(repository.version.agentVersionId);
    expect(repository.messages.map((message) => message.role)).toEqual(["user"]);

    const dispatched = kernel.dispatchNext();
    expect(dispatched?.state).toBe("starting");
    kernel.markRunning(handle.runId);
    const completed = kernel.completeRun(handle.runId, { text: "Hello" });
    expect(completed.result).toBe("success");
    expect(repository.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  test("rejects rate limited invocation before creating a second Run", () => {
    let now = 1_000;
    const repository = new MemoryRepository(manifest({
      rateLimits: [{ name: "one", scope: "principal", algorithm: "fixed-window", limit: 1, windowMs: 60_000 }],
    }));
    const kernel = new MarcusKernel({ nodeId: "node-1", repository, now: () => now });
    const input = {
      projectId: repository.definition.projectId,
      agentId: repository.definition.agentId,
      entrypoint: "api" as const,
      principal: { id: "user-1" },
      input: { chatId: "chat-1", message: "Hello" },
    };
    kernel.invokeAgent(input);
    expect(() => kernel.invokeAgent(input)).toThrow("Rate limit one exceeded");
    expect(repository.runs.size).toBe(1);
    now += 60_000;
    expect(kernel.invokeAgent(input).idempotentReplay).toBe(false);
  });

  test("idempotency replays same input and rejects a changed payload", () => {
    const repository = new MemoryRepository(manifest());
    const kernel = new MarcusKernel({ nodeId: "node-1", repository, now: () => 1_000 });
    const base = {
      projectId: repository.definition.projectId,
      agentId: repository.definition.agentId,
      entrypoint: "api" as const,
      principal: { id: "user-1" },
      idempotencyKey: "request-1",
    };
    const first = kernel.invokeAgent({ ...base, input: { chatId: "chat-1", message: "Hello" } });
    const replay = kernel.invokeAgent({ ...base, input: { chatId: "chat-1", message: "Hello" } });
    expect(replay.runId).toBe(first.runId);
    expect(replay.idempotentReplay).toBe(true);
    expect(() => kernel.invokeAgent({ ...base, input: { chatId: "chat-1", message: "Changed" } })).toThrow(
      "Idempotency key was used with different input",
    );
  });

  test("queues concurrent runs for the same conversation", () => {
    const repository = new MemoryRepository(manifest());
    const kernel = new MarcusKernel({ nodeId: "node-1", repository, now: () => 1_000 });
    const input = {
      projectId: repository.definition.projectId,
      agentId: repository.definition.agentId,
      entrypoint: "api" as const,
      principal: { id: "user-1" },
      input: { chatId: "chat-1", message: "Hello" },
    };
    const first = kernel.invokeAgent(input);
    const second = kernel.invokeAgent(input);
    expect(kernel.dispatchNext()?.runId).toBe(first.runId);
    expect(kernel.dispatchNext()).toBeUndefined();
    kernel.markRunning(first.runId);
    kernel.completeRun(first.runId, { text: "Done" });
    expect(kernel.dispatchNext()?.runId).toBe(second.runId);
  });
});
