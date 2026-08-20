import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { JsonLineFileLogSink, MemoryLogSink, SafeLogger } from "./index";

test("redacts credentials recursively and attaches trace context", () => {
  const sink = new MemoryLogSink();
  const logger = new SafeLogger({
    source: "test",
    sink,
    context: { traceId: "trace-1" },
    now: () => new Date("2026-08-11T00:00:00Z"),
  });
  logger.info("authenticated", { token: "raw", nested: { password: "raw", safe: "value" } });
  expect(sink.records[0]).toEqual({
    timestamp: "2026-08-11T00:00:00.000Z",
    level: "info",
    source: "test",
    message: "authenticated",
    traceId: "trace-1",
    attributes: { token: "[REDACTED]", nested: { password: "[REDACTED]", safe: "value" } },
  });
});

test("writes redacted JSONL records to a shared file", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-logs-"));
  try {
    const path = resolve(directory, "logs", "all.log");
    const sink = new JsonLineFileLogSink(path);
    const logger = new SafeLogger({ source: "marcus-api", sink });
    logger.error("request.failed", { apiKey: "raw-key", operation: "providers.test" });
    await sink.flush();

    const records = (await Bun.file(path).text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "error",
      source: "marcus-api",
      message: "request.failed",
      attributes: { apiKey: "[REDACTED]", operation: "providers.test" },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
