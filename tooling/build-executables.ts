import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

type Artifact = { name: string; sha256: string; size: number };

const root = resolve(import.meta.dir, "..");
const requestedTarget = option("--target");
const target = requestedTarget ?? currentBunTarget();
const targetLabel = target.replace(/^bun-/u, "");
const outputRoot = resolve(option("--output") ?? resolve(root, "artifacts", "executables"), targetLabel);
const windows = target.includes("windows");
const clientOnly = process.argv.includes("--client-only") || (windows && !process.argv.includes("--include-windows-server"));
const extension = windows ? ".exe" : "";

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const builds: { name: string; entrypoints: string[] }[] = [
  { name: `marcus${extension}`, entrypoints: [resolve(root, "apps/marcus-cli/src/index.ts")] },
  ...clientOnly ? [] : [
    { name: `marcusd${extension}`, entrypoints: [resolve(root, "apps/marcusd/src/index.ts")] },
    { name: `marcus-api${extension}`, entrypoints: [resolve(root, "apps/marcus-api/src/index.ts")] },
    {
      name: `marcus-runtime-host${extension}`,
      entrypoints: [
        resolve(root, "packages/runtime-host/src/host-process.ts"),
        resolve(root, "packages/runtime-host/src/worker-entry.ts"),
      ],
    },
    { name: `marcus-agent-process${extension}`, entrypoints: [resolve(root, "packages/runtime-host/src/process-entry.ts")] },
    { name: `marcus-manifest-loader${extension}`, entrypoints: [resolve(root, "packages/compiler/src/manifest-loader.ts")] },
  ],
];

for (const build of builds) {
  const command = [
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--minify",
    ...(requestedTarget === undefined ? [] : [`--target=${target}`]),
    ...build.entrypoints,
    "--outfile",
    resolve(outputRoot, build.name),
  ];
  await run(command, root);
}

if (!clientOnly) await cp(resolve(root, "distribution"), resolve(outputRoot, "distribution"), { recursive: true, force: true });
await cp(resolve(root, "LICENSE"), resolve(outputRoot, "LICENSE"), { force: true });

const artifactNames = [...builds.map((build) => build.name), "LICENSE", ...clientOnly ? [] : [
  "distribution/config/marcusd.json",
  "distribution/config/marcus-api.json",
  "distribution/systemd/marcusd.service",
  "distribution/systemd/marcus-api.service",
]];
const artifacts: Artifact[] = [];
for (const name of artifactNames) {
  const path = resolve(outputRoot, name);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  artifacts.push({ name, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), size: (await stat(path)).size });
}
let distributionBundle: string | undefined;
if (!clientOnly) {
  distributionBundle = `marcus-release-${targetLabel}.tar.gz`;
  await run([
    "tar",
    "-czf",
    distributionBundle,
    ...builds.map((build) => build.name),
    "LICENSE",
    "distribution/install.sh",
    "distribution/config/marcusd.json",
    "distribution/config/marcus-api.json",
    "distribution/systemd/marcusd.service",
    "distribution/systemd/marcus-api.service",
  ], outputRoot);
  const path = resolve(outputRoot, distributionBundle);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  artifacts.push({
    name: distributionBundle,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    size: (await stat(path)).size,
  });
}
const rootPackage = await Bun.file(resolve(root, "package.json")).json() as { version: string; devDependencies: { turbo: string } };
const sdkPackage = await Bun.file(resolve(root, "packages/sdk/package.json")).json() as { name: string; version: string };
const manifest = {
  productVersion: rootPackage.version,
  gitCommit: process.env.MARCUS_RELEASE_COMMIT ?? await gitCommit(),
  bunVersion: Bun.version,
  turboVersion: rootPackage.devDependencies.turbo,
  target: targetLabel,
  ...(distributionBundle === undefined ? {} : { distributionBundle }),
  artifacts,
  packages: [{ name: sdkPackage.name, version: sdkPackage.version }],
  protocols: { mnp: 1, agentManifest: "v1", runtimeHost: 1 },
};
if (windows && clientOnly) {
  await writeReleaseFiles();
  const archiveName = `marcus-${targetLabel}.zip`;
  await run(["zip", "-q", "-FS", archiveName, `marcus${extension}`, "LICENSE", "SHA256SUMS"], outputRoot);
  const archivePath = resolve(outputRoot, archiveName);
  const bytes = new Uint8Array(await Bun.file(archivePath).arrayBuffer());
  artifacts.push({ name: archiveName, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), size: (await stat(archivePath)).size });
  await writeReleaseFiles();
} else {
  await writeReleaseFiles();
}
process.stdout.write(`${JSON.stringify({ output: outputRoot, target: targetLabel, artifacts: artifacts.length })}\n`);

async function writeReleaseFiles(): Promise<void> {
  await Bun.write(resolve(outputRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await Bun.write(resolve(outputRoot, "SHA256SUMS"), `${artifacts.map((item) => `${item.sha256}  ${item.name}`).join("\n")}\n`, { mode: 0o644 });
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function currentBunTarget(): string {
  const platform = process.platform === "darwin" ? "darwin" : process.platform;
  return `bun-${platform}-${process.arch}`;
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.slice(0, 3).join(" ")}`);
}

async function gitCommit(): Promise<string> {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "ignore" });
  if (await child.exited !== 0) return "unversioned";
  return (await new Response(child.stdout).text()).trim() || "unversioned";
}
