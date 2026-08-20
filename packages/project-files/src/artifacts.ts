import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createId, type ArtifactRecord } from "@marcus/contracts";
import { ProjectPathResolver } from "./path-resolver";

export interface CreateArtifactInput {
  projectId: string;
  agentId: string;
  agentVersionId: string;
  runId: string;
  taskId?: string;
  name: string;
  mediaType: string;
  bytes: Uint8Array | Blob | string;
  visibility?: ArtifactRecord["visibility"];
}

export class DiskArtifactStore {
  private readonly resolver: ProjectPathResolver;
  private readonly now: () => Date;

  constructor(homePath: string, options: { now?: () => Date } = {}) {
    this.resolver = new ProjectPathResolver(homePath);
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const artifactId = createId("artifact");
    const safeName = sanitizeName(input.name);
    const relativePath = `.marcus/artifacts/${input.agentId}/${input.runId}/${artifactId}/${safeName}`;
    const target = this.resolver.resolve(relativePath, { allowReserved: true });
    const bytes = typeof input.bytes === "string"
      ? new TextEncoder().encode(input.bytes)
      : input.bytes instanceof Uint8Array
        ? input.bytes
        : new Uint8Array(await input.bytes.arrayBuffer());
    await mkdir(dirname(target.physicalPath), { recursive: true });
    const temporary = `${target.physicalPath}.tmp-${Bun.randomUUIDv7()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target.physicalPath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return {
      artifactId,
      projectId: input.projectId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      runId: input.runId,
      name: safeName,
      mediaType: input.mediaType,
      size: bytes.byteLength,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      storageUri: `project:/${relativePath}`,
      visibility: input.visibility ?? "private",
      createdAt: this.now().toISOString(),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    };
  }

  async read(record: ArtifactRecord): Promise<Uint8Array> {
    const path = this.resolver.resolve(record.storageUri, { allowReserved: true });
    return new Uint8Array(await Bun.file(path.physicalPath).arrayBuffer());
  }
}

function sanitizeName(value: string): string {
  const name = basename(value.normalize("NFC"));
  if (name === "" || name === "." || name === ".." || name.includes("\0")) return "artifact.bin";
  return name.replace(/[\u0000-\u001f\u007f]/gu, "_");
}
