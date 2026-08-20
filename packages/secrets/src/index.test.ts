import { describe, expect, test } from "bun:test";
import { MarcusSqliteDatabase } from "@marcus/storage-sqlite";
import { SecretStore } from "./index";

describe("SecretStore", () => {
  test("encrypts values at rest, resolves them, and never exposes plaintext in metadata", async () => {
    const database = new MarcusSqliteDatabase(":memory:");
    const key = SecretStore.generateMasterKey();
    const store = new SecretStore(database, key);
    const metadata = await store.set("provider.token", "super-secret");
    expect(JSON.stringify(metadata)).not.toContain("super-secret");
    const raw = database.raw.query<{ encrypted_value: Uint8Array }, []>("SELECT encrypted_value FROM secrets").get();
    expect(new TextDecoder().decode(raw!.encrypted_value)).not.toContain("super-secret");
    expect(await store.resolve("provider.token")).toBe("super-secret");
    database.close();
  });

  test("binds ciphertext to name and project and fails closed with the wrong key", async () => {
    const database = new MarcusSqliteDatabase(":memory:");
    const store = new SecretStore(database, SecretStore.generateMasterKey());
    await store.set("token", "value");
    const wrong = new SecretStore(database, SecretStore.generateMasterKey());
    await expect(wrong.resolve("token")).rejects.toMatchObject({ code: "SECRETS_MASTER_KEY_INVALID" });
    database.close();
  });

  test("revoked values cannot be resolved", async () => {
    const database = new MarcusSqliteDatabase(":memory:");
    const store = new SecretStore(database, SecretStore.generateMasterKey());
    await store.set("token", "value");
    expect(store.revoke("token").status).toBe("revoked");
    await expect(store.resolve("token")).rejects.toMatchObject({ code: "SECRET_NOT_FOUND" });
    database.close();
  });

  test("updates a global secret without creating duplicate rows", async () => {
    const database = new MarcusSqliteDatabase(":memory:");
    const store = new SecretStore(database, SecretStore.generateMasterKey());
    const original = await store.set("provider.token", "first-value");
    const updated = await store.set("provider.token", "second-value");

    expect(updated.secretId).toBe(original.secretId);
    expect(await store.resolve("provider.token")).toBe("second-value");
    expect(database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM secrets WHERE project_id IS NULL AND name = 'provider.token'").get()?.count).toBe(1);
    database.close();
  });
});
