import { lstat, readlink } from "node:fs/promises";
import { resolve } from "node:path";

type PackageJson = {
  name: string;
  private?: boolean;
  publishConfig?: { access?: string };
  repository?: { type?: string; url?: string; directory?: string };
  homepage?: string;
  bugs?: { url?: string };
  engines?: { bun?: string };
  files?: string[];
};

const root = resolve(import.meta.dir, "..");
const errors: string[] = [];
const tracked = await gitFiles();
const forbiddenTracked = [
  /^private\//u,
  /^docs\//u,
  /^\.agents\//u,
  /^\.claude\//u,
  /^skills-lock\.json$/u,
  /(^|\/)\.env(?:\.|$)/u,
  /(^|\/)\.marcus(?:-data)?\//u,
  /^artifacts\//u,
  /(^|\/)(?:coverage|node_modules|\.next|dist)\//u,
  /\.(?:db|db-shm|db-wal|log|pem|p12|pfx|key)$/iu,
];

for (const path of tracked) {
  if (path.endsWith(".env.example")) continue;
  if (forbiddenTracked.some((pattern) => pattern.test(path))) errors.push(`forbidden tracked path: ${path}`);
}

for (const required of ["LICENSE", "NOTICE", "README.md", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md"]) {
  if (!tracked.includes(required)) errors.push(`missing public repository file: ${required}`);
}

if (!tracked.includes(".github/workflows/ci.yml")) errors.push("missing public CI workflow: .github/workflows/ci.yml");
if (tracked.includes("AGENT-STUDIO.md")) errors.push("internal Agent Studio plan must live under ignored private/");

const ignore = await Bun.file(resolve(root, ".gitignore")).text();
if (!ignore.split(/\r?\n/u).includes("/private/")) errors.push(".gitignore must ignore /private/");

const rootPackage = await readPackage("package.json");
if (rootPackage.private !== true) errors.push("root workspace must be private");
if (rootPackage.repository?.url !== "git+https://github.com/stock42/marcus.git") errors.push("root repository metadata is missing or invalid");

for (const path of tracked.filter((candidate) => /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(candidate))) {
  const packageJson = await readPackage(path);
  if (packageJson.name === "@marcus/sdk") continue;
  if (packageJson.private !== true) errors.push(`${packageJson.name} must be private to prevent accidental registry publication`);
}

const sdk = await readPackage("packages/sdk/package.json");
if (sdk.private === true) errors.push("@marcus/sdk must remain publishable");
if (sdk.publishConfig?.access !== "public") errors.push("@marcus/sdk publishConfig.access must be public");
if (sdk.repository?.directory !== "packages/sdk") errors.push("@marcus/sdk repository.directory must be packages/sdk");
if (sdk.homepage !== "https://projectmarcus.com/documentacion/sdk") errors.push("@marcus/sdk homepage is invalid");
if (sdk.bugs?.url !== "https://github.com/stock42/marcus/issues") errors.push("@marcus/sdk bugs URL is invalid");
if (sdk.engines?.bun !== ">=1.3.14") errors.push("@marcus/sdk must declare its Bun runtime floor");
for (const file of ["src", "README.md", "LICENSE", "NOTICE"]) {
  if (!sdk.files?.includes(file)) errors.push(`@marcus/sdk package files must include ${file}`);
}

const envExample = await Bun.file(resolve(root, "apps/marcus-studio-gateway/.env.example")).text();
for (const line of envExample.split(/\r?\n/u)) {
  if (!line.startsWith("MARCUS_STUDIO_DEEPSEEK_API_KEY=")) continue;
  if (line !== "MARCUS_STUDIO_DEEPSEEK_API_KEY=") errors.push("Studio API key example must stay blank");
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bghp_[A-Za-z0-9]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
];

for (const path of tracked) {
  const absolute = resolve(root, path);
  const info = await lstat(absolute).catch(() => undefined);
  if (info === undefined) continue;
  if (info.isSymbolicLink()) {
    const target = await readlink(absolute);
    if (target.startsWith("/") || (target.split("/").includes("..") && !resolve(absolute, "..", target).startsWith(root))) {
      errors.push(`tracked symlink escapes the repository: ${path}`);
    }
    continue;
  }
  if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
  const bytes = new Uint8Array(await Bun.file(absolute).arrayBuffer());
  if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) continue;
  const source = new TextDecoder().decode(bytes);
  if (secretPatterns.some((pattern) => pattern.test(source))) errors.push(`possible credential material in tracked file: ${path}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`PUBLIC_REPOSITORY_INVALID: ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({ trackedFiles: tracked.length, publicPackage: sdk.name, internalPackagesPrivate: true, credentialSignatures: 0 }));

async function readPackage(path: string): Promise<PackageJson> {
  return await Bun.file(resolve(root, path)).json() as PackageJson;
}

async function gitFiles(): Promise<string[]> {
  const child = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Unable to inspect tracked files: ${stderr.trim()}`);
  const candidates = stdout.split("\0").filter(Boolean).sort();
  const present: string[] = [];
  for (const path of candidates) {
    if (await lstat(resolve(root, path)).catch(() => undefined) !== undefined) present.push(path);
  }
  return present;
}
