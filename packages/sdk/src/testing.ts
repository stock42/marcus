import { MarcusError, type JsonValue, type ToolManifest } from "@marcus/contracts";
import { type AgentContext, type MarcusAgentModule, type ModelResponse } from "./index";

export interface AgentTestHarnessOptions {
  model?: { responses?: readonly { output: JsonValue; text?: string; finishReason?: string }[] };
  tools?: Readonly<Record<string, (input: JsonValue) => JsonValue | Promise<JsonValue>>>;
  now?: () => Date;
}

export interface HarnessRunResult<O> {
  output: O;
  progress: readonly JsonValue[];
  checkpoints: readonly JsonValue[];
  artifacts: readonly { artifactId: string; name: string; bytes: Uint8Array }[];
  toolCalls: readonly { tool: string; input: JsonValue }[];
}

export function createAgentTestHarness<I, O>(module: MarcusAgentModule<I, O>, options: AgentTestHarnessOptions = {}) {
  let modelCursor = 0;
  return {
    async run(input: I): Promise<HarnessRunResult<O>> {
      const parsedInput = module.inputSchema.parse(input);
      const progress: JsonValue[] = [];
      const checkpoints: JsonValue[] = [];
      const artifacts: Array<{ artifactId: string; name: string; bytes: Uint8Array }> = [];
      const toolCalls: Array<{ tool: string; input: JsonValue }> = [];
      const controller = new AbortController();
      const context = createContext({
        controller,
        options,
        progress,
        checkpoints,
        artifacts,
        toolCalls,
        toolDefinitions: module.toManifest().tools ?? [],
        model: async <T>(): Promise<ModelResponse<T>> => {
          const response = options.model?.responses?.[modelCursor++];
          if (response === undefined) {
            throw new MarcusError({ code: "TEST_MODEL_RESPONSE_MISSING", message: "No fake model response remains", retryable: false });
          }
          return {
            output: response.output as T,
            finishReason: response.finishReason ?? "stop",
            provider: "test",
            model: "test",
            ...(response.text === undefined ? {} : { text: response.text }),
          };
        },
      });
      const definition = module.definition as {
        onRun?: (context: AgentContext, input: I) => Promise<O>;
        prompt?: (context: { input: I }) => string;
        system?: string;
      };
      const rawOutput = definition.onRun === undefined
        ? (await context.model.generate<O>({
            ...(definition.system === undefined ? {} : { system: definition.system }),
            messages: [{ role: "user", content: definition.prompt?.({ input: parsedInput }) ?? JSON.stringify(parsedInput) }],
            output: module.outputSchema,
          })).output
        : await definition.onRun(context, parsedInput);
      const output = module.outputSchema.parse(rawOutput);
      return { output, progress, checkpoints, artifacts, toolCalls };
    },
  };
}

function createContext(input: {
  controller: AbortController;
  options: AgentTestHarnessOptions;
  progress: JsonValue[];
  checkpoints: JsonValue[];
  artifacts: Array<{ artifactId: string; name: string; bytes: Uint8Array }>;
  toolCalls: Array<{ tool: string; input: JsonValue }>;
  toolDefinitions: readonly ToolManifest[];
  model: <T>() => Promise<ModelResponse<T>>;
}): AgentContext {
  return {
    signal: input.controller.signal,
    project: { id: "prj_test", slug: "test", homePath: "/test" },
    agent: { id: "agt_test", versionId: "av_test", instanceId: "ins_test" },
    run: { id: "run_test", entrypoint: "test", traceId: "trc_test" },
    logger: { debug() {}, info() {}, warn() {}, error() {}, redact: () => "[REDACTED]" },
    progress: {
      report(value) { input.progress.push(value as JsonValue); },
      async waiting(value) { input.progress.push({ waiting: value.reason }); },
    },
    model: { async generate<T>() { return input.model<T>(); } },
    tools: {
      async call<T = JsonValue>(tool: string, value: JsonValue): Promise<T> {
        input.toolCalls.push({ tool, input: value });
        const handler = input.options.tools?.[tool];
        if (handler === undefined) throw new MarcusError({ code: "TEST_TOOL_NOT_FOUND", message: `Fake tool ${tool} not found`, retryable: false });
        return (await handler(value)) as T;
      },
      async list() { return input.toolDefinitions; },
      async get(tool: string) {
        const descriptor = input.toolDefinitions.find((candidate) => candidate.id === tool);
        if (descriptor === undefined) throw new MarcusError({ code: "TEST_TOOL_NOT_FOUND", message: `Fake tool ${tool} not found`, retryable: false });
        return descriptor;
      },
    },
    agents: {
      async run<T>() { throw new MarcusError({ code: "TEST_SUBAGENT_NOT_CONFIGURED", message: "No fake subagent configured", retryable: false }); },
      async parallel<T>() { throw new MarcusError({ code: "TEST_SUBAGENT_NOT_CONFIGURED", message: "No fake subagent configured", retryable: false }); },
    },
    messages: { async send() { return { messageId: "msg_test" }; } },
    events: { async publish() {} },
    checkpoint: {
      async save(value) { input.checkpoints.push(value.domainState); return { checkpointId: `cp_${input.checkpoints.length}` }; },
    },
    artifacts: {
      async fromBytes(value) {
        const artifact = { artifactId: `art_${input.artifacts.length + 1}`, name: value.name, bytes: value.bytes };
        input.artifacts.push(artifact);
        return { artifactId: artifact.artifactId };
      },
      async fromProjectFile() { return { artifactId: `art_${input.artifacts.length + 1}` }; },
    },
    files: {
      async read() { throw new MarcusError({ code: "TEST_FILE_NOT_FOUND", message: "No fake file configured", retryable: false }); },
      async write() { return { revision: 1 }; },
    },
    secrets: { ref: (name) => ({ name }), async get() { throw new MarcusError({ code: "TEST_SECRET_NOT_FOUND", message: "No fake secret configured", retryable: false }); } },
    approvals: { async request<T>() { throw new MarcusError({ code: "TEST_APPROVAL_NOT_CONFIGURED", message: "No fake approval configured", retryable: false }); } },
  };
}
