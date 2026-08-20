import { MarcusError } from "@marcus/contracts";
import type { MarcusSqliteDatabase } from "@marcus/storage-sqlite";

const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT_VERSION = 1;

export interface SecretMetadata {
  secretId: string;
  projectId?: string;
  name: string;
  keyVersion: number;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
}

type SecretRow = {
  secret_id: string;
  project_id: string | null;
  name: string;
  encrypted_value: Uint8Array;
  key_version: number;
  status: "active" | "revoked";
  created_at: string;
  updated_at: string;
};

export class SecretStore {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(private readonly database: MarcusSqliteDatabase, masterKey: Uint8Array) {
    if (masterKey.byteLength !== KEY_BYTES) throw secretError("SECRETS_MASTER_KEY_INVALID", "Secrets master key must contain exactly 32 bytes");
    this.keyPromise = crypto.subtle.importKey("raw", ownedBuffer(masterKey), "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  static decodeMasterKey(value: string): Uint8Array {
    try {
      const bytes = new Uint8Array(Buffer.from(value.trim(), "base64"));
      if (bytes.byteLength !== KEY_BYTES) throw new Error("length");
      return bytes;
    } catch {
      throw secretError("SECRETS_MASTER_KEY_INVALID", "Secrets master key must be base64 for exactly 32 bytes");
    }
  }

  static generateMasterKey(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  }

  async set(name: string, value: string, projectId?: string): Promise<SecretMetadata> {
    validateName(name);
    if (value.length === 0) throw secretError("SECRET_VALUE_EMPTY", "Secret value cannot be empty");
    const now = new Date().toISOString();
    const existing = this.getRow(name, projectId);
    const encrypted = await this.encrypt(value, projectId, name);
    const secretId = existing?.secret_id ?? `secret_${Bun.randomUUIDv7()}`;
    if (existing === undefined) {
      this.database.raw.query(`
        INSERT INTO secrets(secret_id, project_id, name, encrypted_value, key_version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(secretId, projectId ?? null, name, encrypted, FORMAT_VERSION, now, now);
    } else {
      this.database.raw.query(`
        UPDATE secrets SET encrypted_value = ?, key_version = ?, status = 'active', updated_at = ?
        WHERE secret_id = ?
      `).run(encrypted, FORMAT_VERSION, now, existing.secret_id);
    }
    return this.requiredMetadata(name, projectId);
  }

  async resolve(name: string, projectId?: string): Promise<string> {
    const row = this.getRow(name, projectId) ?? (projectId === undefined ? undefined : this.getRow(name, undefined));
    if (row === undefined || row.status !== "active") throw secretError("SECRET_NOT_FOUND", `Secret ${name} is not active`);
    if (row.key_version !== FORMAT_VERSION) throw secretError("SECRET_KEY_VERSION_UNSUPPORTED", `Secret ${name} uses unsupported key version ${row.key_version}`);
    return this.decrypt(row.encrypted_value, row.project_id ?? undefined, row.name);
  }

  list(projectId?: string): SecretMetadata[] {
    const rows = projectId === undefined
      ? this.database.raw.query<SecretRow, []>("SELECT * FROM secrets ORDER BY project_id, name").all()
      : this.database.raw.query<SecretRow, [string]>("SELECT * FROM secrets WHERE project_id = ? OR project_id IS NULL ORDER BY project_id, name").all(projectId);
    return rows.map(mapMetadata);
  }

  show(name: string, projectId?: string): SecretMetadata {
    return this.requiredMetadata(name, projectId);
  }

  revoke(name: string, projectId?: string): SecretMetadata {
    const result = this.database.raw.query("UPDATE secrets SET status = 'revoked', updated_at = ? WHERE name = ? AND project_id IS ?")
      .run(new Date().toISOString(), name, projectId ?? null);
    if (result.changes !== 1) throw secretError("SECRET_NOT_FOUND", `Secret ${name} was not found`);
    return this.requiredMetadata(name, projectId);
  }

  private getRow(name: string, projectId?: string): SecretRow | undefined {
    return this.database.raw.query<SecretRow, [string, string | null]>("SELECT * FROM secrets WHERE name = ? AND project_id IS ?")
      .get(name, projectId ?? null) ?? undefined;
  }

  private requiredMetadata(name: string, projectId?: string): SecretMetadata {
    const row = this.getRow(name, projectId);
    if (row === undefined) throw secretError("SECRET_NOT_FOUND", `Secret ${name} was not found`);
    return mapMetadata(row);
  }

  private async encrypt(value: string, projectId: string | undefined, name: string): Promise<Uint8Array> {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ownedBuffer(nonce), additionalData: ownedBuffer(associatedData(projectId, name)), tagLength: 128 },
      await this.keyPromise,
      new TextEncoder().encode(value),
    );
    const encoded = new Uint8Array(1 + NONCE_BYTES + cipher.byteLength);
    encoded[0] = FORMAT_VERSION;
    encoded.set(nonce, 1);
    encoded.set(new Uint8Array(cipher), 1 + NONCE_BYTES);
    return encoded;
  }

  private async decrypt(encoded: Uint8Array, projectId: string | undefined, name: string): Promise<string> {
    if (encoded.byteLength <= 1 + NONCE_BYTES || encoded[0] !== FORMAT_VERSION) {
      throw secretError("SECRET_CIPHERTEXT_INVALID", `Secret ${name} has an invalid ciphertext`);
    }
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ownedBuffer(encoded.slice(1, 1 + NONCE_BYTES)), additionalData: ownedBuffer(associatedData(projectId, name)), tagLength: 128 },
        await this.keyPromise,
        encoded.slice(1 + NONCE_BYTES),
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw secretError("SECRETS_MASTER_KEY_INVALID", `Secret ${name} could not be decrypted with the configured master key`);
    }
  }
}

function associatedData(projectId: string | undefined, name: string): Uint8Array {
  return new TextEncoder().encode(`marcus.secret/v1\0${projectId ?? "system"}\0${name}`);
}

function ownedBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function mapMetadata(row: SecretRow): SecretMetadata {
  return {
    secretId: row.secret_id,
    name: row.name,
    keyVersion: row.key_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

function validateName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u.test(name)) throw secretError("SECRET_NAME_INVALID", "Secret name is invalid");
}

function secretError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
