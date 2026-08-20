import { MarcusError, type AgentHeartbeat, type Health, type ProcessRecord } from "@marcus/contracts";

export interface ProcessHealthPolicy {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}

export class ProcessRegistry {
  private readonly records = new Map<string, ProcessRecord>();
  private readonly heartbeatSequences = new Map<string, number>();

  register(record: ProcessRecord): void {
    if (this.records.has(record.mpid)) {
      throw new MarcusError({ code: "PROCESS_ALREADY_EXISTS", message: `Process ${record.mpid} already exists`, retryable: false });
    }
    this.records.set(record.mpid, structuredClone(record));
  }

  heartbeat(mpid: string, heartbeat: AgentHeartbeat): ProcessRecord {
    const record = this.required(mpid);
    const previous = this.heartbeatSequences.get(heartbeat.instanceId) ?? 0;
    if (heartbeat.sequence <= previous) return structuredClone(record);
    this.heartbeatSequences.set(heartbeat.instanceId, heartbeat.sequence);
    const next: ProcessRecord = {
      ...record,
      state: heartbeat.state,
      health: "healthy",
      lastHeartbeatAt: heartbeat.emittedAt,
      ...(heartbeat.progress === undefined ? {} : { lastProgressAt: heartbeat.emittedAt }),
    };
    this.records.set(mpid, next);
    return structuredClone(next);
  }

  evaluateHealth(nowMs: number, policy: ProcessHealthPolicy): ProcessRecord[] {
    const changed: ProcessRecord[] = [];
    for (const [mpid, record] of this.records) {
      if (record.lastHeartbeatAt === undefined || ["stopped", "failed", "killed"].includes(record.state)) continue;
      const lag = nowMs - Date.parse(record.lastHeartbeatAt);
      const health: Health =
        lag >= policy.heartbeatTimeoutMs ? "unresponsive" : lag >= policy.heartbeatIntervalMs * 2 ? "degraded" : "healthy";
      if (health !== record.health) {
        const next = { ...record, health };
        this.records.set(mpid, next);
        changed.push(structuredClone(next));
      }
    }
    return changed;
  }

  get(mpid: string): ProcessRecord | undefined {
    const record = this.records.get(mpid);
    return record === undefined ? undefined : structuredClone(record);
  }

  list(filter: Partial<Pick<ProcessRecord, "projectId" | "agentId" | "state" | "health">> = {}): ProcessRecord[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          (filter.projectId === undefined || record.projectId === filter.projectId) &&
          (filter.agentId === undefined || record.agentId === filter.agentId) &&
          (filter.state === undefined || record.state === filter.state) &&
          (filter.health === undefined || record.health === filter.health),
      )
      .map((record) => structuredClone(record));
  }

  private required(mpid: string): ProcessRecord {
    const record = this.records.get(mpid);
    if (record === undefined) {
      throw new MarcusError({ code: "PROCESS_NOT_FOUND", message: `Process ${mpid} not found`, retryable: false });
    }
    return record;
  }
}
