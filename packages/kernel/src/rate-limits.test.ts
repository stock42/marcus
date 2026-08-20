import { expect, test } from "bun:test";
import type { RateLimitRule } from "@marcus/contracts";
import { RateLimitManager, type RateLimitPersistence } from "./rate-limits";

test("persists fixed-window consumption across manager restart", () => {
  const state = new Map<string, unknown>();
  const persistence: RateLimitPersistence = { get: (key) => state.get(key), set: (key, value) => { state.set(key, value); } };
  const rule: RateLimitRule = { name: "api", scope: "principal", algorithm: "fixed-window", limit: 1, windowMs: 60_000 };
  const context = { projectId: "project", agentId: "agent", entrypoint: "api" as const, principalId: "principal" };

  new RateLimitManager({ now: () => 1_000, persistence }).consume([rule], context);
  expect(() => new RateLimitManager({ now: () => 2_000, persistence }).consume([rule], context)).toThrow("Rate limit api exceeded");
});

test("does not collide same-named rules between agents", () => {
  const manager = new RateLimitManager({ now: () => 1_000 });
  const rule: RateLimitRule = { name: "api", scope: "project", algorithm: "fixed-window", limit: 1, windowMs: 60_000 };
  manager.consume([rule], { projectId: "project", agentId: "agent-a", entrypoint: "api" });
  expect(() => manager.consume([rule], { projectId: "project", agentId: "agent-b", entrypoint: "api" })).not.toThrow();
});
