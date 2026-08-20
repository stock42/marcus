import { afterEach, describe, expect, test } from "bun:test";
import { createId, type JsonValue } from "@marcus/contracts";
import { ProcessRuntimeController, RuntimeHostController, RuntimeMessageType, type RuntimeInvocation } from "./index";

const controllers: RuntimeHostController[] = [];
const processControllers: ProcessRuntimeController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.close()));
  await Promise.all(processControllers.splice(0).map((controller) => controller.close()));
});

test("process profile executes in a dedicated OS process", async () => {
  const controller = new ProcessRuntimeController({ requestTimeoutMs: 4_000 });
  processControllers.push(controller);
  const instanceId = createId("instance");
  await controller.loadArtifact(instanceId, fixturePath());
  await controller.startInstance(instanceId);
  const parentPid = process.pid;

  const result = await controller.invoke(invocation(instanceId, { mode: "echo", value: "process" }));

  expect(result.output).toEqual({ value: "process" });
  expect(controller.osPid).not.toBe(parentPid);
});

describe("Runtime Host isolation", () => {
  test("loads an artifact in a Worker and bridges managed capabilities", async () => {
    const events: string[] = [];
    const controller = makeController({
      onEvent: (event) => events.push(event.type),
      handlers: {
        [RuntimeMessageType.TOOL_CALL]: (envelope) => {
          const payload = envelope.payload as { tool: string };
          return { kind: "execute", toolCallId: `test-${payload.tool}`, timeoutMs: 1_000 };
        },
        [RuntimeMessageType.TOOL_RESULT]: () => ({ recorded: true }),
      },
    });
    const instanceId = createId("instance");
    await controller.loadArtifact(instanceId, fixturePath());
    await controller.startInstance(instanceId);

    const result = await controller.invoke(invocation(instanceId, { mode: "tool", value: "marcus" }));

    expect(result.output).toEqual({ value: "MARCUS" });
    expect(events).toContain(RuntimeMessageType.LOG);
    expect(events).toContain(RuntimeMessageType.PROGRESS);
    expect(controller.osPid).toBeGreaterThan(0);
  });

  test("terminates a Worker that ignores cooperative cancellation", async () => {
    const controller = makeController();
    const instanceId = createId("instance");
    await controller.loadArtifact(instanceId, fixturePath());
    await controller.startInstance(instanceId);
    const request = invocation(instanceId, { mode: "hang", value: "never" });

    const result = controller.invoke(request);
    await Bun.sleep(50);
    await controller.cancelRun(request.runId, "test cancellation", 50);

    await expect(result).rejects.toMatchObject({ code: "RUN_KILLED" });
  });

  test("loads custom authentication without running the agent lifecycle", async () => {
    const controller = makeController();
    const instanceId = createId("instance");
    await controller.loadArtifact(instanceId, `${import.meta.dir}/fixtures/auth-agent.ts`);
    await controller.startInstance(instanceId, { authOnly: true });

    const result = await controller.validateAuthentication(instanceId, {
      project: { id: createId("project"), slug: "runtime-tests" },
      agent: { id: createId("agent"), versionId: createId("agentVersion") },
      request: { method: "POST", path: "/agents/auth-runtime-test", headers: {} },
      credential: { scheme: "test", token: "accepted" },
    });

    expect(result).toEqual({ authenticated: true, principal: { id: "external-test", type: "external" } });
  });

  test("loads a reusable auth validator artifact in auth-only mode", async () => {
    const controller = makeController();
    const instanceId = createId("instance");
    await controller.loadArtifact(instanceId, `${import.meta.dir}/fixtures/auth-validator.ts`);
    await controller.startInstance(instanceId, { authOnly: true });

    const result = await controller.validateAuthentication(instanceId, {
      project: { id: createId("project"), slug: "runtime-tests" },
      agent: { id: "validator-runtime", versionId: "validator-version-runtime" },
      request: { method: "POST", path: "/agents/registered", headers: {} },
      credential: { scheme: "bearer", token: "accepted" },
    });

    expect(result).toEqual({ authenticated: true, principal: { id: "registered-external", type: "external" } });
  });
});

function makeController(options: ConstructorParameters<typeof RuntimeHostController>[0] = {}): RuntimeHostController {
  const controller = new RuntimeHostController({ requestTimeoutMs: 4_000, ...options });
  controllers.push(controller);
  return controller;
}

function fixturePath(): string {
  return `${import.meta.dir}/fixtures/test-agent.ts`;
}

function invocation(instanceId: string, input: JsonValue): RuntimeInvocation {
  return {
    instanceId,
    runId: createId("run"),
    project: { id: createId("project"), slug: "runtime-tests", homePath: import.meta.dir },
    agent: { id: createId("agent"), versionId: createId("agentVersion") },
    entrypoint: "cli",
    input,
  };
}
