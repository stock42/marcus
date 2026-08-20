import { afterEach, expect, test } from "bun:test";
import { listProviderCatalog, OpenAICompatibleProvider } from "./index";

let server: Bun.Server<undefined> | undefined;
afterEach(() => server?.stop(true));

test("OpenAI-compatible adapter lists models and generates structured output", async () => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/models": () => Response.json({ data: [{ id: "local-model" }] }),
      "/v1/chat/completions": { POST: () => Response.json({ choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: "stop" }], usage: { total_tokens: 3 } }) },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "local", baseUrl: `http://127.0.0.1:${server.port}/v1` });
  expect(await provider.listModels()).toEqual(["local-model"]);
  const result = await provider.generate<{ answer: string }>({ model: "local-model", messages: [{ role: "user", content: "hello" }], outputSchema: { type: "object" } });
  expect(result.output).toEqual({ answer: "ok" });
  expect((await provider.probe()).healthy).toBe(true);
});

test("OpenAI-compatible adapter round-trips typed tool calls", async () => {
  let requestBody: Record<string, unknown> | undefined;
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/chat/completions": {
        POST: async (request) => {
          requestBody = await request.json() as Record<string, unknown>;
          return Response.json({
            choices: [{
              message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "projects_list", arguments: "{}" } }] },
              finish_reason: "tool_calls",
            }],
          });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "local", baseUrl: `http://127.0.0.1:${server.port}/v1` });
  const result = await provider.generate({
    model: "local-model",
    messages: [
      { role: "assistant", content: "", reasoningContent: "private tool reasoning", toolCalls: [{ id: "previous", name: "projects_list", arguments: {} }] },
      { role: "tool", content: [], name: "projects_list", toolCallId: "previous" },
    ],
    tools: [{ name: "projects_list", description: "List projects", inputSchema: { type: "object", additionalProperties: false } }],
    thinking: true,
    reasoningEffort: "high",
  });
  expect(result.toolCalls).toEqual([{ id: "call_1", name: "projects_list", arguments: {} }]);
  expect(requestBody).toMatchObject({
    messages: [
      { role: "assistant", reasoning_content: "private tool reasoning", tool_calls: [{ id: "previous", type: "function", function: { name: "projects_list", arguments: "{}" } }] },
      { role: "tool", name: "projects_list", tool_call_id: "previous" },
    ],
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });
});

test("OpenAI-compatible adapter falls back when native JSON Schema is unavailable", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/chat/completions": {
        POST: async (request) => {
          const body = await request.json() as Record<string, unknown>;
          requestBodies.push(body);
          if (body.response_format !== undefined) {
            return Response.json({ error: { message: "This response_format type is unavailable now", type: "invalid_request_error" } }, { status: 400 });
          }
          return Response.json({ choices: [{ message: { content: "```json\n{\"answer\":\"fallback-ok\"}\n```" }, finish_reason: "stop" }] });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "fallback", baseUrl: `http://127.0.0.1:${server.port}/v1` });

  const result = await provider.generate<{ answer: string }>({
    model: "local-model",
    messages: [{ role: "user", content: "hello" }],
    outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
  });

  expect(result.output).toEqual({ answer: "fallback-ok" });
  expect(requestBodies).toHaveLength(3);
  expect(requestBodies[0]).toMatchObject({ response_format: { type: "json_schema" } });
  expect(requestBodies[1]).toMatchObject({ response_format: { type: "json_object" } });
  expect(requestBodies[2]?.response_format).toBeUndefined();
  const fallbackMessages = requestBodies[2]?.messages as Array<{ content?: unknown }>;
  expect(fallbackMessages[0]?.content).toContain("Return only one valid JSON value");
  expect(fallbackMessages[0]?.content).toContain('"required":["answer"]');
  expect(fallbackMessages[0]?.content).toContain("Example JSON output");
});

test("DeepSeek profile enables thinking and uses JSON Object without probing JSON Schema", async () => {
  let requestBody: Record<string, unknown> | undefined;
  server = Bun.serve({
    port: 0,
    routes: {
      "/chat/completions": {
        POST: async (request) => {
          requestBody = await request.json() as Record<string, unknown>;
          return Response.json({
            choices: [{ message: { reasoning_content: "provider-private", content: '{"answer":"deepseek-ok"}' }, finish_reason: "stop" }],
          });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "deepseek", catalogId: "deepseek", baseUrl: `http://127.0.0.1:${server.port}` });

  const result = await provider.generate<{ answer: string }>({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "reply as JSON" }],
    outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
    temperature: 0.2,
  });

  expect(result.output).toEqual({ answer: "deepseek-ok" });
  expect(result.reasoningContent).toBe("provider-private");
  expect(requestBody).toMatchObject({
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    response_format: { type: "json_object" },
  });
  expect(requestBody?.temperature).toBeUndefined();
  expect(JSON.stringify(requestBody?.messages)).toContain("Example JSON output");
});

test("structured output is locally schema validated after JSON parsing", async () => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/chat/completions": { POST: () => Response.json({ choices: [{ message: { content: '{"answer":42}' }, finish_reason: "stop" }] }) },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "local", baseUrl: `http://127.0.0.1:${server.port}/v1` });

  await expect(provider.generate({
    model: "local",
    messages: [{ role: "user", content: "JSON" }],
    outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
  })).rejects.toMatchObject({ code: "PROVIDER_STRUCTURED_OUTPUT_SCHEMA_INVALID" });
});

test("DeepSeek JSON Output retries one empty completion with a stronger instruction", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  server = Bun.serve({
    port: 0,
    routes: {
      "/chat/completions": {
        POST: async (request) => {
          requestBodies.push(await request.json() as Record<string, unknown>);
          const content = requestBodies.length === 1 ? "" : '{"answer":"retry-ok"}';
          return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "deepseek", catalogId: "deepseek", baseUrl: `http://127.0.0.1:${server.port}` });
  const result = await provider.generate<{ answer: string }>({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "JSON" }],
    outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
  });
  expect(result.output).toEqual({ answer: "retry-ok" });
  expect(requestBodies).toHaveLength(2);
  expect(JSON.stringify(requestBodies[1]?.messages)).toContain("previous structured response was empty");
});

test("provider catalog exposes only the supported first-party presets", () => {
  expect(listProviderCatalog().map((provider) => provider.id)).toEqual(["openai", "deepseek"]);
  expect(listProviderCatalog().find((provider) => provider.id === "deepseek")).toMatchObject({
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro",
    capabilities: { thinking: true },
  });
});

test("OpenAI-compatible adapter does not hide unrelated response format errors", async () => {
  let requests = 0;
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/chat/completions": {
        POST: () => {
          requests += 1;
          return Response.json({ error: { message: "Invalid response_format JSON schema", type: "invalid_request_error" } }, { status: 400 });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "strict", baseUrl: `http://127.0.0.1:${server.port}/v1` });

  await expect(provider.generate({ model: "local-model", messages: [{ role: "user", content: "hello" }], outputSchema: { type: "object" } }))
    .rejects.toMatchObject({ code: "PROVIDER_HTTP_ERROR" });
  expect(requests).toBe(1);
});

test("DeepSeek streaming separates private reasoning from structured content", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const encoder = new TextEncoder();
  server = Bun.serve({
    port: 0,
    routes: {
      "/chat/completions": {
        POST: async (request) => {
          requestBody = await request.json() as Record<string, unknown>;
          const frames = [
            'data: {"choices":[{"delta":{"reasoning_content":"private "},"finish_reason":null}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"thought"},"finish_reason":null}]}\n\n',
            'data: {"choices":[{"delta":{"content":"{\\"answer\\":\\"strea"},"finish_reason":null}]}\n\n',
            'data: {"choices":[{"delta":{"content":"med\\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":8,"total_tokens":12}}\n\n',
            "data: [DONE]\n\n",
          ];
          return new Response(new ReadableStream({
            start(controller) {
              for (const frame of frames) controller.enqueue(encoder.encode(frame));
              controller.close();
            },
          }), { headers: { "Content-Type": "text/event-stream" } });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "deepseek", catalogId: "deepseek", baseUrl: `http://127.0.0.1:${server.port}` });
  const events: string[] = [];
  const result = await provider.generateStream<{ answer: string }>({
    model: "deepseek-v4-flash",
    userId: "studio_subject_123",
    messages: [{ role: "user", content: "Return JSON" }],
    outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
    allowStructuredOutputFallback: false,
    thinking: true,
    reasoningEffort: "high",
  }, (event) => { events.push(event.type); });

  expect(result.output).toEqual({ answer: "streamed" });
  expect(result.reasoningContent).toBe("private thought");
  expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 8, totalTokens: 12 });
  expect(events).toEqual(["reasoning-delta", "reasoning-delta", "content-delta", "content-delta", "usage"]);
  expect(requestBody).toMatchObject({
    model: "deepseek-v4-flash",
    user_id: "studio_subject_123",
    stream: true,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    response_format: { type: "json_object" },
  });
});

test("streaming can forbid hidden structured-output fallback calls", async () => {
  let requests = 0;
  server = Bun.serve({
    port: 0,
    routes: {
      "/chat/completions": {
        POST: () => {
          requests += 1;
          return Response.json({ error: { message: "This response_format type is unavailable now" } }, { status: 400 });
        },
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "deepseek", catalogId: "deepseek", baseUrl: `http://127.0.0.1:${server.port}` });
  await expect(provider.generateStream({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "JSON" }],
    outputSchema: { type: "object" },
    allowStructuredOutputFallback: false,
  }, () => undefined)).rejects.toMatchObject({ code: "PROVIDER_HTTP_ERROR" });
  expect(requests).toBe(1);
});

test("streaming keeps external cancellation active while consuming SSE", async () => {
  const encoder = new TextEncoder();
  server = Bun.serve({
    port: 0,
    routes: {
      "/chat/completions": {
        POST: () => new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"working"}}]}\n\n'));
          },
        }), { headers: { "Content-Type": "text/event-stream" } }),
      },
    },
  });
  const provider = new OpenAICompatibleProvider({ id: "deepseek", catalogId: "deepseek", baseUrl: `http://127.0.0.1:${server.port}`, timeoutMs: 2_000 });
  const controller = new AbortController();
  const generation = provider.generateStream({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "JSON" }],
    signal: controller.signal,
  }, () => undefined);
  await Bun.sleep(20);
  controller.abort();
  await expect(generation).rejects.toThrow();
}, 3_000);
