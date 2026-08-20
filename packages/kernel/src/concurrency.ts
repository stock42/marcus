import { MarcusError, type ConcurrencyPolicy } from "@marcus/contracts";

export interface ConcurrencyContext {
  runId: string;
  agentId: string;
  principalId?: string;
  conversationId?: string;
}

interface Lease extends ConcurrencyContext {
  acquiredAtMs: number;
}

export class ConcurrencyManager {
  private readonly leases = new Map<string, Lease>();
  private readonly queued = new Set<string>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  preflight(policy: ConcurrencyPolicy | undefined): void {
    if (policy?.queueLimit !== undefined && this.queued.size >= policy.queueLimit) {
      throw new MarcusError({ code: "QUEUE_FULL", message: "Agent queue is full", retryable: true });
    }
  }

  queue(runId: string): void {
    this.queued.add(runId);
  }

  tryAcquire(context: ConcurrencyContext, policy: ConcurrencyPolicy | undefined): boolean {
    const active = [...this.leases.values()].filter((lease) => lease.agentId === context.agentId);
    const blocked =
      (policy?.total !== undefined && active.length >= policy.total) ||
      (policy?.perPrincipal !== undefined &&
        context.principalId !== undefined &&
        active.filter((lease) => lease.principalId === context.principalId).length >= policy.perPrincipal) ||
      (policy?.perConversation !== undefined &&
        context.conversationId !== undefined &&
        active.filter((lease) => lease.conversationId === context.conversationId).length >= policy.perConversation);
    if (blocked) {
      if ((policy?.saturation ?? "queue") === "reject") {
        throw new MarcusError({ code: "CONCURRENCY_LIMITED", message: "Agent concurrency limit reached", retryable: true });
      }
      return false;
    }
    this.queued.delete(context.runId);
    this.leases.set(context.runId, { ...context, acquiredAtMs: this.now() });
    return true;
  }

  release(runId: string): void {
    this.leases.delete(runId);
    this.queued.delete(runId);
  }

  get activeCount(): number {
    return this.leases.size;
  }

  get queuedCount(): number {
    return this.queued.size;
  }
}
