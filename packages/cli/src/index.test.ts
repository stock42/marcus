import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { hasDefaultLlmConfigured, MarcusCli, parseCommand, projectPath, tokenize, type CliRequester } from "./index";

describe("CLI command language", () => {
  test("tokenizes quoted input without evaluating shell syntax", () => {
    expect(tokenize(`agent run support --input '{"message":"hello world","literal":"$(whoami)"}'`)).toEqual([
      "agent", "run", "support", "--input", '{"message":"hello world","literal":"$(whoami)"}',
    ]);
  });

  test("normalizes logical paths and blocks root escape", () => {
    const context = { projectId: "prj", projectSlug: "demo", projectPath: "project:/docs" };
    expect(projectPath("guide/../api.md", context)).toBe("project:/docs/api.md");
    expect(() => projectPath("../../secret", context)).toThrow("escapes Project root");
  });

  test("maps human commands to typed MNP operations", () => {
    const parsed = parseCommand(`agent run support --input '{"message":"hello"}' --idempotency-key idem-1`, { projectId: "prj", projectPath: "project:/" });
    expect(parsed).toEqual({
      type: "request",
      operation: "runs.invoke",
      payload: { agent: "support", input: { message: "hello" } },
      projectRequired: true,
      idempotencyKey: "idem-1",
    });
    expect(parseCommand("bootstrap setup --username admin", { projectPath: "project:/" })).toEqual({ type: "bootstrap-setup", username: "admin" });
    expect(parseCommand("config default", { projectPath: "project:/" })).toEqual({ type: "configure-default-llm" });
    expect(parseCommand("sync push local:./agents project:/agents --watch --delete --debounce 500 --ignore local:.marcusignore", { projectId: "prj", projectPath: "project:/" })).toEqual({
      type: "sync-directory",
      localPath: "./agents",
      projectPath: "project:/agents",
      watch: true,
      delete: true,
      dryRun: false,
      initial: true,
      debounceMs: 500,
      ignoreFile: ".marcusignore",
    });
    expect(parseCommand("sync stop sync_1", { projectId: "prj", projectPath: "project:/" })).toMatchObject({ type: "request", operation: "files.sync.stop", payload: { syncId: "sync_1" } });
    expect(parseCommand("validator show project/project-token", { projectId: "prj", projectPath: "project:/" })).toEqual({
      type: "request",
      operation: "authValidators.get",
      payload: { validator: "project/project-token" },
      projectRequired: true,
    });
    expect(parseCommand("validator build validators/token/index.ts --no-activate", { projectId: "prj", projectPath: "project:/" })).toEqual({
      type: "request",
      operation: "authValidators.createFromProjectSource",
      payload: { sourcePath: "project:/validators/token/index.ts", activate: false },
      projectRequired: true,
    });
    expect(parseCommand("validator test project-token", { projectId: "prj", projectPath: "project:/" })).toEqual({
      type: "validator-test",
      reference: "project-token",
    });
    expect(parseCommand("project archive", { projectId: "prj", projectPath: "project:/" })).toEqual({
      type: "request",
      operation: "projects.archive",
      payload: {},
      projectRequired: true,
    });
    expect(parseCommand("tools list support --version av_1", { projectId: "prj", projectPath: "project:/" })).toEqual({
      type: "request",
      operation: "tools.list",
      payload: { agent: "support", agentVersionId: "av_1" },
      projectRequired: true,
    });
  });
});

test("config default collects the first global LLM without exposing the API key", async () => {
  const calls: unknown[] = [];
  const prompts: string[] = [];
  const answers = ["deepseek", ""];
  const output: string[] = [];
  const requester: CliRequester = {
    async connect() {}, close() {},
    async request(operation, payload, options) {
      calls.push({ operation, payload, options });
      if (operation === "providers.catalog") return [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", description: "OpenAI" }, { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", description: "DeepSeek", defaultModel: "deepseek-v4-pro" }] as never;
      return { configured: true } as never;
    },
  };
  const cli = new MarcusCli(requester, {
    terminal: true,
    output: { write(value) { output.push(value); } },
    async readText(prompt) { prompts.push(prompt); return answers.shift()!; },
    async readSecret(prompt) { prompts.push(prompt); return "private-api-key"; },
  });

  expect(await cli.execute("config default")).toEqual({ configured: true });
  expect(calls).toEqual([
    { operation: "providers.catalog", payload: {}, options: undefined },
    {
      operation: "configuration.defaultLlm.set",
      payload: { catalogId: "deepseek", provider: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: "private-api-key", model: "deepseek-v4-pro" },
      options: undefined,
    },
  ]);
  expect(prompts).toHaveLength(3);
  expect(output.join("" )).not.toContain("private-api-key");
});

test("Project context is client-local and added to each request", async () => {
  const calls: unknown[] = [];
  const requester: CliRequester = {
    async connect() {}, close() {},
    async request(operation, payload, options) {
      calls.push({ operation, payload, options });
      if (operation === "projects.list") return [{ projectId: "prj-1", slug: "demo" }] as never;
      return [] as never;
    },
  };
  const cli = new MarcusCli(requester);
  await cli.execute("use project demo");
  await cli.execute("agent list");
  expect(calls[1]).toEqual({ operation: "agents.list", payload: {}, options: { projectId: "prj-1" } });
});

test("startup LLM check reads the agent.default model role from doctor", async () => {
  const calls: unknown[] = [];
  let configured = false;
  const requester: CliRequester = {
    async connect() {}, close() {},
    async request(operation, payload, options) {
      calls.push({ operation, payload, options });
      return { modelRoles: { "agent.default": configured } } as never;
    },
  };

  expect(await hasDefaultLlmConfigured(requester)).toBeFalse();
  configured = true;
  expect(await hasDefaultLlmConfigured(requester)).toBeTrue();
  expect(calls).toEqual([
    { operation: "system.doctor", payload: {}, options: undefined },
    { operation: "system.doctor", payload: {}, options: undefined },
  ]);
});

test("one-shot bootstrap gives terminal users an Enter-confirmed password prompt", async () => {
  const calls: unknown[] = [];
  const prompts: unknown[] = [];
  const requester: CliRequester = {
    async connect() {}, close() {},
    async request(operation, payload, options) {
      calls.push({ operation, payload, options });
      return { created: true } as never;
    },
  };
  const cli = new MarcusCli(requester, {
    terminal: true,
    async readSecret(prompt, interactive) {
      prompts.push({ prompt, interactive });
      return "correct horse battery staple";
    },
  });

  await cli.execute("bootstrap setup --username admin");

  expect(prompts).toEqual([{
    prompt: 'Enter a password for administrator "admin" (press Enter to confirm): ',
    interactive: true,
  }]);
  expect(calls).toEqual([{
    operation: "bootstrap.setup",
    payload: { username: "admin", password: "correct horse battery staple" },
    options: undefined,
  }]);
});

const ptyTest = process.platform === "linux" && existsSync("/usr/bin/script") ? test : test.skip;

ptyTest("one-shot secret input releases an otherwise open terminal", async () => {
  const fixture = resolve(import.meta.dir, "../test-fixtures/one-shot-secret.ts");
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const child = Bun.spawn(["/usr/bin/script", "-qec", `${quote(process.execPath)} ${quote(fixture)}`, "/dev/null"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutText = new Response(child.stdout).text();
  child.stdin.write("temporary-test-value\r");
  await child.stdin.flush();

  let timedOut = false;
  const exitCode = await Promise.race([
    child.exited,
    Bun.sleep(2_000).then(() => { timedOut = true; return -1; }),
  ]);
  if (timedOut) child.kill();
  child.stdin.end();

  expect(timedOut).toBeFalse();
  expect(exitCode).toBe(0);
  expect(await stdoutText).toContain('{"ok":true}');
});
