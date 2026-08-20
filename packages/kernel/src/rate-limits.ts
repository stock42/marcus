import { MarcusError, type EntrypointType, type RateLimitRule } from "@marcus/contracts";

export interface RateLimitContext {
  projectId: string;
  agentId: string;
  entrypoint: EntrypointType;
  connectionId?: string;
  principalId?: string;
  conversationId?: string;
  ip?: string;
  customKeys?: Readonly<Record<string, string>>;
}

export interface RateLimitDecision {
  allowed: boolean;
  rule: string;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterMs?: number;
}

interface TokenBucket {
  tokens: number;
  updatedAtMs: number;
}

export interface RateLimitPersistence {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export class RateLimitManager {
  private readonly fixedCounters = new Map<string, number>();
  private readonly rollingEvents = new Map<string, number[]>();
  private readonly tokenBuckets = new Map<string, TokenBucket>();
  private readonly now: () => number;
  private readonly persistence: RateLimitPersistence | undefined;

  constructor(options: { now?: () => number; persistence?: RateLimitPersistence } = {}) {
    this.now = options.now ?? Date.now;
    this.persistence = options.persistence;
  }

  consume(rules: readonly RateLimitRule[], context: RateLimitContext): RateLimitDecision[] {
    const now = this.now();
    const applicable = rules.filter(
      (rule) => rule.entrypoints === undefined || rule.entrypoints.includes(context.entrypoint),
    );
    const pending: Array<{ rule: RateLimitRule; key: string; decision: RateLimitDecision }> = [];
    for (const rule of applicable) {
      const key = `${context.agentId}:${rule.name}:${resolveScopeKey(rule, context)}`;
      const decision = this.peek(rule, key, now);
      if (!decision.allowed) {
        throw new MarcusError({
          code: "RATE_LIMITED",
          message: `Rate limit ${rule.name} exceeded`,
          retryable: true,
          details: {
            rule: rule.name,
            limit: rule.limit,
            remaining: 0,
            resetAtMs: decision.resetAtMs,
            retryAfterMs: decision.retryAfterMs ?? 0,
          },
        });
      }
      pending.push({ rule, key, decision });
    }
    for (const item of pending) this.commit(item.rule, item.key, now);
    return pending.map((item) => item.decision);
  }

  private peek(rule: RateLimitRule, key: string, now: number): RateLimitDecision {
    switch (rule.algorithm) {
      case "fixed-window": {
        const start = Math.floor(now / rule.windowMs) * rule.windowMs;
        const counterKey = `${key}:${start}`;
        const count = this.fixedCounters.get(counterKey) ?? numberState(this.persistence?.get(`fixed:${counterKey}`));
        return decision(rule, count < rule.limit, rule.limit - count - 1, start + rule.windowMs, now);
      }
      case "rolling-window": {
        const threshold = now - rule.windowMs;
        const values = (this.rollingEvents.get(key) ?? numberArrayState(this.persistence?.get(`rolling:${key}`))).filter((value) => value > threshold);
        return decision(rule, values.length < rule.limit, rule.limit - values.length - 1, values[0] ?? now + rule.windowMs, now);
      }
      case "token-bucket": {
        const capacity = rule.burst ?? rule.limit;
        const bucket = this.refill(rule, this.tokenBuckets.get(key) ?? tokenBucketState(this.persistence?.get(`bucket:${key}`)) ?? { tokens: capacity, updatedAtMs: now }, now);
        const wait = bucket.tokens >= 1 ? 0 : Math.ceil((1 - bucket.tokens) / (rule.limit / rule.windowMs));
        return {
          allowed: bucket.tokens >= 1,
          rule: rule.name,
          limit: capacity,
          remaining: Math.max(0, Math.floor(bucket.tokens - 1)),
          resetAtMs: now + wait,
          ...(wait === 0 ? {} : { retryAfterMs: wait }),
        };
      }
    }
  }

  private commit(rule: RateLimitRule, key: string, now: number): void {
    switch (rule.algorithm) {
      case "fixed-window": {
        const start = Math.floor(now / rule.windowMs) * rule.windowMs;
        const counterKey = `${key}:${start}`;
        const value = (this.fixedCounters.get(counterKey) ?? numberState(this.persistence?.get(`fixed:${counterKey}`))) + 1;
        this.fixedCounters.set(counterKey, value);
        this.persistence?.set(`fixed:${counterKey}`, value);
        break;
      }
      case "rolling-window": {
        const threshold = now - rule.windowMs;
        const events = (this.rollingEvents.get(key) ?? numberArrayState(this.persistence?.get(`rolling:${key}`))).filter((value) => value > threshold);
        events.push(now);
        this.rollingEvents.set(key, events);
        this.persistence?.set(`rolling:${key}`, events);
        break;
      }
      case "token-bucket": {
        const capacity = rule.burst ?? rule.limit;
        const bucket = this.refill(rule, this.tokenBuckets.get(key) ?? tokenBucketState(this.persistence?.get(`bucket:${key}`)) ?? { tokens: capacity, updatedAtMs: now }, now);
        const next = { tokens: Math.max(0, bucket.tokens - 1), updatedAtMs: now };
        this.tokenBuckets.set(key, next);
        this.persistence?.set(`bucket:${key}`, next);
      }
    }
  }

  private refill(rule: RateLimitRule, bucket: TokenBucket, now: number): TokenBucket {
    const capacity = rule.burst ?? rule.limit;
    const refillPerMs = rule.limit / rule.windowMs;
    return { tokens: Math.min(capacity, bucket.tokens + (now - bucket.updatedAtMs) * refillPerMs), updatedAtMs: now };
  }
}

function numberState(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function numberArrayState(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function tokenBucketState(value: unknown): TokenBucket | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const state = value as Partial<TokenBucket>;
  return typeof state.tokens === "number" && typeof state.updatedAtMs === "number" ? { tokens: state.tokens, updatedAtMs: state.updatedAtMs } : undefined;
}

function resolveScopeKey(rule: RateLimitRule, context: RateLimitContext): string {
  switch (rule.scope) {
    case "project":
      return context.projectId;
    case "agent":
      return context.agentId;
    case "connection":
      return required(rule, context.connectionId);
    case "principal":
      return required(rule, context.principalId);
    case "conversation":
      return required(rule, context.conversationId);
    case "ip":
      return required(rule, context.ip);
    case "custom":
      return required(rule, context.customKeys?.[rule.name]);
  }
}

function required(rule: RateLimitRule, value: string | undefined): string {
  if (value !== undefined && value.length > 0) return value;
  throw new MarcusError({
    code: "RATE_LIMIT_KEY_UNRESOLVED",
    message: `Rate limit ${rule.name} requires ${rule.scope} identity`,
    retryable: false,
  });
}

function decision(
  rule: RateLimitRule,
  allowed: boolean,
  remaining: number,
  resetAtMs: number,
  now: number,
): RateLimitDecision {
  return {
    allowed,
    rule: rule.name,
    limit: rule.limit,
    remaining: Math.max(0, remaining),
    resetAtMs,
    ...(allowed ? {} : { retryAfterMs: Math.max(0, resetAtMs - now) }),
  };
}
