import { lstat, mkdir, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { MarcusError, type AgentManifest } from "@marcus/contracts";
import { embeddedMarcusSdkPlugin } from "./sdk-plugin";

export type DependencyInstallPolicy = "never-install" | "frozen-lockfile" | "allow-install";

export interface SdkBuildInput {
  entrypoint: string;
  outputDirectory: string;
  manifestLoaderExecutable?: string;
  installPolicy?: DependencyInstallPolicy;
  timeoutMs?: number;
}

export interface AgentBuildResult {
  manifest: AgentManifest;
  artifactPath: string;
  sourceHash: string;
  manifestHash: string;
  artifactHash: string;
  diagnostics: readonly string[];
}

export interface AuthValidatorBuildResult {
  descriptor: { type: "auth-validator"; id: string; scheme: string };
  artifactPath: string;
  sourceHash: string;
  artifactHash: string;
  diagnostics: readonly string[];
}

export class AgentBuildService {
  async buildSdk(input: SdkBuildInput): Promise<AgentBuildResult> {
    const entrypoint = resolve(input.entrypoint);
    if (!(await Bun.file(entrypoint).exists())) throw buildError("BUILD_ENTRYPOINT_NOT_FOUND", `Entrypoint does not exist: ${entrypoint}`);
    const sourceDirectory = resolve(entrypoint, "..");
    await this.installDependencies(sourceDirectory, input.installPolicy ?? "frozen-lockfile", input.timeoutMs ?? 120_000);
    await mkdir(input.outputDirectory, { recursive: true });
    const sourceHash = await hashSourceTree(sourceDirectory);
    const artifactPath = resolve(input.outputDirectory, `${basename(entrypoint).replace(/\.[^.]+$/u, "")}-${sourceHash.slice(0, 16)}.js`);
    const build = await Bun.build({
      entrypoints: [entrypoint],
      outdir: input.outputDirectory,
      naming: `${basename(artifactPath)}`,
      target: "bun",
      format: "esm",
      splitting: false,
      minify: false,
      sourcemap: "external",
      plugins: [embeddedMarcusSdkPlugin()],
    });
    if (!build.success) {
      throw buildError("BUILD_COMPILE_FAILED", build.logs.map((log) => log.message).join("\n") || "Bun build failed");
    }
    const output = build.outputs.find((candidate) => candidate.path.endsWith(".js"));
    if (output === undefined) throw buildError("BUILD_ARTIFACT_MISSING", "Build produced no JavaScript artifact");
    const actualArtifactPath = output.path;
    const manifest = await loadManifest(actualArtifactPath, input.timeoutMs ?? 15_000, input.manifestLoaderExecutable);
    let normalized: AgentManifest = {
      ...manifest,
      build: { ...manifest.build, sourceHash, entrypoint: actualArtifactPath },
    };
    if (manifest.assets !== undefined) {
      await copyAgentAssets(sourceDirectory, manifest.assets.staticDir, input.outputDirectory);
      normalized = { ...normalized, assets: { ...manifest.assets, staticDir: "assets" } };
    }
    validateManifest(normalized);
    const manifestHash = hashBytes(new TextEncoder().encode(stableJson(normalized)));
    const artifactHash = await hashArtifactTree(input.outputDirectory);
    return {
      manifest: normalized,
      artifactPath: actualArtifactPath,
      sourceHash,
      manifestHash,
      artifactHash,
      diagnostics: build.logs.map((log) => log.message),
    };
  }

  async buildAuthValidator(input: SdkBuildInput): Promise<AuthValidatorBuildResult> {
    const entrypoint = resolve(input.entrypoint);
    if (!(await Bun.file(entrypoint).exists())) throw buildError("BUILD_ENTRYPOINT_NOT_FOUND", `Entrypoint does not exist: ${entrypoint}`);
    const sourceDirectory = resolve(entrypoint, "..");
    await this.installDependencies(sourceDirectory, input.installPolicy ?? "frozen-lockfile", input.timeoutMs ?? 120_000);
    await mkdir(input.outputDirectory, { recursive: true });
    const sourceHash = await hashSourceTree(sourceDirectory);
    const artifactPath = resolve(input.outputDirectory, `validator-${sourceHash.slice(0, 16)}.js`);
    const build = await Bun.build({
      entrypoints: [entrypoint],
      outdir: input.outputDirectory,
      naming: basename(artifactPath),
      target: "bun",
      format: "esm",
      splitting: false,
      minify: false,
      sourcemap: "external",
      plugins: [embeddedMarcusSdkPlugin()],
    });
    if (!build.success) throw buildError("BUILD_COMPILE_FAILED", build.logs.map((log) => log.message).join("\n") || "Bun build failed");
    const output = build.outputs.find((candidate) => candidate.path.endsWith(".js"));
    if (output === undefined) throw buildError("BUILD_ARTIFACT_MISSING", "Build produced no JavaScript artifact");
    const descriptor = await loadAuthValidatorDescriptor(output.path, input.timeoutMs ?? 15_000, input.manifestLoaderExecutable);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(descriptor.id)) throw buildError("AUTH_VALIDATOR_ID_INVALID", "Auth validator id must be kebab-case");
    if (descriptor.scheme.trim() === "") throw buildError("AUTH_VALIDATOR_SCHEME_INVALID", "Auth validator scheme cannot be empty");
    return {
      descriptor,
      artifactPath: output.path,
      sourceHash,
      artifactHash: await hashArtifactTree(input.outputDirectory),
      diagnostics: build.logs.map((log) => log.message),
    };
  }

  private async installDependencies(directory: string, policy: DependencyInstallPolicy, timeoutMs: number): Promise<void> {
    const packageFile = Bun.file(resolve(directory, "package.json"));
    if (!(await packageFile.exists())) return;
    const lockExists = await Bun.file(resolve(directory, "bun.lock")).exists() || await Bun.file(resolve(directory, "bun.lockb")).exists();
    if (policy === "never-install") return;
    if (policy === "frozen-lockfile" && !lockExists) {
      throw buildError("BUILD_LOCKFILE_REQUIRED", "frozen-lockfile policy requires bun.lock or bun.lockb");
    }
    const command = [process.execPath, "install", ...(policy === "frozen-lockfile" ? ["--frozen-lockfile"] : [])];
    const child = Bun.spawn(command, { cwd: directory, stdout: "pipe", stderr: "pipe" });
    const finished = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
    if (!finished) {
      child.kill("SIGKILL");
      throw buildError("BUILD_INSTALL_TIMEOUT", "Dependency installation timed out");
    }
    if (child.exitCode !== 0) {
      throw buildError("BUILD_INSTALL_FAILED", (await new Response(child.stderr).text()).slice(0, 16_384));
    }
  }
}

export async function hashSourceTree(directory: string): Promise<string> {
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })]
    .filter((path) => !path.split("/").some((part) => ["node_modules", ".git", "dist", ".turbo", ".marcus"].includes(part)))
    .sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of files) {
    hasher.update(path);
    hasher.update(new Uint8Array(await Bun.file(resolve(directory, path)).arrayBuffer()));
  }
  return hasher.digest("hex");
}

export async function copyAgentAssets(sourceDirectory: string, staticDirectory: string, outputDirectory: string): Promise<void> {
  const sourceRoot = resolve(sourceDirectory, staticDirectory);
  const normalizedSource = resolve(sourceDirectory);
  if (sourceRoot !== normalizedSource && !sourceRoot.startsWith(`${normalizedSource}/`)) throw buildError("ASSET_PATH_ESCAPE", "Static asset directory escapes the Agent source directory");
  const info = await lstat(sourceRoot).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw buildError("ASSET_DIRECTORY_NOT_FOUND", `Static asset directory does not exist: ${staticDirectory}`);
  const targetRoot = resolve(outputDirectory, "assets");
  await mkdir(targetRoot, { recursive: true });
  await copyDirectory(sourceRoot, targetRoot);
}

async function copyDirectory(source: string, target: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = resolve(source, entry.name);
    const to = resolve(target, entry.name);
    if (entry.isSymbolicLink()) throw buildError("ASSET_SYMLINK_FORBIDDEN", `Static assets may not contain symlink ${entry.name}`);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await copyDirectory(from, to);
    } else if (entry.isFile()) {
      await Bun.write(to, Bun.file(from));
    } else {
      throw buildError("ASSET_TYPE_FORBIDDEN", `Unsupported static asset type ${entry.name}`);
    }
  }
}

export async function hashArtifactTree(directory: string): Promise<string> {
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })].sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of files) {
    hasher.update(path);
    hasher.update(new Uint8Array(await Bun.file(resolve(directory, path)).arrayBuffer()));
  }
  return hasher.digest("hex");
}

async function loadManifest(artifactPath: string, timeoutMs: number, executable?: string): Promise<AgentManifest> {
  const loader = `${import.meta.dir}/manifest-loader.ts`;
  const child = Bun.spawn(executable === undefined ? [process.execPath, loader, artifactPath] : [executable, artifactPath], { stdout: "pipe", stderr: "pipe" });
  const finished = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
  if (!finished) {
    child.kill("SIGKILL");
    throw buildError("MANIFEST_LOAD_TIMEOUT", "Manifest Loader timed out");
  }
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (child.exitCode !== 0) throw buildError("MANIFEST_LOAD_FAILED", stderr.slice(0, 16_384) || "Manifest Loader failed");
  if (stdout.length > 1024 * 1024) throw buildError("MANIFEST_TOO_LARGE", "Manifest output exceeds 1 MiB");
  try {
    return JSON.parse(stdout) as AgentManifest;
  } catch {
    throw buildError("MANIFEST_JSON_INVALID", "Manifest Loader returned invalid JSON");
  }
}

async function loadAuthValidatorDescriptor(
  artifactPath: string,
  timeoutMs: number,
  executable?: string,
): Promise<{ type: "auth-validator"; id: string; scheme: string }> {
  const loader = `${import.meta.dir}/manifest-loader.ts`;
  const command = executable === undefined
    ? [process.execPath, loader, "--auth-validator", artifactPath]
    : [executable, "--auth-validator", artifactPath];
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const finished = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
  if (!finished) {
    child.kill("SIGKILL");
    throw buildError("AUTH_VALIDATOR_LOAD_TIMEOUT", "Auth validator loader timed out");
  }
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (child.exitCode !== 0) throw buildError("AUTH_VALIDATOR_LOAD_FAILED", stderr.slice(0, 16_384) || "Auth validator loader failed");
  try {
    const descriptor = JSON.parse(stdout) as Record<string, unknown>;
    if (descriptor.type !== "auth-validator" || typeof descriptor.id !== "string" || typeof descriptor.scheme !== "string") throw new Error("invalid descriptor");
    return { type: "auth-validator", id: descriptor.id, scheme: descriptor.scheme };
  } catch {
    throw buildError("AUTH_VALIDATOR_DESCRIPTOR_INVALID", "Auth validator loader returned an invalid descriptor");
  }
}

function validateManifest(manifest: AgentManifest): void {
  if (manifest.schemaVersion !== "marcus.agent/v1") throw buildError("MANIFEST_VERSION_UNSUPPORTED", "Manifest must use marcus.agent/v1");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(manifest.identity.id)) throw buildError("MANIFEST_ID_INVALID", "Agent id must be kebab-case");
  if (manifest.runtime.profile === "container") {
    throw buildError("RUNTIME_CONTAINER_UNAVAILABLE", "Container profile is reserved and unavailable in v1");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function buildError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
