import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { JsonValue } from "@marcus/contracts";
import { MemoryLogSink, SafeLogger } from "@marcus/observability";
import type {
  ModelGenerationRequest,
  ModelGenerationResponse,
  ModelGenerationStreamListener,
  ModelProvider,
  ProviderProbeResult,
} from "@marcus/provider-contracts";
import {
  STUDIO_IDEMPOTENCY_HEADER,
  STUDIO_PROTOCOL,
  STUDIO_REQUEST_ID_HEADER,
  type StudioGenerationRequest,
  type StudioServerEvent,
} from "@marcus/studio-contracts";
import type { StudioGatewayConfig } from "./config";
import { STUDIO_OUTPUT_EXAMPLE } from "./prompt";
import { MarcusStudioGateway } from "./server";

class FakeStudioProvider implements ModelProvider {
  readonly id = "fake-studio";
  readonly type = "test";
  calls = 0;
  listModels(): Promise<readonly string[]> { return Promise.resolve(["deepseek-v4-flash"]); }
  probe(): Promise<ProviderProbeResult> { return Promise.resolve({ healthy: true, models: ["deepseek-v4-flash"], latencyMs: 1, capabilities: { modelListing: true, chat: true, streaming: true, toolCalling: false, structuredOutput: true, thinking: true, vision: false, embeddings: false } }); }
  generate<T = JsonValue>(_request: ModelGenerationRequest): Promise<ModelGenerationResponse<T>> { throw new Error("streaming required"); }
  async generateStream<T = JsonValue>(request: ModelGenerationRequest, listener: ModelGenerationStreamListener): Promise<ModelGenerationResponse<T>> {
    this.calls += 1;
    expect(request.thinking).toBe(true);
    expect(request.reasoningEffort).toBe("high");
    expect(request.allowStructuredOutputFallback).toBe(false);
    await listener({ type: "reasoning-delta", delta: "raw-private-reasoning" });
    await listener({ type: "content-delta", delta: "{" });
    await listener({ type: "usage", usage: { inputTokens: 120, outputTokens: 320, totalTokens: 440 } });
    return {
      output: structuredClone(STUDIO_OUTPUT_EXAMPLE) as T,
      finishReason: "stop",
      provider: this.id,
      model: request.model,
    };
  }
}

class BlockingStudioProvider extends FakeStudioProvider {
  override async generateStream<T = JsonValue>(request: ModelGenerationRequest, listener: ModelGenerationStreamListener): Promise<ModelGenerationResponse<T>> {
    this.calls += 1;
    await listener({ type: "reasoning-delta", delta: "still-private" });
    return await new Promise<ModelGenerationResponse<T>>((_, reject) => {
      const abort = () => reject(new DOMException("Cancelled", "AbortError"));
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

test("accepts over HTTP and delivers progress, validation and output only over WebSocket", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-studio-server-"));
  const provider = new FakeStudioProvider();
  const port = availablePort();
  const config = testConfig(directory, port);
  const gateway = new MarcusStudioGateway(config, { provider, logger: new SafeLogger({ source: "test", sink: new MemoryLogSink() }) });
  const server = gateway.start();
  const origin = `http://127.0.0.1:${server.port}`;
  let socket: WebSocket | undefined;
  try {
    const session = await fetch(`${origin}/api/studio/sessions`, { method: "POST", headers: { Origin: origin } });
    expect(session.status).toBe(204);
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toStartWith("marcus_studio_session=");
    socket = new WebSocket(`${origin.replace("http", "ws")}/api/studio/ws`, { headers: { Cookie: cookie!, Origin: origin } });
    const events = eventInbox(socket);
    await events.open;
    expect((await events.next()).type).toBe("session.ready");

    const body: StudioGenerationRequest = {
      requestId: "streq_000000000001",
      idempotencyKey: "idem-000000000001",
      format: "markdown",
      prompt: "Quiero recomendaciones de películas según mis preferencias.",
    };
    const accepted = await fetch(`${origin}/api/studio/requests`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie!,
        "Content-Type": "application/json",
        [STUDIO_REQUEST_ID_HEADER]: body.requestId,
        [STUDIO_IDEMPOTENCY_HEADER]: body.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.text()).toBe("");
    const received: StudioServerEvent[] = [];
    while (!received.some((event) => event.type === "generation.completed")) received.push(await events.next());
    expect(received.map((event) => event.type)).toContain("generation.validation");
    expect(received.filter((event) => event.type === "generation.stage").map((event) => event.data)).toContainEqual(expect.objectContaining({ stage: "provider-thinking" }));
    expect(JSON.stringify(received)).not.toContain("raw-private-reasoning");
    expect(received.find((event) => event.type === "generation.completed")).toMatchObject({ data: { output: { valid: true, filename: "movie-recommender.agent.md" } } });
    expect(provider.calls).toBe(1);

    const replay = await fetch(`${origin}/api/studio/requests`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie!, "Content-Type": "application/json", [STUDIO_REQUEST_ID_HEADER]: body.requestId, [STUDIO_IDEMPOTENCY_HEADER]: body.idempotencyKey },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(202);
    expect((await events.next()).type).toBe("request.replayed");
    let replayed: StudioServerEvent;
    do { replayed = await events.next(); } while (replayed.type !== "generation.completed");
    expect(provider.calls).toBe(1);
  } finally {
    await gateway.stop();
    socket = undefined;
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("cancels an in-flight provider stream through the WebSocket contract", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-studio-cancel-"));
  const provider = new BlockingStudioProvider();
  const port = availablePort();
  const gateway = new MarcusStudioGateway(testConfig(directory, port), { provider, logger: new SafeLogger({ source: "test", sink: new MemoryLogSink() }) });
  const server = gateway.start();
  const origin = `http://127.0.0.1:${server.port}`;
  let socket: WebSocket | undefined;
  try {
    const session = await fetch(`${origin}/api/studio/sessions`, { method: "POST", headers: { Origin: origin } });
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    socket = new WebSocket(`${origin.replace("http", "ws")}/api/studio/ws`, { headers: { Cookie: cookie!, Origin: origin } });
    const events = eventInbox(socket);
    await events.open;
    await events.next();
    const body: StudioGenerationRequest = {
      requestId: "streq_cancel00000001",
      idempotencyKey: "idem-cancel00000001",
      format: "markdown",
      prompt: "Creá un agente que pueda ser cancelado durante la prueba.",
    };
    expect((await fetch(`${origin}/api/studio/requests`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie!, "Content-Type": "application/json", [STUDIO_REQUEST_ID_HEADER]: body.requestId, [STUDIO_IDEMPOTENCY_HEADER]: body.idempotencyKey },
      body: JSON.stringify(body),
    })).status).toBe(202);
    let event: StudioServerEvent;
    do { event = await events.next(); } while (!(event.type === "generation.stage" && event.data.stage === "provider-thinking"));
    socket.send(JSON.stringify({ protocol: STUDIO_PROTOCOL, type: "generation.cancel", requestId: body.requestId }));
    do { event = await events.next(); } while (event.type !== "generation.failed");
    expect(event).toMatchObject({ data: { code: "STUDIO_CANCELLED", retryable: true } });
    expect(provider.calls).toBe(1);
  } finally {
    await gateway.stop();
    socket = undefined;
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);

function testConfig(directory: string, port: number): StudioGatewayConfig {
  return {
    host: "127.0.0.1",
    port,
    dataDir: directory,
    databasePath: resolve(directory, "studio.sqlite"),
    allowedOrigins: [`http://127.0.0.1:${port}`],
    trustProxy: false,
    secureCookies: false,
    sessionTtlMs: 120_000,
    replayTtlMs: 120_000,
    providerBaseUrl: "https://api.deepseek.com",
    providerApiKey: "test",
    providerModel: "deepseek-v4-flash",
    providerTimeoutMs: 10_000,
    maxConcurrentGenerations: 1,
    dailyLlmCallLimit: 1_000,
    maxOutputTokens: 8_192,
    sessionKey: new Uint8Array(32).fill(1),
    eventEncryptionKey: new Uint8Array(32).fill(2),
  };
}

function availablePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("Bun did not allocate a Studio test port");
  return port;
}

function eventInbox(socket: WebSocket): { open: Promise<void>; next: () => Promise<StudioServerEvent> } {
  const queue: StudioServerEvent[] = [];
  const waiters: Array<(event: StudioServerEvent) => void> = [];
  const open = new Promise<void>((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("Studio WebSocket did not open")), { once: true });
  });
  socket.addEventListener("message", (message) => {
    const event = JSON.parse(String(message.data)) as StudioServerEvent;
    const waiter = waiters.shift();
    if (waiter === undefined) queue.push(event);
    else waiter(event);
  });
  return {
    open,
    next: () => {
      const event = queue.shift();
      if (event !== undefined) return Promise.resolve(event);
      return new Promise<StudioServerEvent>((resolveEvent, rejectEvent) => {
        const timer = setTimeout(() => rejectEvent(new Error("Timed out waiting for Studio event")), 3_000);
        waiters.push((received) => { clearTimeout(timer); resolveEvent(received); });
      });
    },
  };
}
