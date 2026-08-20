import { describe, expect, test } from "bun:test";
import { createAgentTestHarness } from "./testing";
import { defineAgent, definePromptTask, defineTool, m, parseDuration, tools } from "./index";

describe("@marcus/sdk", () => {
  test("normalizes a one-file agent to marcus.agent/v1", async () => {
    const agent = defineAgent({
      id: "hello-agent",
      name: "Hello Agent",
      input: m.object({ name: m.string() }),
      output: m.object({ message: m.string() }),
      entrypoints: { cli: { enabled: true }, api: { enabled: true } },
      tools: tools.load(["marcus/files.read"]),
      async onRun(_context, input) { return { message: `Hello ${input.name}` }; },
    });
    const manifest = agent.toManifest({ sourceHash: "abc", entrypoint: "index.ts" });
    expect(manifest.schemaVersion).toBe("marcus.agent/v1");
    expect(manifest.entrypoints.api?.authentication).toEqual({ type: "marcus-token" });
    expect(manifest.handlers.onRun).toBe("module:onRun");
    expect(manifest.tools?.[0]).toMatchObject({
      id: "marcus/files.read",
      source: "marcus",
      version: "1.0.0",
      inputSchema: { type: "object", required: ["path"] },
      risk: "low",
    });
    expect(JSON.stringify(manifest)).not.toContain("Hello ${input.name}");

    const result = await createAgentTestHarness(agent).run({ name: "Marcus" });
    expect(result.output).toEqual({ message: "Hello Marcus" });
  });

  test("registers a typed defineTool descriptor in the immutable AgentVersion manifest", () => {
    const uppercase = defineTool({
      id: "uppercase",
      description: "Uppercase text",
      input: m.object({ text: m.string() }),
      output: m.object({ text: m.string() }),
      timeout: "2s",
      sideEffects: false,
      risk: "medium",
      idempotency: { strategy: "input-hash", scope: "run" },
      async execute(_context, input) { return { text: input.text.toUpperCase() }; },
    });
    const agent = defineAgent({
      id: "custom-tool-agent",
      name: "Custom Tool Agent",
      input: m.object({ text: m.string() }),
      output: m.object({ text: m.string() }),
      tools: [uppercase],
      async onRun(context, input) { return context.tools.call("uppercase", input); },
    });

    expect(agent.toManifest().tools).toEqual([
      expect.objectContaining({
        id: "uppercase",
        source: "agent",
        version: expect.any(String),
        inputSchema: expect.objectContaining({ required: ["text"] }),
        outputSchema: expect.objectContaining({ required: ["text"] }),
        timeoutMs: 2_000,
        risk: "medium",
        idempotency: { strategy: "input-hash", scope: "run" },
      }),
    ]);
  });

  test("rejects unknown and duplicate tool references", () => {
    const base = {
      id: "invalid-tools",
      name: "Invalid tools",
      input: m.object({}),
      output: m.object({}),
      async onRun() { return {}; },
    };
    expect(() => defineAgent({ ...base, tools: tools.load(["missing/tool"]) }).toManifest()).toThrow("not an official Marcus tool");
    expect(() => defineAgent({ ...base, tools: tools.load(["marcus/files.read", "marcus/files.read"]) }).toManifest()).toThrow("declared more than once");
    expect(() => defineTool({
      id: "marcus/files.read",
      description: "Invalid namespace test",
      input: m.object({}),
      output: m.object({}),
      async execute() { return {}; },
    })).toThrow("namespace marcus/ is reserved");
  });

  test("PromptTask executes with a deterministic fake model", async () => {
    const task = definePromptTask({
      id: "triage",
      name: "Triage",
      input: m.object({ ticket: m.string() }),
      output: m.object({ urgency: m.enum(["low", "high"]) }),
      system: "Classify",
      prompt: ({ input }) => input.ticket,
    });
    const result = await createAgentTestHarness(task, { model: { responses: [{ output: { urgency: "high" } }] } }).run({
      ticket: "Production is down",
    });
    expect(result.output).toEqual({ urgency: "high" });
  });

  test("duration parser is strict and deterministic", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1.5m")).toBe(90_000);
    expect(() => parseDuration("forever" as never)).toThrow("Invalid duration");
  });
});
