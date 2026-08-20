import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const websiteRoot = resolve(root, "apps", "marcus-web");
const publicReleases = resolve(websiteRoot, "public", "releases");
const stagingReleases = resolve(root, "artifacts", "website-releases-staging");
const stagingStable = resolve(stagingReleases, "stable");
const buildReleases = resolve(root, "artifacts", "website-releases-build");
const publicChunkBytes = 24 * 1024 * 1024;
const sourceCommit = process.env.MARCUS_RELEASE_COMMIT
  ?? process.env.VERCEL_GIT_COMMIT_SHA
  ?? await gitCommit();
const targets = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
] as const;

await rm(stagingReleases, { recursive: true, force: true });
await rm(buildReleases, { recursive: true, force: true });
await mkdir(stagingStable, { recursive: true });

for (const target of targets) {
  await run([
    process.execPath,
    "tooling/build-executables.ts",
    "--target",
    target,
    "--output",
    buildReleases,
  ], root, {
    ...process.env,
    MARCUS_RELEASE_COMMIT: sourceCommit,
  });
}

await validateReleaseMatrix(buildReleases);
for (const target of targets) {
  const label = targetLabel(target);
  const source = resolve(buildReleases, label);
  const destination = resolve(stagingStable, label);
  const manifest = await Bun.file(resolve(source, "release-manifest.json")).json() as ReleaseManifest;
  const bundleName = manifest.distributionBundle;
  if (typeof bundleName !== "string") throw new Error(`Release ${label} has no distribution bundle`);
  await mkdir(resolve(destination, "distribution"), { recursive: true });
  const distributionBundleParts = await publishBundleParts(
    resolve(source, bundleName),
    destination,
    bundleName,
  );
  await Bun.write(
    resolve(destination, "release-manifest.json"),
    `${JSON.stringify({ ...manifest, distributionBundleParts }, null, 2)}\n`,
  );
  await Bun.write(
    resolve(destination, "SHA256SUMS"),
    `${distributionBundleParts.map((part) => `${part.sha256}  ${part.name}`).join("\n")}\n`,
  );
  await cp(resolve(source, "distribution", "install.sh"), resolve(destination, "distribution", "install.sh"), { force: true });
}
await rm(publicReleases, { recursive: true, force: true });
await rename(stagingReleases, publicReleases);
await rm(buildReleases, { recursive: true, force: true });
await run([process.execPath, "tooling/installer-smoke.ts", "--skip-build"], root);

const releaseBytes = await directorySize(publicReleases);
process.stdout.write(`${JSON.stringify({
  releases: publicReleases,
  targets: targets.map(targetLabel),
  sourceCommit,
  releaseBytes,
  installVerified: true,
})}\n`);

async function validateReleaseMatrix(stableRoot: string): Promise<void> {
  const requiredArtifacts = [
    "marcus",
    "marcusd",
    "marcus-api",
    "marcus-runtime-host",
    "marcus-agent-process",
    "marcus-manifest-loader",
    "distribution/config/marcusd.json",
    "distribution/config/marcus-api.json",
    "distribution/systemd/marcusd.service",
    "distribution/systemd/marcus-api.service",
  ];

  for (const target of targets) {
    const label = targetLabel(target);
    const directory = resolve(stableRoot, label);
    const manifest = await Bun.file(resolve(directory, "release-manifest.json")).json() as {
      target?: string;
      gitCommit?: string;
      artifacts?: Array<{ name?: string; sha256?: string; size?: number }>;
      distributionBundle?: string;
    };
    if (manifest.target !== label) throw new Error(`Release manifest target mismatch for ${label}`);
    if (manifest.gitCommit !== sourceCommit) throw new Error(`Release manifest commit mismatch for ${label}`);
    if (manifest.distributionBundle !== `marcus-release-${label}.tar.gz`) {
      throw new Error(`Release manifest bundle mismatch for ${label}`);
    }
    const artifacts = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.name, artifact]));
    for (const name of requiredArtifacts) {
      const artifact = artifacts.get(name);
      const path = resolve(directory, name);
      if (
        artifact === undefined
        || !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")
        || !Number.isSafeInteger(artifact.size)
        || artifact.size !== (await stat(path)).size
      ) {
        throw new Error(`Release ${label} has no valid ${name}`);
      }
    }
    const bundle = artifacts.get(manifest.distributionBundle);
    if (
      bundle === undefined
      || !/^[a-f0-9]{64}$/u.test(bundle.sha256 ?? "")
      || !Number.isSafeInteger(bundle.size)
      || bundle.size !== (await stat(resolve(directory, manifest.distributionBundle))).size
    ) {
      throw new Error(`Release ${label} has no valid distribution bundle`);
    }
    if (!(await Bun.file(resolve(directory, "distribution", "install.sh")).exists())) {
      throw new Error(`Release ${label} has no installer`);
    }
  }
}

function targetLabel(target: string): string {
  return target.replace(/^bun-/u, "");
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  for await (const path of new Bun.Glob("**/*").scan({ cwd: directory, absolute: true, onlyFiles: true })) {
    total += (await stat(path)).size;
  }
  return total;
}

async function publishBundleParts(
  bundlePath: string,
  destination: string,
  bundleName: string,
): Promise<ReleaseArtifact[]> {
  const bundle = Bun.file(bundlePath);
  const parts: ReleaseArtifact[] = [];
  for (let offset = 0, index = 0; offset < bundle.size; offset += publicChunkBytes, index += 1) {
    const partName = `${bundleName}.part-${String(index).padStart(3, "0")}`;
    const part = bundle.slice(offset, Math.min(offset + publicChunkBytes, bundle.size));
    const bytes = await part.arrayBuffer();
    await Bun.write(resolve(destination, partName), bytes);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    parts.push({ name: partName, sha256: hasher.digest("hex"), size: bytes.byteLength });
  }
  if (parts.length === 0) throw new Error(`Distribution bundle ${bundleName} is empty`);
  return parts;
}

async function run(command: string[], cwd: string, env = process.env): Promise<void> {
  const child = Bun.spawn(command, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

async function gitCommit(): Promise<string> {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "ignore" });
  if (await child.exited !== 0) return "unversioned";
  return (await new Response(child.stdout).text()).trim() || "unversioned";
}

type ReleaseArtifact = {
  name: string;
  sha256: string;
  size: number;
};

type ReleaseManifest = {
  distributionBundle?: string;
  artifacts?: ReleaseArtifact[];
  [key: string]: unknown;
};
