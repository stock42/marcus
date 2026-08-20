import { describe, expect, test } from "bun:test";
import { MarcusError, createId, createTraceContext, isMarcusId } from "./index";

describe("Marcus identifiers", () => {
  test("creates prefixed UUIDv7 identifiers", () => {
    const runId = createId("run");
    expect(isMarcusId(runId, "run")).toBe(true);
    expect(isMarcusId(runId, "agent")).toBe(false);
  });

  test("creates a self-correlated trace", () => {
    const trace = createTraceContext("cause-1");
    expect(trace.traceId).toBe(trace.correlationId);
    expect(trace.causationId).toBe("cause-1");
  });
});

test("MarcusError has a stable JSON representation", () => {
  const error = new MarcusError({
    code: "AGENT_NOT_FOUND",
    message: "Agent not found",
    retryable: false,
    details: { agent: "missing" },
  });

  expect(error.toJSON()).toEqual({
    code: "AGENT_NOT_FOUND",
    message: "Agent not found",
    retryable: false,
    details: { agent: "missing" },
  });
});
