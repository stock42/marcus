import type { ProjectFileMetadata, ProjectFileMetadataRepository, CommitMetadataInput } from "@marcus/project-files";
import { MarcusError, createId } from "@marcus/contracts";
import type { MarcusSqliteDatabase } from "./database";

type Row = {
  file_id: string;
  project_id: string;
  relative_path: string;
  kind: ProjectFileMetadata["kind"];
  size: number;
  media_type: string | null;
  sha256: string | null;
  revision: number;
  source: ProjectFileMetadata["source"];
  index_status: ProjectFileMetadata["indexStatus"];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export class SqliteProjectFileMetadataRepository implements ProjectFileMetadataRepository {
  constructor(private readonly database: MarcusSqliteDatabase) {}

  get(projectId: string, relativePath: string): ProjectFileMetadata | undefined {
    const row = this.database.raw
      .query<Row, [string, string]>("SELECT * FROM project_files WHERE project_id = ? AND relative_path = ?")
      .get(projectId, relativePath);
    return row === null ? undefined : map(row);
  }

  commit(input: CommitMetadataInput): ProjectFileMetadata {
    return this.database.transaction(() => {
      const existing = this.get(input.projectId, input.relativePath);
      const revision = existing?.revision ?? 0;
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
        throw new MarcusError({
          code: "FILE_REVISION_CONFLICT",
          message: `Expected revision ${input.expectedRevision}, current revision is ${revision}`,
          retryable: false,
          details: { expectedRevision: input.expectedRevision, currentRevision: revision, currentSha256: existing?.sha256 ?? null },
        });
      }
      const fileId = existing?.fileId ?? createId("file");
      const next = revision + 1;
      this.database.raw.query(`
        INSERT INTO project_files(file_id, project_id, relative_path, kind, size, media_type, sha256, revision, source, index_status, created_at, updated_at, deleted_at, created_by, updated_by, last_indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?, ?, NULL)
        ON CONFLICT(project_id, relative_path) DO UPDATE SET
          kind=excluded.kind, size=excluded.size, media_type=excluded.media_type, sha256=excluded.sha256,
          revision=excluded.revision, source=excluded.source, index_status='pending', updated_at=excluded.updated_at,
          deleted_at=NULL, updated_by=excluded.updated_by
      `).run(
        fileId, input.projectId, input.relativePath, input.kind, input.size, input.mediaType ?? null,
        input.sha256 ?? null, next, input.source, input.now, input.now, input.actorId ?? null, input.actorId ?? null,
      );
      this.database.raw.query("INSERT INTO file_revisions(file_id, revision, sha256, size, actor_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(fileId, next, input.sha256 ?? null, input.size, input.actorId ?? null, input.source, input.now);
      return this.get(input.projectId, input.relativePath)!;
    });
  }

  markDeleted(projectId: string, relativePath: string, actorId: string | undefined, now: string): void {
    this.database.raw.query("UPDATE project_files SET revision=revision+1, deleted_at=?, updated_at=?, updated_by=? WHERE project_id=? AND relative_path=?")
      .run(now, now, actorId ?? null, projectId, relativePath);
  }

  move(projectId: string, from: string, to: string, actorId: string | undefined, now: string): void {
    const rows = this.database.raw.query<{ relative_path: string }, [string, string, string]>(`SELECT relative_path FROM project_files
      WHERE project_id=? AND (relative_path=? OR relative_path LIKE ?) ORDER BY length(relative_path)`).all(projectId, from, `${from}/%`);
    for (const row of rows) {
      const destination = `${to}${row.relative_path.slice(from.length)}`;
      this.database.raw.query("UPDATE project_files SET relative_path=?, revision=revision+1, updated_at=?, updated_by=? WHERE project_id=? AND relative_path=?")
        .run(destination, now, actorId ?? null, projectId, row.relative_path);
    }
  }

  list(projectId: string, prefix = ""): ProjectFileMetadata[] {
    return this.database.raw
      .query<Row, [string, string]>("SELECT * FROM project_files WHERE project_id = ? AND relative_path LIKE ? AND deleted_at IS NULL ORDER BY relative_path")
      .all(projectId, `${prefix}%`)
      .map(map);
  }
}

function map(row: Row): ProjectFileMetadata {
  return {
    fileId: row.file_id,
    projectId: row.project_id,
    relativePath: row.relative_path,
    kind: row.kind,
    size: row.size,
    revision: row.revision,
    source: row.source,
    indexStatus: row.index_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.media_type === null ? {} : { mediaType: row.media_type }),
    ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
    ...(row.created_by === null ? {} : { createdBy: row.created_by }),
    ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  };
}
