import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { MarcusError } from "@marcus/contracts";
import {
  MemoryProjectFileMetadataRepository,
  type ProjectFileMetadata,
  type ProjectFileMetadataRepository,
} from "./metadata";
import { ProjectPathResolver } from "./path-resolver";

export interface WriteProjectFileOptions {
  expectedRevision?: number;
  expectedSha256?: string;
  mediaType?: string;
  actorId?: string;
}

export interface ProjectFileStoreOptions {
  projectId: string;
  projectSlug: string;
  homePath: string;
  metadata?: ProjectFileMetadataRepository;
  now?: () => Date;
}

export class DiskProjectFileStore {
  readonly projectId: string;
  readonly resolver: ProjectPathResolver;
  readonly metadata: ProjectFileMetadataRepository;
  private readonly now: () => Date;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: ProjectFileStoreOptions) {
    this.projectId = options.projectId;
    this.resolver = new ProjectPathResolver(options.homePath, { projectSlug: options.projectSlug });
    this.metadata = options.metadata ?? new MemoryProjectFileMetadataRepository();
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await mkdir(this.resolver.homePath, { recursive: true });
    for (const path of ["artifacts", "builds", "cache", "uploads", "trash", "locks", "tmp"]) {
      await mkdir(join(this.resolver.homePath, ".marcus", path), { recursive: true });
    }
  }

  async read(path: string, range?: { start: number; end?: number }): Promise<Uint8Array> {
    const resolved = this.resolver.resolve(path);
    const file = Bun.file(resolved.physicalPath);
    if (!(await file.exists())) throw fileError("FILE_NOT_FOUND", `File ${resolved.logicalPath} not found`);
    if (range === undefined) return new Uint8Array(await file.arrayBuffer());
    const size = file.size;
    const start = Math.max(0, range.start);
    const end = Math.min(size, range.end ?? size);
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }

  async stat(path: string): Promise<ProjectFileMetadata> {
    const resolved = this.resolver.resolve(path);
    const info = await lstat(resolved.physicalPath).catch(() => undefined);
    if (info === undefined) throw fileError("FILE_NOT_FOUND", `File ${resolved.logicalPath} not found`);
    const kind = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file";
    const sha256 = kind === "file"
      ? new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(resolved.physicalPath).arrayBuffer())).digest("hex")
      : undefined;
    const existing = this.metadata.get(this.projectId, resolved.relativePath);
    if (existing !== undefined && existing.deletedAt === undefined && existing.kind === kind && existing.size === info.size && existing.sha256 === sha256) return existing;
    return this.metadata.commit({
      projectId: this.projectId,
      relativePath: resolved.relativePath,
      kind,
      size: info.size,
      source: "external-watcher",
      now: this.now().toISOString(),
      ...(sha256 === undefined ? {} : { sha256 }),
    });
  }

  stream(path: string, range?: { start: number; end?: number }): ReadableStream<Uint8Array> {
    const resolved = this.resolver.resolve(path);
    const stream = createReadStream(resolved.physicalPath, {
      ...(range?.start === undefined ? {} : { start: range.start }),
      ...(range?.end === undefined ? {} : { end: range.end - 1 }),
    });
    return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  }

  async write(path: string, input: Uint8Array | string | Blob, options: WriteProjectFileOptions = {}): Promise<ProjectFileMetadata> {
    return this.withMutation(() => this.writeUnlocked(path, input, options));
  }

  private async writeUnlocked(
    path: string,
    input: Uint8Array | string | Blob,
    options: WriteProjectFileOptions,
  ): Promise<ProjectFileMetadata> {
    const resolved = this.resolver.resolve(path);
    if (resolved.relativePath === "") throw fileError("FILE_PATH_INVALID", "Cannot write the Project root");
    const bytes = await toBytes(input);
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const current = this.metadata.get(this.projectId, resolved.relativePath);
    if (options.expectedSha256 !== undefined && current?.sha256 !== options.expectedSha256) {
      throw fileError("FILE_REVISION_CONFLICT", "Expected hash does not match current file metadata", {
        expectedSha256: options.expectedSha256,
        currentSha256: current?.sha256 ?? null,
      });
    }
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw fileError("FILE_REVISION_CONFLICT", "Expected revision does not match current file metadata", {
        expectedRevision: options.expectedRevision,
        currentRevision: current?.revision ?? 0,
      });
    }
    await mkdir(dirname(resolved.physicalPath), { recursive: true });
    this.resolver.resolve(resolved.relativePath);
    const tempPath = join(dirname(resolved.physicalPath), `.${basename(resolved.physicalPath)}.marcus-${Bun.randomUUIDv7()}.tmp`);
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tempPath, resolved.physicalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return this.metadata.commit({
      projectId: this.projectId,
      relativePath: resolved.relativePath,
      kind: "file",
      size: bytes.byteLength,
      sha256,
      source: "marcus",
      now: this.now().toISOString(),
      ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
      ...(options.mediaType === undefined ? {} : { mediaType: options.mediaType }),
      ...(options.actorId === undefined ? {} : { actorId: options.actorId }),
    });
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async mkdir(path: string, actorId?: string): Promise<ProjectFileMetadata> {
    const resolved = this.resolver.resolve(path);
    await mkdir(resolved.physicalPath, { recursive: true });
    return this.metadata.commit({
      projectId: this.projectId,
      relativePath: resolved.relativePath,
      kind: "directory",
      size: 0,
      source: "marcus",
      now: this.now().toISOString(),
      ...(actorId === undefined ? {} : { actorId }),
    });
  }

  async list(path = "project:/"): Promise<ProjectFileMetadata[]> {
    const resolved = this.resolver.resolve(path);
    const entries = await readdir(resolved.physicalPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw fileError("FILE_NOT_FOUND", `Directory ${resolved.logicalPath} not found`);
      throw error;
    });
    const output: ProjectFileMetadata[] = [];
    for (const entry of entries) {
      if (resolved.relativePath === "" && entry.name === ".marcus") continue;
      const relativePath = [resolved.relativePath, entry.name].filter(Boolean).join("/");
      const physicalPath = join(resolved.physicalPath, entry.name);
      const stat = await lstat(physicalPath);
      const existing = this.metadata.get(this.projectId, relativePath);
      const kind = entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "file";
      const record = existing ?? this.metadata.commit({
        projectId: this.projectId,
        relativePath,
        kind,
        size: stat.size,
        source: "external-watcher",
        now: this.now().toISOString(),
      });
      output.push(record);
    }
    return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  async move(from: string, to: string, actorId?: string): Promise<void> {
    const source = this.resolver.resolve(from);
    const destination = this.resolver.resolve(to);
    await mkdir(dirname(destination.physicalPath), { recursive: true });
    this.resolver.resolve(destination.relativePath);
    await rename(source.physicalPath, destination.physicalPath);
    this.metadata.move(this.projectId, source.relativePath, destination.relativePath, actorId, this.now().toISOString());
  }

  async copy(from: string, to: string, actorId?: string): Promise<ProjectFileMetadata> {
    const source = this.resolver.resolve(from);
    const destination = this.resolver.resolve(to);
    if (destination.relativePath === source.relativePath || destination.relativePath.startsWith(`${source.relativePath}/`)) {
      throw fileError("FILE_COPY_RECURSIVE", "Destination cannot be inside the source path");
    }
    if (await lstat(destination.physicalPath).catch(() => undefined) !== undefined) {
      throw fileError("FILE_ALREADY_EXISTS", `Destination ${destination.logicalPath} already exists`);
    }
    await this.copyNode(source.relativePath, destination.relativePath, actorId);
    return this.stat(destination.logicalPath);
  }

  private async copyNode(sourcePath: string, destinationPath: string, actorId?: string): Promise<void> {
    const source = this.resolver.resolve(sourcePath);
    const info = await lstat(source.physicalPath).catch(() => undefined);
    if (info === undefined) throw fileError("FILE_NOT_FOUND", `File ${source.logicalPath} not found`);
    if (info.isSymbolicLink()) throw fileError("FILE_SYMLINK_FORBIDDEN", "Copying symbolic links is not supported");
    if (info.isDirectory()) {
      await this.mkdir(destinationPath, actorId);
      for (const entry of await readdir(source.physicalPath, { withFileTypes: true })) {
        await this.copyNode(`${sourcePath}/${entry.name}`, `${destinationPath}/${entry.name}`, actorId);
      }
      return;
    }
    await this.write(destinationPath, new Uint8Array(await Bun.file(source.physicalPath).arrayBuffer()), actorId === undefined ? {} : { actorId });
  }

  async trash(path: string, actorId?: string): Promise<{ trashId: string; originalPath: string; storedPath: string }> {
    const source = this.resolver.resolve(path);
    const trashId = `trash_${Bun.randomUUIDv7().replaceAll("-", "")}`;
    const storedRelative = `.marcus/trash/${trashId}/${source.relativePath}`;
    const destination = this.resolver.resolve(storedRelative, { allowReserved: true });
    await mkdir(dirname(destination.physicalPath), { recursive: true });
    await rename(source.physicalPath, destination.physicalPath);
    this.metadata.markDeleted(this.projectId, source.relativePath, actorId, this.now().toISOString());
    return { trashId, originalPath: source.relativePath, storedPath: storedRelative };
  }

  async restore(storedPath: string, originalPath: string, actorId?: string): Promise<ProjectFileMetadata> {
    const source = this.resolver.resolve(storedPath, { allowReserved: true });
    const destination = this.resolver.resolve(originalPath);
    if (await lstat(source.physicalPath).catch(() => undefined) === undefined) throw fileError("TRASH_ENTRY_MISSING", "Stored trash content is missing");
    if (await lstat(destination.physicalPath).catch(() => undefined) !== undefined) throw fileError("FILE_ALREADY_EXISTS", `Destination ${destination.logicalPath} already exists`);
    await mkdir(dirname(destination.physicalPath), { recursive: true });
    await rename(source.physicalPath, destination.physicalPath);
    const restored = await this.stat(destination.logicalPath);
    if (actorId !== undefined) {
      return this.metadata.commit({
        projectId: restored.projectId,
        relativePath: restored.relativePath,
        kind: restored.kind,
        size: restored.size,
        source: "marcus",
        now: this.now().toISOString(),
        actorId,
        ...(restored.sha256 === undefined ? {} : { sha256: restored.sha256 }),
        ...(restored.mediaType === undefined ? {} : { mediaType: restored.mediaType }),
      });
    }
    return restored;
  }

  async reconcile(): Promise<{ scanned: number; changed: number }> {
    const seen = new Set<string>();
    let scanned = 0;
    let changed = 0;
    const visit = async (relativePath: string): Promise<void> => {
      const resolved = this.resolver.resolve(relativePath);
      for (const entry of await readdir(resolved.physicalPath, { withFileTypes: true })) {
        if (relativePath === "" && entry.name === ".marcus") continue;
        const child = [relativePath, entry.name].filter(Boolean).join("/");
        seen.add(child);
        scanned += 1;
        const before = this.metadata.get(this.projectId, child);
        const after = await this.stat(child);
        if (before === undefined || before.revision !== after.revision) changed += 1;
        if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(child);
      }
    };
    await visit("");
    const now = this.now().toISOString();
    for (const record of this.metadata.list(this.projectId)) {
      if (record.relativePath === "" || seen.has(record.relativePath)) continue;
      this.metadata.markDeleted(this.projectId, record.relativePath, undefined, now);
      changed += 1;
    }
    return { scanned, changed };
  }

  async purge(path: string): Promise<void> {
    const resolved = this.resolver.resolve(path);
    if (resolved.relativePath === "") throw fileError("FILE_PATH_INVALID", "Cannot purge Project root");
    await rm(resolved.physicalPath, { recursive: true, force: false });
    this.metadata.markDeleted(this.projectId, resolved.relativePath, undefined, this.now().toISOString());
  }

  async search(query: string, options: { path?: string; maxFiles?: number; maxBytesPerFile?: number } = {}): Promise<Array<{ path: string; line: number; text: string }>> {
    const start = this.resolver.resolve(options.path ?? "project:/");
    const maxFiles = options.maxFiles ?? 1_000;
    const maxBytes = options.maxBytesPerFile ?? 1024 * 1024;
    const results: Array<{ path: string; line: number; text: string }> = [];
    const needle = query.toLowerCase();
    let inspected = 0;
    for await (const entry of walk(start.physicalPath)) {
      if (inspected >= maxFiles) break;
      inspected += 1;
      const file = Bun.file(entry);
      if (file.size > maxBytes) continue;
      let text: string;
      try {
        text = await file.text();
      } catch {
        continue;
      }
      text.split("\n").forEach((line, index) => {
        if (line.toLowerCase().includes(needle)) {
          results.push({ path: `project:/${entry.slice(this.resolver.homePath.length + 1).replaceAll("\\", "/")}`, line: index + 1, text: line });
        }
      });
    }
    return results;
  }
}

async function toBytes(input: Uint8Array | string | Blob): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (typeof input === "string") return new TextEncoder().encode(input);
  return new Uint8Array(await input.arrayBuffer());
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".marcus" || entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function fileError(code: string, message: string, details?: Record<string, string | number | null>): MarcusError {
  return new MarcusError({ code, message, retryable: false, ...(details === undefined ? {} : { details }) });
}
