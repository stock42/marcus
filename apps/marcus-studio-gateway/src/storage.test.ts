import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { STUDIO_PROTOCOL, type StudioRequestId } from "@marcus/studio-contracts";
import { StudioStore } from "./storage";

test("persists encrypted replay events and enforces the minute quota", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-studio-store-"));
  const path = resolve(directory, "studio.sqlite");
  const key = crypto.getRandomValues(new Uint8Array(32));
  const now = Date.now();
  try {
    const store = new StudioStore(path, key);
    store.createSession("session-one", "ip-one", now, now + 120_000);
    const requestId = "streq_000000000001" as StudioRequestId;
    expect(store.beginRequest({ requestId, sessionId: "session-one", idempotencyKey: "idem-000000000001", inputHash: "hash", now, expiresAt: now + 120_000 })).toEqual({ kind: "created" });
    await store.appendEvent(requestId, {
      protocol: STUDIO_PROTOCOL,
      type: "generation.stage",
      requestId,
      data: { stage: "provider-thinking", message: "private marker must be encrypted" },
    });
    const raw = store.database.query<{ payload: Uint8Array }, []>("SELECT payload FROM studio_events").get();
    expect(Buffer.from(raw!.payload).toString("utf8")).not.toContain("private marker");
    store.close();

    const reopened = new StudioStore(path, key);
    expect(await reopened.eventsAfter(requestId, 0)).toContainEqual(expect.objectContaining({ type: "generation.stage", sequence: 1 }));
    expect(reopened.beginRequest({ requestId, sessionId: "session-one", idempotencyKey: "idem-000000000001", inputHash: "hash", now, expiresAt: now + 120_000 })).toMatchObject({ kind: "replay" });
    for (let index = 0; index < 10; index += 1) {
      expect(reopened.reserveRateLimit({
        requestId: `streq_rate000000${String(index).padStart(2, "0")}` as StudioRequestId,
        sessionId: "session-one",
        ipFingerprint: "ip-one",
        now: now + index,
        limit: 10,
        windowMs: 60_000,
        dailyLimit: 1_000,
      }).allowed).toBe(true);
    }
    const rejected = reopened.reserveRateLimit({
      requestId: "streq_rate00000010" as StudioRequestId,
      sessionId: "session-one",
      ipFingerprint: "ip-one",
      now: now + 10,
      limit: 10,
      windowMs: 60_000,
      dailyLimit: 1_000,
    });
    expect(rejected).toMatchObject({ allowed: false, reason: "minute", quota: { remaining: 0 } });
    reopened.releaseRateLimit("streq_rate00000000" as StudioRequestId);
    expect(reopened.reserveRateLimit({
      requestId: "streq_rate00000011" as StudioRequestId,
      sessionId: "session-one",
      ipFingerprint: "ip-one",
      now: now + 11,
      limit: 10,
      windowMs: 60_000,
      dailyLimit: 1_000,
    }).allowed).toBe(true);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
