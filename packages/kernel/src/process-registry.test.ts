import { expect, test } from "bun:test";
import { ProcessRegistry } from "./process-registry";

test("distinguishes heartbeat liveness from progress and marks timeout", () => {
  const registry = new ProcessRegistry();
  registry.register({
    mpid: "m-1",
    processType: "worker",
    instanceId: "ins-1",
    state: "running",
    health: "unknown",
    startedAt: "1970-01-01T00:00:00.000Z",
  });
  registry.heartbeat("m-1", {
    instanceId: "ins-1",
    sequence: 1,
    emittedAt: "1970-01-01T00:00:01.000Z",
    state: "waiting",
    waitReason: "external-api",
  });
  expect(registry.get("m-1")?.lastProgressAt).toBeUndefined();
  expect(registry.evaluateHealth(22_000, { heartbeatIntervalMs: 5_000, heartbeatTimeoutMs: 20_000 })[0]?.health).toBe(
    "unresponsive",
  );
});
