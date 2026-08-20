import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { JsonValue } from "../packages/contracts/src/index";
import { MemoryLogSink, SafeLogger } from "../packages/observability/src/index";
import type {
  ModelGenerationRequest,
  ModelGenerationResponse,
  ModelGenerationStreamListener,
  ModelProvider,
  ProviderProbeResult,
} from "../packages/provider-contracts/src/index";
import { MarcusStudioGateway, type StudioGatewayConfig } from "../apps/marcus-studio-gateway/src/index";
import type { ProviderStudioOutput } from "../apps/marcus-studio-gateway/src/prompt";

class BrowserStudioProvider implements ModelProvider {
  readonly id = "playwright-deepseek";
  readonly type = "test";
  private version = 0;

  listModels(): Promise<readonly string[]> { return Promise.resolve(["deepseek-v4-flash"]); }
  probe(): Promise<ProviderProbeResult> {
    return Promise.resolve({
      healthy: true,
      models: ["deepseek-v4-flash"],
      latencyMs: 1,
      capabilities: { modelListing: true, chat: true, streaming: true, toolCalling: false, structuredOutput: true, thinking: true, vision: false, embeddings: false },
    });
  }
  generate<T = JsonValue>(_request: ModelGenerationRequest): Promise<ModelGenerationResponse<T>> { throw new Error("Browser Studio must use streaming"); }
  async generateStream<T = JsonValue>(request: ModelGenerationRequest, listener: ModelGenerationStreamListener): Promise<ModelGenerationResponse<T>> {
    this.version += 1;
    await Bun.sleep(25);
    await listener({ type: "reasoning-delta", delta: "private" });
    await Bun.sleep(25);
    await listener({ type: "content-delta", delta: "{" });
    await Bun.sleep(25);
    await listener({ type: "usage", usage: { inputTokens: 90, outputTokens: 240, totalTokens: 330 } });
    return {
      output: markdownOutput(this.version) as T,
      finishReason: "stop",
      provider: this.id,
      model: request.model,
    };
  }
}

function markdownOutput(version: number): ProviderStudioOutput {
  return {
    format: "markdown",
    filename: "movie-recommender.agent.md",
    name: "Movie Recommender",
    summary: "Recomienda películas desde preferencias explícitas.",
    source: `---
schema: marcus.agent/v1
id: movie-recommender
name: Movie Recommender
kind: prompt-task
cli-enabled: true
---

# Objective

Recomendar películas explicando la relación con las preferencias recibidas.

# System

Respondé en español. No inventes preferencias ausentes.

# Prompt

Analizá las preferencias y generá recomendaciones justificadas.${version > 1 ? " Incluí el año de estreno." : ""}

# Input

\`\`\`yaml schema
object:
  preferences:
    type: array
    items:
      type: string
required: [preferences]
additional-properties: false
\`\`\`

# Output

\`\`\`yaml schema
object:
  recommendations:
    type: array
    items:
      type: object
      properties:
        title:
          type: string
        reason:
          type: string${version > 1 ? "\n        year:\n          type: integer" : ""}
      required: [title, reason${version > 1 ? ", year" : ""}]
      additional-properties: false
required: [recommendations]
additional-properties: false
\`\`\`
`,
    assumptions: ["Las preferencias llegan como una lista de textos."],
    warnings: [],
  };
}

const directory = await mkdtemp(resolve(tmpdir(), "marcus-studio-browser-"));
const config: StudioGatewayConfig = {
  host: "127.0.0.1",
  port: 7_447,
  dataDir: directory,
  databasePath: resolve(directory, "studio.sqlite"),
  allowedOrigins: ["http://127.0.0.1:4322"],
  trustProxy: false,
  secureCookies: false,
  sessionTtlMs: 120_000,
  replayTtlMs: 120_000,
  providerBaseUrl: "https://api.deepseek.com",
  providerApiKey: "playwright-only",
  providerModel: "deepseek-v4-flash",
  providerTimeoutMs: 10_000,
  maxConcurrentGenerations: 2,
  dailyLlmCallLimit: 1_000,
  maxOutputTokens: 8_192,
  sessionKey: new Uint8Array(32).fill(7),
  eventEncryptionKey: new Uint8Array(32).fill(9),
};
const gateway = new MarcusStudioGateway(config, {
  provider: new BrowserStudioProvider(),
  logger: new SafeLogger({ source: "studio-playwright", sink: new MemoryLogSink() }),
});
gateway.start();

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await gateway.stop();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
