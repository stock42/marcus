import { Database } from "bun:sqlite";
import { MarcusError } from "@marcus/contracts";
import { migrations, type SqliteMigration } from "./migrations";

export interface MarcusSqliteOptions {
  readonly?: boolean;
  create?: boolean;
  busyTimeoutMs?: number;
  migrate?: boolean;
}

export class MarcusSqliteDatabase {
  readonly raw: Database;
  readonly path: string;

  constructor(path: string, options: MarcusSqliteOptions = {}) {
    this.path = path;
    this.raw = new Database(path, {
      readonly: options.readonly ?? false,
      create: options.create ?? !options.readonly,
      strict: true,
    });
    this.raw.run("PRAGMA foreign_keys = ON");
    this.raw.run(`PRAGMA busy_timeout = ${Math.max(0, options.busyTimeoutMs ?? 5_000)}`);
    if (path !== ":memory:" && !options.readonly) this.raw.run("PRAGMA journal_mode = WAL");
    this.raw.run("PRAGMA synchronous = NORMAL");
    if ((options.migrate ?? true) && !options.readonly) this.migrate();
  }

  migrate(available: readonly SqliteMigration[] = migrations): void {
    this.raw.run(`
      CREATE TABLE IF NOT EXISTS marcus_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    const current = this.raw
      .query<{ version: number }, []>("SELECT COALESCE(MAX(version), 0) AS version FROM marcus_migrations")
      .get()?.version ?? 0;
    const ordered = [...available].sort((left, right) => left.version - right.version);
    for (const migration of ordered) {
      if (migration.version <= current) continue;
      const previous = ordered.find((candidate) => candidate.version === migration.version - 1);
      if (migration.version !== 1 && previous === undefined) {
        throw new MarcusError({
          code: "DATABASE_MIGRATION_GAP",
          message: `Migration ${migration.version} has no predecessor`,
          retryable: false,
        });
      }
      this.raw.transaction(() => {
        this.raw.exec(migration.sql);
        this.raw
          .query("INSERT INTO marcus_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, new Date().toISOString());
        this.raw.run(`PRAGMA user_version = ${migration.version}`);
      })();
    }
  }

  transaction<T>(callback: () => T): T {
    return this.raw.transaction(callback)();
  }

  integrityCheck(): { ok: boolean; messages: string[] } {
    const rows = this.raw.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
    const messages = rows.map((row) => row.integrity_check);
    return { ok: messages.length === 1 && messages[0] === "ok", messages };
  }

  close(): void {
    this.raw.close();
  }
}
