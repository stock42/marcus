import type { JsonValue } from "@marcus/contracts";
import { OpenAICompatibleProvider } from "@marcus/provider-contracts";
import { STUDIO_OUTPUT_EXAMPLE, STUDIO_OUTPUT_SCHEMA, studioMessages, type ProviderStudioOutput } from "./prompt";
import { loadStudioGatewayConfig } from "./config";
import { validateStudioOutput } from "./validation";

if (import.meta.main) {
  const config = await loadStudioGatewayConfig();
  const provider = new OpenAICompatibleProvider({
    id: "studio-deepseek-smoke",
    catalogId: "deepseek",
    baseUrl: config.providerBaseUrl,
    apiKey: config.providerApiKey,
    timeoutMs: config.providerTimeoutMs,
  });
  let reasoningChunks = 0;
  let contentChunks = 0;
  const response = await provider.generateStream<ProviderStudioOutput>({
    model: config.providerModel,
    userId: `studio_smoke_${Bun.randomUUIDv7().replaceAll("-", "")}`,
    messages: studioMessages({
      requestId: "streq_provider_smoke_0001",
      idempotencyKey: "provider-smoke-0001",
      format: "markdown",
      prompt: "Creá un agente mínimo que clasifique una nota como urgente o normal y devuelva una explicación breve.",
    }),
    outputSchema: STUDIO_OUTPUT_SCHEMA,
    outputExample: STUDIO_OUTPUT_EXAMPLE as unknown as JsonValue,
    allowStructuredOutputFallback: false,
    thinking: true,
    reasoningEffort: "high",
    maxOutputTokens: config.maxOutputTokens,
  }, (event) => {
    if (event.type === "reasoning-delta") reasoningChunks += 1;
    if (event.type === "content-delta") contentChunks += 1;
  });
  const output = await validateStudioOutput(response.output, "markdown");
  if (!output.valid || reasoningChunks === 0 || contentChunks === 0) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify({
    ok: output.valid && reasoningChunks > 0 && contentChunks > 0,
    provider: response.provider,
    model: response.model,
    finishReason: response.finishReason,
    reasoningObserved: reasoningChunks > 0,
    contentObserved: contentChunks > 0,
    validation: output.validationLabel,
    usage: response.usage ?? {},
  })}\n`);
}
