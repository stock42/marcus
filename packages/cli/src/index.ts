import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { MarcusError, type JsonValue } from "@marcus/contracts";
import { MnpClient, type MnpClientOptions } from "@marcus/protocol-client";
import { parseCommand, type CliContext, type ParsedCommand } from "./parser";

export { parseCommand, projectPath, tokenize, type CliContext, type ParsedCommand } from "./parser";

export interface CliRequester {
  connect(): Promise<unknown>;
  request<TData = JsonValue>(operation: string, payload: JsonValue, options?: { projectId?: string; idempotencyKey?: string }): Promise<TData>;
  close(): void;
}

export interface MarcusCliOptions {
  client: CliRequester;
  output?: { write(value: string): unknown };
  json?: boolean;
  terminal?: boolean;
  readSecret?: (prompt: string, interactive: boolean) => Promise<string>;
  readText?: (prompt: string, interactive: boolean) => Promise<string>;
}

const llmMissingMessage = `LLM: not configured
Marcus cannot run AI agents until the agent.default model role is assigned.
Run this interactive assistant to configure the global default LLM:
  config default
`;

export async function hasDefaultLlmConfigured(client: CliRequester): Promise<boolean> {
  const diagnosis = await client.request<JsonValue>("system.doctor", {});
  if (typeof diagnosis !== "object" || diagnosis === null || Array.isArray(diagnosis)) return false;
  const modelRoles = diagnosis.modelRoles;
  return typeof modelRoles === "object"
    && modelRoles !== null
    && !Array.isArray(modelRoles)
    && modelRoles["agent.default"] === true;
}

export class MarcusCli {
  readonly context: CliContext = { projectPath: "project:/" };
  private readonly output: { write(value: string): unknown };
  private readonly json: boolean;
  private readonly terminal: boolean;
  private readonly readSecret: NonNullable<MarcusCliOptions["readSecret"]>;
  private readonly readText: NonNullable<MarcusCliOptions["readText"]>;
  private exitRequested = false;
  private interactive = false;

  constructor(private readonly client: CliRequester, options: Omit<MarcusCliOptions, "client"> = {}) {
    this.output = options.output ?? stdout;
    this.json = options.json ?? false;
    this.terminal = options.terminal ?? stdin.isTTY === true;
    this.readSecret = options.readSecret ?? readHidden;
    this.readText = options.readText ?? readTextInput;
  }

  close(): void {
    this.client.close();
  }

  async execute(line: string): Promise<JsonValue | undefined> {
    const command = parseCommand(line, this.context);
    if (command === undefined) return undefined;
    if (command.type === "local") return this.local(command.action);
    if (command.type === "change-directory") {
      this.requireProject();
      await this.client.request("files.list", { path: command.path }, { projectId: this.context.projectId! });
      this.context.projectPath = command.path.endsWith("/") ? command.path : `${command.path}/`;
      return { path: this.context.projectPath };
    }
    if (command.type === "upload-file") return this.uploadFile(command.localPath, command.projectPath);
    if (command.type === "download-file") return this.downloadFile(command.projectPath, command.localPath);
    if (command.type === "sync-directory") return this.syncDirectory(command.localPath, command.projectPath, command);
    if (command.type === "scaffold-agent") return this.scaffoldAgent(command.localPath, command.kind);
    if (command.type === "bootstrap-setup") {
      const password = await this.readSecret(
        `Enter a password for administrator "${command.username}" (press Enter to confirm): `,
        this.interactive || this.terminal,
      );
      return this.client.request("bootstrap.setup", { username: command.username, password });
    }
    if (command.type === "configure-default-llm") return this.configureDefaultLlm();
    if (command.type === "secret-set") {
      const value = await this.readSecret("Secret value (press Enter to confirm): ", this.interactive || this.terminal);
      return this.client.request("secrets.set", { name: command.name, value }, this.context.projectId === undefined ? {} : { projectId: this.context.projectId });
    }
    if (command.type === "user-create") {
      const password = await this.readSecret("New password (press Enter to confirm): ", this.interactive || this.terminal);
      return this.client.request("users.create", { username: command.username, password, systemAdmin: command.systemAdmin });
    }
    if (command.type === "validator-test") {
      this.requireProject();
      const credential = await this.readSecret("Validator credential (press Enter to confirm): ", this.interactive || this.terminal);
      return this.client.request("authValidators.test", { validator: command.reference, credential }, { projectId: this.context.projectId });
    }
    if (command.type === "use-project") {
      const projects = await this.client.request<Array<{ projectId: string; slug: string }>>("projects.list", {});
      const project = projects.find((candidate) => candidate.projectId === command.reference || candidate.slug === command.reference);
      if (project === undefined) throw new MarcusError({ code: "PROJECT_NOT_FOUND", message: `Project ${command.reference} not found`, retryable: false });
      this.context.projectId = project.projectId;
      this.context.projectSlug = project.slug;
      this.context.projectPath = "project:/";
      return project as unknown as JsonValue;
    }
    if (command.projectRequired === true && this.context.projectId === undefined) {
      throw new MarcusError({ code: "CLI_PROJECT_REQUIRED", message: "Select a Project with: use project <slug>", retryable: false });
    }
    return this.client.request(command.operation, command.payload, {
      ...(this.context.projectId === undefined ? {} : { projectId: this.context.projectId }),
      ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
    });
  }

  async repl(): Promise<void> {
    await this.client.connect();
    this.interactive = true;
    this.output.write("Marcus CLI 0.1.0 · MNP/1\nType help for commands.\n");
    try {
      this.output.write(await hasDefaultLlmConfigured(this.client) ? "LLM: configured (agent.default)\n" : llmMissingMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.write(`LLM configuration check unavailable: ${message}\n`);
    }
    try {
      while (!this.exitRequested) {
        const prompt = this.context.projectSlug === undefined ? "marcus> " : `marcus[${this.context.projectSlug}:${this.context.projectPath}]> `;
        const readline = createInterface({ input: stdin, output: stdout, terminal: true });
        let line: string;
        try { line = await readline.question(prompt); }
        catch { readline.close(); break; }
        readline.close();
        try {
          const result = await this.execute(line);
          if (result !== undefined) this.render(result);
        } catch (error) {
          this.renderError(error);
        }
      }
    } finally {
      this.interactive = false;
      this.client.close();
    }
  }

  render(value: JsonValue): void {
    this.output.write(`${this.json ? JSON.stringify(value) : human(value)}\n`);
  }

  renderError(error: unknown): void {
    const value = error instanceof MarcusError ? error.toJSON() : { code: "CLI_ERROR", message: error instanceof Error ? error.message : String(error), retryable: false };
    this.output.write(`${this.json ? JSON.stringify({ ok: false, error: value }) : `${value.code}: ${value.message}`}\n`);
  }

  private local(action: "help" | "exit" | "context" | "clear"): JsonValue | undefined {
    if (action === "exit") { this.exitRequested = true; return undefined; }
    if (action === "clear") { this.output.write("\u001bc"); return undefined; }
    if (action === "context") return { projectId: this.context.projectId ?? null, projectSlug: this.context.projectSlug ?? null, path: this.context.projectPath };
    this.output.write(`${helpText}\n`);
    return undefined;
  }

  private requireProject(): asserts this is this & { context: CliContext & { projectId: string } } {
    if (this.context.projectId === undefined) throw new MarcusError({ code: "CLI_PROJECT_REQUIRED", message: "Select a Project with: use project <slug>", retryable: false });
  }

  private async configureDefaultLlm(): Promise<JsonValue> {
    const interactive = this.interactive || this.terminal;
    if (!interactive) throw new MarcusError({ code: "CLI_INTERACTIVE_REQUIRED", message: "config default requires an interactive terminal", retryable: false });
    this.output.write("Configure the global default LLM (agent.default).\n");
    const catalog = await this.client.request<Array<{ id: string; name: string; baseUrl: string; description: string; defaultModel?: string }>>("providers.catalog", {});
    if (catalog.length === 0) throw new MarcusError({ code: "PROVIDER_CATALOG_EMPTY", message: "Marcus has no provider presets available", retryable: false });
    this.output.write(`${catalog.map((entry) => `  ${entry.id.padEnd(10)} ${entry.name} · ${entry.description}`).join("\n")}\n`);
    const provider = requiredPromptValue(await this.readText(`Provider (${catalog.map((entry) => entry.id).join("/")}): `, interactive), "Provider").toLowerCase();
    const selected = catalog.find((entry) => entry.id === provider);
    if (selected === undefined) throw new MarcusError({ code: "PROVIDER_CATALOG_NOT_FOUND", message: `Provider ${provider} is not in the Marcus catalog`, retryable: false });
    const apiKey = await this.readSecret("API key (press Enter to confirm): ", interactive);
    const modelInput = await this.readText(`Default model name${selected.defaultModel === undefined ? "" : ` [${selected.defaultModel}]`}: `, interactive);
    const model = modelInput.trim() === "" && selected.defaultModel !== undefined ? selected.defaultModel : requiredPromptValue(modelInput, "Model name");
    return this.client.request("configuration.defaultLlm.set", { catalogId: selected.id, provider: selected.id, baseUrl: selected.baseUrl, apiKey, model });
  }

  private async uploadFile(localPath: string, projectPath: string, expectedRevision?: number): Promise<JsonValue> {
    this.requireProject();
    const source = resolve(localPath);
    const info = await lstat(source).catch(() => undefined);
    if (info === undefined || !info.isFile() || info.isSymbolicLink()) throw new MarcusError({ code: "CLI_LOCAL_FILE_INVALID", message: `Local source is not a regular file: ${localPath}`, retryable: false });
    const bytes = new Uint8Array(await Bun.file(source).arrayBuffer());
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const opened = await this.client.request<{ uploadId: string; chunkSize: number }>("uploads.open", {
      destination: projectPath,
      fileName: basename(source),
      purpose: "project-file",
      size: bytes.byteLength,
      sha256,
    }, { projectId: this.context.projectId });
    try {
      const chunkSize = Math.max(1, Math.min(opened.chunkSize, 262_144));
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const chunk = bytes.slice(offset, offset + chunkSize);
        await this.client.request("uploads.chunk", { uploadId: opened.uploadId, offset, data: chunk.toBase64(), sha256: new Bun.CryptoHasher("sha256").update(chunk).digest("hex") }, { projectId: this.context.projectId });
      }
      return await this.client.request("uploads.commit", {
        uploadId: opened.uploadId,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }, { projectId: this.context.projectId });
    } catch (error) {
      await this.client.request("uploads.abort", { uploadId: opened.uploadId }, { projectId: this.context.projectId }).catch(() => undefined);
      throw error;
    }
  }

  private async downloadFile(projectPath: string, localPath: string): Promise<JsonValue> {
    this.requireProject();
    const response = await this.client.request<{ encoding: string; data: string; size: number }>("files.read", { path: projectPath }, { projectId: this.context.projectId });
    if (response.encoding !== "base64") throw new MarcusError({ code: "CLI_DOWNLOAD_ENCODING_UNSUPPORTED", message: `Unsupported encoding ${response.encoding}`, retryable: false });
    const destination = resolve(localPath);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, Buffer.from(response.data, "base64"));
    return { localPath: destination, projectPath, size: response.size };
  }

  private async syncDirectory(
    localPath: string,
    projectPath: string,
    options: Extract<ParsedCommand, { type: "sync-directory" }>,
  ): Promise<JsonValue> {
    this.requireProject();
    if (options.watch && options.dryRun) throw new MarcusError({ code: "CLI_SYNC_OPTIONS_INVALID", message: "--watch and --dry-run cannot be combined", retryable: false });
    const root = resolve(localPath);
    const info = await lstat(root).catch(() => undefined);
    if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) throw new MarcusError({ code: "CLI_LOCAL_DIRECTORY_INVALID", message: `Local source is not a directory: ${localPath}`, retryable: false });

    const ignorePatterns = await loadIgnorePatterns(root, options.ignoreFile);
    let localFiles = await snapshotLocalFiles(root, ignorePatterns);
    let remoteFiles = await this.listRemoteFiles(projectPath);
    const fingerprint = snapshotFingerprint(localFiles);

    if (options.dryRun) {
      const actions = await this.planSync(projectPath, localFiles, remoteFiles, options.delete);
      return { direction: "local-to-project", dryRun: true, fingerprint, files: localFiles.size, actions };
    }

    const session = await this.client.request<{ syncId: string }>("files.sync.open", {
      localRootFingerprint: fingerprint,
      projectRoot: projectPath,
      mode: "push",
      deletePolicy: options.delete ? "trash" : "preserve",
    }, { projectId: this.context.projectId });

    let baseline = new Map<string, RemoteFile>();
    let summary: SyncSummary = emptySyncSummary();
    if (options.initial) {
      const applied = await this.applySync(projectPath, new Map(), localFiles, remoteFiles, new Map(), options.delete, true);
      baseline = applied.baseline;
      summary = applied.summary;
    } else {
      baseline = await this.captureRemoteBaseline(projectPath, localFiles);
    }
    await this.updateSyncSession(session.syncId, localFiles, summary);

    if (!options.watch) {
      const completed = await this.client.request("files.sync.complete", { syncId: session.syncId }, { projectId: this.context.projectId });
      return { syncId: session.syncId, direction: "local-to-project", watch: false, files: localFiles.size, summary, session: completed };
    }

    let interrupted = false;
    const stop = () => { interrupted = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      while (!interrupted) {
        await Bun.sleep(options.debounceMs);
        const sessions = await this.client.request<Array<{ syncId: string; status: string }>>("files.sync.list", {}, { projectId: this.context.projectId });
        const currentSession = sessions.find((candidate) => candidate.syncId === session.syncId);
        if (currentSession?.status !== "open") break;
        const nextFiles = await snapshotLocalFiles(root, ignorePatterns);
        if (snapshotFingerprint(nextFiles) === snapshotFingerprint(localFiles)) continue;
        remoteFiles = await this.listRemoteFiles(projectPath);
        const applied = await this.applySync(projectPath, localFiles, nextFiles, remoteFiles, baseline, options.delete, false);
        localFiles = nextFiles;
        baseline = applied.baseline;
        summary = mergeSyncSummary(summary, applied.summary);
        await this.updateSyncSession(session.syncId, localFiles, summary);
        if (applied.summary.uploaded + applied.summary.deleted > 0) this.render({ syncId: session.syncId, summary: applied.summary });
      }
    } catch (error) {
      await this.client.request("files.sync.stop", { syncId: session.syncId }, { projectId: this.context.projectId }).catch(() => undefined);
      throw error;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }

    const closed = interrupted
      ? await this.client.request("files.sync.stop", { syncId: session.syncId }, { projectId: this.context.projectId })
      : (await this.client.request<Array<{ syncId: string; status: string }>>("files.sync.list", {}, { projectId: this.context.projectId })).find((candidate) => candidate.syncId === session.syncId) ?? null;
    return { syncId: session.syncId, direction: "local-to-project", watch: true, files: localFiles.size, summary, session: closed };
  }

  private async planSync(projectRoot: string, localFiles: Map<string, LocalFile>, remoteFiles: Map<string, RemoteFile>, deleteRemote: boolean): Promise<JsonValue[]> {
    const actions: JsonValue[] = [];
    for (const [relativePath, local] of localFiles) {
      const destination = joinProjectPath(projectRoot, relativePath);
      const remote = await this.remoteStat(destination);
      if (remote?.sha256 !== local.sha256) actions.push({ action: remote === undefined ? "create" : "update", path: destination, size: local.size, sha256: local.sha256 });
    }
    if (deleteRemote) {
      for (const [relativePath, remote] of remoteFiles) {
        if (!localFiles.has(relativePath) && remote.kind !== "directory") actions.push({ action: "trash", path: remote.path, revision: remote.revision });
      }
    }
    return actions;
  }

  private async applySync(
    projectRoot: string,
    previousLocal: Map<string, LocalFile>,
    nextLocal: Map<string, LocalFile>,
    remoteFiles: Map<string, RemoteFile>,
    previousBaseline: Map<string, RemoteFile>,
    deleteRemote: boolean,
    initial: boolean,
  ): Promise<{ baseline: Map<string, RemoteFile>; summary: SyncSummary }> {
    const baseline = new Map(previousBaseline);
    const summary = emptySyncSummary();
    for (const [relativePath, local] of nextLocal) {
      const previous = previousLocal.get(relativePath);
      const destination = joinProjectPath(projectRoot, relativePath);
      if (!initial && previous?.sha256 === local.sha256) { summary.unchanged++; continue; }
      const current = await this.remoteStat(destination);
      const expected = previousBaseline.get(relativePath);
      if (!initial && (current?.revision ?? 0) !== (expected?.revision ?? 0)) {
        throw new MarcusError({ code: "FILE_REVISION_CONFLICT", message: `Remote file changed during sync: ${destination}`, retryable: false, details: { expectedRevision: expected?.revision ?? 0, currentRevision: current?.revision ?? 0 } });
      }
      if (current?.sha256 === local.sha256) {
        baseline.set(relativePath, current);
        summary.unchanged++;
        continue;
      }
      await this.uploadFile(local.path, destination, current?.revision ?? 0);
      const committed = await this.remoteStat(destination);
      if (committed !== undefined) baseline.set(relativePath, committed);
      summary.uploaded++;
    }

    const deleted = initial
      ? [...remoteFiles.keys()].filter((path) => !nextLocal.has(path))
      : [...previousLocal.keys()].filter((path) => !nextLocal.has(path));
    for (const relativePath of deleted.sort()) {
      baseline.delete(relativePath);
      if (!deleteRemote) continue;
      const destination = joinProjectPath(projectRoot, relativePath);
      const current = await this.remoteStat(destination);
      if (current === undefined || current.kind === "directory") continue;
      const expected = previousBaseline.get(relativePath) ?? remoteFiles.get(relativePath);
      if (!initial && current.revision !== expected?.revision) {
        throw new MarcusError({ code: "FILE_REVISION_CONFLICT", message: `Remote file changed before deletion: ${destination}`, retryable: false, details: { expectedRevision: expected?.revision ?? null, currentRevision: current.revision } });
      }
      await this.client.request("files.trash", { path: destination }, { projectId: this.context.projectId! });
      summary.deleted++;
    }
    return { baseline, summary };
  }

  private async captureRemoteBaseline(projectRoot: string, localFiles: Map<string, LocalFile>): Promise<Map<string, RemoteFile>> {
    const baseline = new Map<string, RemoteFile>();
    for (const relativePath of localFiles.keys()) {
      const remote = await this.remoteStat(joinProjectPath(projectRoot, relativePath));
      if (remote !== undefined) baseline.set(relativePath, remote);
    }
    return baseline;
  }

  private async listRemoteFiles(projectRoot: string): Promise<Map<string, RemoteFile>> {
    const output = new Map<string, RemoteFile>();
    const root = normalizeProjectRoot(projectRoot);
    const queue = [root];
    while (queue.length > 0) {
      const directory = queue.shift()!;
      let entries: Array<{ relativePath: string; kind: string; revision: number; sha256?: string }>;
      try {
        entries = await this.client.request("files.list", { path: directory }, { projectId: this.context.projectId! });
      } catch (error) {
        if (error instanceof MarcusError && error.code === "FILE_NOT_FOUND") continue;
        throw error;
      }
      for (const entry of entries) {
        const path = `project:/${entry.relativePath}`;
        const relativePath = relativeProjectPath(root, path);
        const remote: RemoteFile = { path, relativePath, kind: entry.kind, revision: entry.revision, ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }) };
        output.set(relativePath, remote);
        if (entry.kind === "directory") queue.push(path);
      }
    }
    return output;
  }

  private async remoteStat(path: string): Promise<RemoteFile | undefined> {
    try {
      const entry = await this.client.request<{ relativePath: string; kind: string; revision: number; sha256?: string }>("files.stat", { path }, { projectId: this.context.projectId! });
      return { path, relativePath: entry.relativePath, kind: entry.kind, revision: entry.revision, ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }) };
    } catch (error) {
      if (error instanceof MarcusError && error.code === "FILE_NOT_FOUND") return undefined;
      throw error;
    }
  }

  private async updateSyncSession(syncId: string, files: Map<string, LocalFile>, summary: SyncSummary): Promise<void> {
    await this.client.request("files.sync.update", {
      syncId,
      localRootFingerprint: snapshotFingerprint(files),
      state: { files: files.size, ...summary, lastScanAt: new Date().toISOString() },
    }, { projectId: this.context.projectId! });
  }

  private async scaffoldAgent(localPath: string, kind: "sdk" | "markdown"): Promise<JsonValue> {
    const directory = resolve(localPath);
    await mkdir(directory, { recursive: true });
    const id = basename(directory).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "marcus-agent";
    if (kind === "markdown") {
      const source = `---\nschema: marcus.agent/v1\nid: ${id}\nname: ${id}\nkind: prompt-task\ncli-enabled: true\n---\n\n# Objective\n\nComplete the requested task.\n\n# Input\n\n\`\`\`schema\ntype: object\nadditional-properties: true\n\`\`\`\n\n# Output\n\n\`\`\`schema\ntype: object\nadditional-properties: true\n\`\`\`\n`;
      await writeFile(resolve(directory, `${id}.agent.md`), source, { flag: "wx" });
    } else {
      const source = `import { defineAgent, m } from "@marcus/sdk";\n\nexport default defineAgent({\n  id: ${JSON.stringify(id)},\n  name: ${JSON.stringify(id)},\n  input: m.object({ text: m.string() }),\n  output: m.object({ text: m.string() }),\n  async onRun(_ctx, input) { return { text: input.text }; },\n});\n`;
      await writeFile(resolve(directory, "index.ts"), source, { flag: "wx" });
      await writeFile(resolve(directory, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies: { "@marcus/sdk": "^0.1.0" } }, null, 2)}\n`, { flag: "wx" });
    }
    return { directory, kind, id };
  }
}

type LocalFile = { path: string; relativePath: string; size: number; sha256: string };
type RemoteFile = { path: string; relativePath: string; kind: string; revision: number; sha256?: string };
type SyncSummary = { uploaded: number; deleted: number; unchanged: number };

async function snapshotLocalFiles(directory: string, ignorePatterns: readonly string[]): Promise<Map<string, LocalFile>> {
  const paths = await listLocalFiles(directory, directory, ignorePatterns);
  const output = new Map<string, LocalFile>();
  for (const path of paths) {
    const relativePath = relative(directory, path).split("\\").join("/");
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    output.set(relativePath, { path, relativePath, size: bytes.byteLength, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
  }
  return output;
}

async function listLocalFiles(directory: string, root: string, ignorePatterns: readonly string[]): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const relativePath = relative(root, path).split("\\").join("/");
    if (isIgnored(relativePath, entry.isDirectory(), ignorePatterns)) continue;
    if (entry.isSymbolicLink()) throw new MarcusError({ code: "CLI_SYMLINK_FORBIDDEN", message: `Sync rejects symlink ${path}`, retryable: false });
    if (entry.isDirectory()) output.push(...await listLocalFiles(path, root, ignorePatterns));
    else if (entry.isFile()) output.push(path);
  }
  return output.sort();
}

async function loadIgnorePatterns(root: string, configured?: string): Promise<string[]> {
  const patterns = [".git/**", ".marcus/**"];
  const ignorePath = configured === undefined ? resolve(root, ".marcusignore") : resolve(configured);
  const contents = await Bun.file(ignorePath).text().catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && configured === undefined) return "";
    throw error;
  });
  for (const line of contents.split(/\r?\n/u)) {
    const pattern = line.trim();
    if (pattern !== "" && !pattern.startsWith("#")) patterns.push(pattern);
  }
  if (ignorePath.startsWith(`${root}/`)) patterns.push(relative(root, ignorePath).split("\\").join("/"));
  return patterns;
}

function isIgnored(path: string, directory: boolean, patterns: readonly string[]): boolean {
  let ignored = false;
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    let pattern = (negated ? raw.slice(1) : raw).replace(/^\//u, "");
    if (pattern.endsWith("/")) pattern += "**";
    const candidates = pattern.includes("/") ? [pattern] : [pattern, `**/${pattern}`];
    if (candidates.some((candidate) => new Bun.Glob(candidate).match(path) || (directory && new Bun.Glob(candidate).match(`${path}/`)))) ignored = !negated;
  }
  return ignored;
}

function snapshotFingerprint(files: Map<string, LocalFile>): string {
  const value = [...files.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)).map((file) => `${file.relativePath}\0${file.size}\0${file.sha256}`).join("\n");
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function joinProjectPath(root: string, relativePath: string): string {
  const normalized = normalizeProjectRoot(root);
  return `${normalized}${normalized.endsWith("/") ? "" : "/"}${relativePath}`;
}

function relativeProjectPath(root: string, path: string): string {
  const normalized = normalizeProjectRoot(root);
  const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^project:\/+/u, "");
}

function normalizeProjectRoot(root: string): string { return root === "project:/" ? root : root.replace(/\/$/u, ""); }

function emptySyncSummary(): SyncSummary { return { uploaded: 0, deleted: 0, unchanged: 0 }; }
function mergeSyncSummary(left: SyncSummary, right: SyncSummary): SyncSummary {
  return { uploaded: left.uploaded + right.uploaded, deleted: left.deleted + right.deleted, unchanged: left.unchanged + right.unchanged };
}

async function readHidden(prompt: string, interactive: boolean): Promise<string> {
  if (!interactive || !stdin.isTTY || typeof stdin.setRawMode !== "function") {
    const value = (await new Response(Bun.stdin.stream()).text()).replace(/\r?\n$/u, "");
    if (value.length === 0) throw new MarcusError({ code: "CLI_SECRET_REQUIRED", message: "Secret input on stdin is empty", retryable: false });
    return value;
  }
  stdout.write(prompt);
  const wasRaw = stdin.isRaw;
  const wasFlowing = stdin.readableFlowing === true;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      if (!wasFlowing) stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) { cleanup(); reject(new MarcusError({ code: "CLI_INPUT_CANCELLED", message: "Secret input cancelled", retryable: false })); return; }
        if (byte === 13 || byte === 10) {
          cleanup();
          if (value.length === 0) reject(new MarcusError({ code: "CLI_SECRET_REQUIRED", message: "Secret value cannot be empty", retryable: false }));
          else resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32) value += String.fromCharCode(byte);
      }
    };
    stdin.on("data", onData);
  });
}

export function createMnpCli(options: MnpClientOptions & { json?: boolean }): MarcusCli {
  const { json, ...clientOptions } = options;
  return new MarcusCli(new MnpClient(clientOptions), { ...(json === undefined ? {} : { json }) });
}

const helpText = `Commands:
  config default  Configure the global default LLM interactively
  project list | project create <slug> --name <name>
  use project <id|slug>
  ls | files list [path] | files read <path> | files write <path> --content <text>
  agent list | agent show <agent> | agent create <project-path> | agent run <agent> --input <json>
  tools list [agent] [--version <agentVersionId>]
  runs list | run show <id> | run cancel <id>
  put local:<file> project:/path | get project:/file local:<file>
  sync push local:<dir> project:/path [--watch] [--delete] [--dry-run]
  sync list | sync stop <syncId>
  provider list | role list | secret list | ps | top
  validator list | validator show <validator> | validator test <validator>
  backup list | backup create --destination server:/absolute/path | backup verify server:/path
  doctor | context | help | exit`;

function human(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length === 0 ? "(empty)" : value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join("\n");
  return JSON.stringify(value, null, 2);
}

async function readTextInput(prompt: string, interactive: boolean): Promise<string> {
  if (!interactive || !stdin.isTTY) throw new MarcusError({ code: "CLI_INTERACTIVE_REQUIRED", message: "Text input requires an interactive terminal", retryable: false });
  const readline = createInterface({ input: stdin, output: stdout, terminal: true });
  try { return await readline.question(prompt); }
  finally { readline.close(); }
}

function requiredPromptValue(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new MarcusError({ code: "CLI_INPUT_REQUIRED", message: `${label} cannot be empty`, retryable: false });
  return normalized;
}
