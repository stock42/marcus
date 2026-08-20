import { Database } from "bun:sqlite";
import type { StudioQuota, StudioRequestId, StudioServerEvent } from "@marcus/studio-contracts";

type SessionRow = {
  session_id: string;
  ip_fingerprint: string;
  expires_at: number;
};

type RequestRow = {
  request_id: string;
  session_id: string;
  idempotency_key: string;
  input_hash: string;
  status: "running" | "completed" | "failed";
  last_sequence: number;
};

type EventRow = { sequence: number; payload: Uint8Array };

export type BeginStudioRequestResult =
  | { kind: "created" }
  | { kind: "replay"; requestId: StudioRequestId; status: RequestRow["status"] }
  | { kind: "conflict" };

export class StudioStore {
  readonly database: Database;
  private readonly cipher: StudioEventCipher;

  constructor(path: string, encryptionKey: Uint8Array) {
    this.database = new Database(path, { create: true, strict: true });
    this.database.run("PRAGMA foreign_keys = ON");
    this.database.run("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.database.run("PRAGMA journal_mode = WAL");
    this.database.run("PRAGMA synchronous = NORMAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS studio_sessions (
        session_id TEXT PRIMARY KEY,
        ip_fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS studio_requests (
        request_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES studio_sessions(session_id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE(session_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS studio_events (
        request_id TEXT NOT NULL REFERENCES studio_requests(request_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        payload BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(request_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS studio_rate_calls (
        subject TEXT NOT NULL,
        request_id TEXT NOT NULL,
        called_at INTEGER NOT NULL,
        PRIMARY KEY(subject, request_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS studio_rate_calls_subject_time ON studio_rate_calls(subject, called_at);
      CREATE INDEX IF NOT EXISTS studio_requests_expiry ON studio_requests(expires_at);
      CREATE INDEX IF NOT EXISTS studio_sessions_expiry ON studio_sessions(expires_at);
    `);
    this.cipher = new StudioEventCipher(encryptionKey);
  }

  createSession(sessionId: string, ipFingerprint: string, now: number, expiresAt: number): void {
    this.cleanup(now);
    this.database.query(`
      INSERT INTO studio_sessions(session_id, ip_fingerprint, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, ipFingerprint, now, now, expiresAt);
  }

  getSession(sessionId: string, now: number): SessionRow | undefined {
    const row = this.database.query<SessionRow, [string]>(`
      SELECT session_id, ip_fingerprint, expires_at FROM studio_sessions WHERE session_id = ?
    `).get(sessionId) ?? undefined;
    if (row === undefined || row.expires_at <= now) return undefined;
    this.database.query("UPDATE studio_sessions SET last_seen_at = ? WHERE session_id = ?").run(now, sessionId);
    return row;
  }

  beginRequest(options: {
    requestId: StudioRequestId;
    sessionId: string;
    idempotencyKey: string;
    inputHash: string;
    now: number;
    expiresAt: number;
  }): BeginStudioRequestResult {
    const existing = this.database.query<RequestRow, [string, string]>(`
      SELECT request_id, session_id, idempotency_key, input_hash, status, last_sequence
      FROM studio_requests WHERE session_id = ? AND idempotency_key = ?
    `).get(options.sessionId, options.idempotencyKey) ?? undefined;
    if (existing !== undefined) {
      if (existing.request_id !== options.requestId || existing.input_hash !== options.inputHash) return { kind: "conflict" };
      return { kind: "replay", requestId: existing.request_id as StudioRequestId, status: existing.status };
    }
    this.database.query(`
      INSERT INTO studio_requests(request_id, session_id, idempotency_key, input_hash, status, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(options.requestId, options.sessionId, options.idempotencyKey, options.inputHash, options.now, options.now, options.expiresAt);
    return { kind: "created" };
  }

  async appendEvent(requestId: StudioRequestId, event: Omit<StudioServerEvent, "sequence" | "emittedAt">): Promise<StudioServerEvent> {
    const row = this.database.query<{ last_sequence: number }, [string]>("SELECT last_sequence FROM studio_requests WHERE request_id = ?").get(requestId);
    if (row === null) throw new Error(`Unknown Studio request ${requestId}`);
    const sequence = row.last_sequence + 1;
    const complete = { ...event, requestId, sequence, emittedAt: new Date().toISOString() } as StudioServerEvent;
    const payload = await this.cipher.encrypt(requestId, sequence, complete);
    const now = Date.now();
    this.database.transaction(() => {
      const updated = this.database.query("UPDATE studio_requests SET last_sequence = ?, updated_at = ? WHERE request_id = ? AND last_sequence = ?")
        .run(sequence, now, requestId, row.last_sequence);
      if (updated.changes !== 1) throw new Error(`Concurrent Studio event sequence for ${requestId}`);
      this.database.query("INSERT INTO studio_events(request_id, sequence, payload, created_at) VALUES (?, ?, ?, ?)")
        .run(requestId, sequence, payload, now);
    })();
    return complete;
  }

  async eventsAfter(requestId: StudioRequestId, afterSequence: number): Promise<StudioServerEvent[]> {
    const rows = this.database.query<EventRow, [string, number]>(`
      SELECT sequence, payload FROM studio_events WHERE request_id = ? AND sequence > ? ORDER BY sequence
    `).all(requestId, afterSequence);
    const events: StudioServerEvent[] = [];
    for (const row of rows) events.push(await this.cipher.decrypt(requestId, row.sequence, row.payload));
    return events;
  }

  requestBelongsToSession(requestId: StudioRequestId, sessionId: string): boolean {
    return this.database.query<{ found: number }, [string, string]>(`
      SELECT 1 AS found FROM studio_requests WHERE request_id = ? AND session_id = ?
    `).get(requestId, sessionId)?.found === 1;
  }

  markRequest(requestId: StudioRequestId, status: "completed" | "failed"): void {
    this.database.query("UPDATE studio_requests SET status = ?, updated_at = ? WHERE request_id = ?")
      .run(status, Date.now(), requestId);
  }

  reserveRateLimit(options: {
    requestId: StudioRequestId;
    sessionId: string;
    ipFingerprint: string;
    now: number;
    limit: number;
    windowMs: number;
    dailyLimit: number;
  }): { allowed: boolean; quota: StudioQuota; reason?: "minute" | "daily" } {
    return this.database.transaction(() => {
      const cutoff = options.now - options.windowMs;
      const dayCutoff = options.now - 86_400_000;
      this.database.query("DELETE FROM studio_rate_calls WHERE called_at < ?").run(dayCutoff);
      const subjects = [`session:${options.sessionId}`, `ip:${options.ipFingerprint}`];
      const counts = subjects.map((subject) => ({
        subject,
        count: this.database.query<{ count: number }, [string, number]>(`
          SELECT COUNT(*) AS count FROM studio_rate_calls WHERE subject = ? AND called_at > ?
        `).get(subject, cutoff)?.count ?? 0,
        oldest: this.database.query<{ called_at: number }, [string, number]>(`
          SELECT called_at FROM studio_rate_calls WHERE subject = ? AND called_at > ? ORDER BY called_at LIMIT 1
        `).get(subject, cutoff)?.called_at,
      }));
      const constrained = counts.reduce((left, right) => left.count >= right.count ? left : right);
      if (constrained.count >= options.limit) {
        const retryAfterMs = Math.max(1, (constrained.oldest ?? options.now) + options.windowMs - options.now);
        return {
          allowed: false,
          reason: "minute" as const,
          quota: { limit: options.limit, remaining: 0, windowMs: options.windowMs, retryAfterMs },
        };
      }
      const dailyCount = this.database.query<{ count: number }, [number]>(`
        SELECT COUNT(*) AS count FROM studio_rate_calls WHERE subject = 'global' AND called_at > ?
      `).get(dayCutoff)?.count ?? 0;
      if (dailyCount >= options.dailyLimit) {
        return {
          allowed: false,
          reason: "daily" as const,
          quota: { limit: options.limit, remaining: 0, windowMs: options.windowMs, retryAfterMs: 60_000 },
        };
      }
      for (const subject of [...subjects, "global"]) {
        this.database.query("INSERT OR IGNORE INTO studio_rate_calls(subject, request_id, called_at) VALUES (?, ?, ?)")
          .run(subject, options.requestId, options.now);
      }
      return {
        allowed: true,
        quota: {
          limit: options.limit,
          remaining: Math.max(0, options.limit - constrained.count - 1),
          windowMs: options.windowMs,
          retryAfterMs: 0,
        },
      };
    })();
  }

  quota(sessionId: string, ipFingerprint: string, now: number, limit: number, windowMs: number): StudioQuota {
    const cutoff = now - windowMs;
    const subjects = [`session:${sessionId}`, `ip:${ipFingerprint}`];
    const rows = subjects.map((subject) => ({
      count: this.database.query<{ count: number }, [string, number]>("SELECT COUNT(*) AS count FROM studio_rate_calls WHERE subject = ? AND called_at > ?")
        .get(subject, cutoff)?.count ?? 0,
      oldest: this.database.query<{ called_at: number }, [string, number]>("SELECT called_at FROM studio_rate_calls WHERE subject = ? AND called_at > ? ORDER BY called_at LIMIT 1")
        .get(subject, cutoff)?.called_at,
    }));
    const constrained = rows.reduce((left, right) => left.count >= right.count ? left : right);
    return {
      limit,
      remaining: Math.max(0, limit - constrained.count),
      windowMs,
      retryAfterMs: constrained.count >= limit ? Math.max(1, (constrained.oldest ?? now) + windowMs - now) : 0,
    };
  }

  releaseRateLimit(requestId: StudioRequestId): void {
    this.database.query("DELETE FROM studio_rate_calls WHERE request_id = ?").run(requestId);
  }

  cleanup(now: number): void {
    this.database.transaction(() => {
      this.database.query("DELETE FROM studio_requests WHERE expires_at <= ?").run(now);
      this.database.query("DELETE FROM studio_sessions WHERE expires_at <= ?").run(now);
      this.database.query("DELETE FROM studio_rate_calls WHERE called_at < ?").run(now - 86_400_000);
    })();
  }

  close(): void {
    this.database.close();
  }
}

class StudioEventCipher {
  private readonly key: Promise<CryptoKey>;

  constructor(masterKey: Uint8Array) {
    if (masterKey.byteLength !== 32) throw new Error("Studio encryption key must contain exactly 32 bytes");
    this.key = crypto.subtle.importKey("raw", Uint8Array.from(masterKey).buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async encrypt(requestId: string, sequence: number, value: StudioServerEvent): Promise<Uint8Array> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: Uint8Array.from(nonce).buffer,
      additionalData: associatedData(requestId, sequence),
    }, await this.key, new TextEncoder().encode(JSON.stringify(value)));
    const result = new Uint8Array(1 + nonce.byteLength + cipher.byteLength);
    result[0] = 1;
    result.set(nonce, 1);
    result.set(new Uint8Array(cipher), 13);
    return result;
  }

  async decrypt(requestId: string, sequence: number, value: Uint8Array): Promise<StudioServerEvent> {
    if (value[0] !== 1 || value.byteLength <= 29) throw new Error("Invalid Studio event ciphertext");
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: Uint8Array.from(value.slice(1, 13)).buffer,
      additionalData: associatedData(requestId, sequence),
    }, await this.key, value.slice(13));
    return JSON.parse(new TextDecoder().decode(plaintext)) as StudioServerEvent;
  }
}

function associatedData(requestId: string, sequence: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${requestId}\0${sequence}\0marcus.studio.event/v1`);
}
