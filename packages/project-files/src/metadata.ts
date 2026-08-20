import { MarcusError, createId } from "@marcus/contracts";

export interface ProjectFileMetadata {
  fileId: string;
  projectId: string;
  relativePath: string;
  kind: "file" | "directory" | "symlink";
  size: number;
  mediaType?: string;
  sha256?: string;
  revision: number;
  source: "marcus" | "external-watcher";
  indexStatus: "pending" | "indexed" | "ignored" | "failed";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface CommitMetadataInput {
  projectId: string;
  relativePath: string;
  kind: ProjectFileMetadata["kind"];
  size: number;
  sha256?: string;
  mediaType?: string;
  source: ProjectFileMetadata["source"];
  actorId?: string;
  expectedRevision?: number;
  now: string;
}

export interface ProjectFileMetadataRepository {
  get(projectId: string, relativePath: string): ProjectFileMetadata | undefined;
  commit(input: CommitMetadataInput): ProjectFileMetadata;
  markDeleted(projectId: string, relativePath: string, actorId: string | undefined, now: string): void;
  move(projectId: string, from: string, to: string, actorId: string | undefined, now: string): void;
  list(projectId: string, prefix?: string): ProjectFileMetadata[];
}

export class MemoryProjectFileMetadataRepository implements ProjectFileMetadataRepository {
  private readonly records = new Map<string, ProjectFileMetadata>();

  get(projectId: string, relativePath: string): ProjectFileMetadata | undefined {
    const record = this.records.get(key(projectId, relativePath));
    return record === undefined ? undefined : structuredClone(record);
  }

  commit(input: CommitMetadataInput): ProjectFileMetadata {
    const existing = this.records.get(key(input.projectId, input.relativePath));
    const currentRevision = existing?.revision ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new MarcusError({
        code: "FILE_REVISION_CONFLICT",
        message: `Expected revision ${input.expectedRevision}, current revision is ${currentRevision}`,
        retryable: false,
        details: { expectedRevision: input.expectedRevision, currentRevision, currentSha256: existing?.sha256 ?? null },
      });
    }
    const record: ProjectFileMetadata = {
      fileId: existing?.fileId ?? createId("file"),
      projectId: input.projectId,
      relativePath: input.relativePath,
      kind: input.kind,
      size: input.size,
      revision: currentRevision + 1,
      source: input.source,
      indexStatus: "pending",
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
      ...(input.sha256 === undefined ? {} : { sha256: input.sha256 }),
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      ...(existing?.createdBy === undefined && input.actorId === undefined
        ? {}
        : { createdBy: existing?.createdBy ?? input.actorId! }),
      ...(input.actorId === undefined ? {} : { updatedBy: input.actorId }),
    };
    this.records.set(key(input.projectId, input.relativePath), record);
    return structuredClone(record);
  }

  markDeleted(projectId: string, relativePath: string, actorId: string | undefined, now: string): void {
    const record = this.records.get(key(projectId, relativePath));
    if (record === undefined) return;
    this.records.set(key(projectId, relativePath), {
      ...record,
      revision: record.revision + 1,
      updatedAt: now,
      deletedAt: now,
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    });
  }

  move(projectId: string, from: string, to: string, actorId: string | undefined, now: string): void {
    for (const [recordKey, record] of [...this.records]) {
      if (record.projectId !== projectId || (record.relativePath !== from && !record.relativePath.startsWith(`${from}/`))) continue;
      const suffix = record.relativePath.slice(from.length);
      this.records.delete(recordKey);
      this.records.set(key(projectId, `${to}${suffix}`), {
        ...record,
        relativePath: `${to}${suffix}`,
        revision: record.revision + 1,
        updatedAt: now,
        ...(actorId === undefined ? {} : { updatedBy: actorId }),
      });
    }
  }

  list(projectId: string, prefix = ""): ProjectFileMetadata[] {
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId && record.deletedAt === undefined && record.relativePath.startsWith(prefix))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((record) => structuredClone(record));
  }
}

function key(projectId: string, relativePath: string): string {
  return `${projectId}\0${relativePath}`;
}
