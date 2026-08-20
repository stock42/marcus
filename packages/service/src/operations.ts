import { copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { MarcusError } from "@marcus/contracts";
import { MarcusSqliteDatabase } from "@marcus/storage-sqlite";
import type { MarcusdConfig } from "./daemon";

type BackupFile = { path: string; size: number; sha256: string };
type BackupProject = { projectId: string; slug: string; mode: string; physicalPath: string; included: boolean };

export interface MarcusBackupManifest {
  schemaVersion: "marcus.backup/v1";
  productVersion: string;
  createdAt: string;
  databaseMigration: number;
  protocols: { mnp: 1; agentManifest: "v1"; runtimeHost: 1 };
  projects: BackupProject[];
  files: BackupFile[];
  exclusions: string[];
}

export async function createMarcusBackup(
  config: MarcusdConfig,
  database: MarcusSqliteDatabase,
  destinationInput: string,
): Promise<{ destination: string; manifest: MarcusBackupManifest }> {
  const destination = backupPath(destinationInput);
  assertOutsideDataDirectory(destination, config.dataDir);
  if ((await lstat(destination).catch(() => undefined)) !== undefined) throw operationError("BACKUP_DESTINATION_EXISTS", "Backup destination already exists");
  const partial = `${destination}.partial-${Bun.randomUUIDv7()}`;
  await mkdir(partial, { recursive: false, mode: 0o700 });
  try {
    const integrity = database.integrityCheck();
    if (!integrity.ok) throw operationError("DATABASE_INTEGRITY_FAILED", integrity.messages.join("; "));
    const databaseTarget = resolve(partial, "kernel.db");
    database.raw.query("VACUUM INTO ?").run(databaseTarget);
    const projects = database.raw.query<{
      project_id: string; slug: string; mode: string; physical_path: string;
    }, []>(`SELECT p.project_id, p.slug, h.mode, h.physical_path FROM projects p
      JOIN project_homes h ON h.project_id=p.project_id ORDER BY p.slug`).all();
    const projectRecords: BackupProject[] = [];
    for (const project of projects) {
      const included = project.mode === "managed";
      projectRecords.push({ projectId: project.project_id, slug: project.slug, mode: project.mode, physicalPath: project.physical_path, included });
      if (included) await copyTree(project.physical_path, resolve(partial, "projects", project.slug), [".marcus/uploads"]);
    }
    const buildInfo = await stat(config.buildDir).catch(() => undefined);
    if (buildInfo?.isDirectory()) await copyTree(config.buildDir, resolve(partial, "builds"));
    const files = await inventory(partial);
    const manifest: MarcusBackupManifest = {
      schemaVersion: "marcus.backup/v1",
      productVersion: "0.1.0",
      createdAt: new Date().toISOString(),
      databaseMigration: database.raw.query<{ version: number }, []>("PRAGMA user_version").get()?.version ?? 0,
      protocols: { mnp: 1, agentManifest: "v1", runtimeHost: 1 },
      projects: projectRecords,
      files,
      exclusions: ["secret master key", "bootstrap token", "API service token", "authority lock", "upload staging", "replaceable binaries"],
    };
    await writeFile(resolve(partial, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(partial, destination);
    return { destination, manifest };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyMarcusBackup(sourceInput: string): Promise<MarcusBackupManifest> {
  const source = backupPath(sourceInput);
  const manifest = await Bun.file(resolve(source, "manifest.json")).json() as MarcusBackupManifest;
  if (manifest.schemaVersion !== "marcus.backup/v1" || !Array.isArray(manifest.files) || !Array.isArray(manifest.projects)) {
    throw operationError("BACKUP_MANIFEST_INVALID", "Backup manifest is invalid or unsupported");
  }
  const declared = new Set<string>();
  for (const item of manifest.files) {
    const target = contained(source, item.path);
    declared.add(item.path);
    const info = await stat(target).catch(() => undefined);
    if (info === undefined || !info.isFile() || info.size !== item.size) throw operationError("BACKUP_FILE_INVALID", `Backup file ${item.path} is missing or has the wrong size`);
    const digest = await hashFile(target);
    if (digest !== item.sha256) throw operationError("BACKUP_HASH_MISMATCH", `Backup file ${item.path} failed SHA-256 verification`);
  }
  const actual = (await inventory(source)).map((item) => item.path).filter((path) => path !== "manifest.json");
  if (actual.some((path) => !declared.has(path))) throw operationError("BACKUP_FILE_UNDECLARED", "Backup contains files not declared by its manifest");
  const snapshot = new MarcusSqliteDatabase(resolve(source, "kernel.db"), { readonly: true, create: false, migrate: false });
  try {
    const integrity = snapshot.integrityCheck();
    if (!integrity.ok) throw operationError("BACKUP_DATABASE_INVALID", integrity.messages.join("; "));
  } finally {
    snapshot.close();
  }
  return manifest;
}

export async function restoreMarcusBackup(config: MarcusdConfig, sourceInput: string): Promise<{ restoredFrom: string; recoverySuffix: string }> {
  const lock = await readAuthorityLock(resolve(config.dataDir, "marcusd.lock"));
  if (lock !== undefined) throw operationError("RESTORE_AUTHORITY_RUNNING", `Refusing restore while authority lock exists for PID ${lock.pid ?? "unknown"}`);
  const source = backupPath(sourceInput);
  const manifest = await verifyMarcusBackup(source);
  const suffix = `.pre-restore-${Bun.randomUUIDv7()}`;
  const stagedDatabase = `${config.databasePath}.restore-${Bun.randomUUIDv7()}`;
  const stagedProjects = `${config.projectsDir}.restore-${Bun.randomUUIDv7()}`;
  const stagedBuilds = `${config.buildDir}.restore-${Bun.randomUUIDv7()}`;
  await mkdir(dirname(stagedDatabase), { recursive: true, mode: 0o700 });
  await copyFile(resolve(source, "kernel.db"), stagedDatabase);
  await copyTree(resolve(source, "projects"), stagedProjects).catch((error) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
  await copyTree(resolve(source, "builds"), stagedBuilds).catch((error) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
  const staged = new MarcusSqliteDatabase(stagedDatabase, { readonly: true, create: false, migrate: false });
  try {
    if (!staged.integrityCheck().ok) throw operationError("RESTORE_DATABASE_INVALID", "Staged database failed integrity check");
  } finally {
    staged.close();
  }
  const moved: Array<{ target: string; previous?: string }> = [];
  try {
    for (const [target, replacement] of [[config.databasePath, stagedDatabase], [config.projectsDir, stagedProjects], [config.buildDir, stagedBuilds]] as const) {
      if ((await lstat(replacement).catch(() => undefined)) === undefined) continue;
      const previous = (await lstat(target).catch(() => undefined)) === undefined ? undefined : `${target}${suffix}`;
      if (previous !== undefined) await rename(target, previous);
      await rename(replacement, target);
      moved.push({ target, ...(previous === undefined ? {} : { previous }) });
    }
    for (const suffixName of ["-wal", "-shm"]) await rm(`${config.databasePath}${suffixName}`, { force: true });
    return { restoredFrom: source, recoverySuffix: suffix };
  } catch (error) {
    for (const item of moved.reverse()) {
      await rm(item.target, { recursive: true, force: true });
      if (item.previous !== undefined) await rename(item.previous, item.target);
    }
    throw error;
  } finally {
    await rm(stagedDatabase, { force: true });
    await rm(stagedProjects, { recursive: true, force: true });
    await rm(stagedBuilds, { recursive: true, force: true });
  }
}

async function copyTree(source: string, target: string, exclusions: readonly string[] = [], relativePath = ""): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw operationError("BACKUP_SYMLINK_UNSUPPORTED", `Backup source contains symlink ${relativePath || source}`);
  if (!info.isDirectory()) throw operationError("BACKUP_SOURCE_INVALID", `${source} is not a directory`);
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const childRelative = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
    if (exclusions.some((excluded) => childRelative === excluded || childRelative.startsWith(`${excluded}/`))) continue;
    const from = resolve(source, entry.name);
    const to = resolve(target, entry.name);
    if (entry.isSymbolicLink()) throw operationError("BACKUP_SYMLINK_UNSUPPORTED", `Backup source contains symlink ${childRelative}`);
    if (entry.isDirectory()) await copyTree(from, to, exclusions, childRelative);
    else if (entry.isFile()) {
      await mkdir(dirname(to), { recursive: true, mode: 0o700 });
      await copyFile(from, to);
    } else throw operationError("BACKUP_FILE_TYPE_UNSUPPORTED", `Backup source contains unsupported file ${childRelative}`);
  }
}

async function inventory(root: string): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw operationError("BACKUP_SYMLINK_UNSUPPORTED", `Backup output contains symlink ${relative(root, path)}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const info = await stat(path);
        files.push({ path: relative(root, path).split(sep).join("/"), size: info.size, sha256: await hashFile(path) });
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashFile(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex");
}

function contained(root: string, path: string): string {
  if (path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "")) throw operationError("BACKUP_PATH_INVALID", `Invalid backup path ${path}`);
  const target = resolve(root, path);
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw operationError("BACKUP_PATH_INVALID", `Backup path escapes root: ${path}`);
  return target;
}

function backupPath(input: string): string {
  const value = input.startsWith("server:") ? input.slice("server:".length) : input;
  if (!value.startsWith("/")) throw operationError("BACKUP_PATH_INVALID", "Backup path must be an absolute server path");
  return resolve(value);
}

function assertOutsideDataDirectory(target: string, dataDir: string): void {
  const data = resolve(dataDir);
  if (target === data || target.startsWith(`${data}${sep}`)) throw operationError("BACKUP_DESTINATION_UNSAFE", "Backup destination must be outside the Marcus data directory");
}

async function readAuthorityLock(path: string): Promise<{ pid?: number } | undefined> {
  try { return await Bun.file(path).json() as { pid?: number }; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw operationError("RESTORE_AUTHORITY_LOCK_INVALID", "Authority lock exists but is invalid");
  }
}

function operationError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
