import { expect, test } from "bun:test";
import { ModelRoleRegistry, type ModelGenerationRequest, type ModelProvider } from "./index";

const provider: ModelProvider = {
  id: "local",
  type: "openai-compatible",
  async listModels() { return ["model-1"]; },
  async probe() {
    return {
      healthy: true,
      models: ["model-1"],
      latencyMs: 1,
      capabilities: {
        modelListing: true,
        chat: true,
        streaming: true,
        toolCalling: true,
        structuredOutput: true,
        thinking: false,
        vision: false,
        embeddings: false,
      },
    };
  },
  async generate<T>(request: ModelGenerationRequest) {
    return { output: { ok: true } as T, finishReason: "stop", provider: "local", model: request.model };
  },
  async generateStream<T>(request: ModelGenerationRequest) {
    return { output: { ok: true } as T, finishReason: "stop", provider: "local", model: request.model };
  },
};

test("control plane readiness is independent from model role readiness", () => {
  const registry = new ModelRoleRegistry();
  registry.registerProvider(provider);
  expect(registry.readiness()["agent.default"]).toBe(false);
  registry.bind({ role: "agent.default", providerId: "local", model: "model-1" });
  expect(registry.resolve("agent.default").provider.id).toBe("local");
  expect(registry.readiness()["markdown.compiler"]).toBe(false);
});
