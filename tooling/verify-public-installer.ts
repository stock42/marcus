import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const baseUrl = (option("--base-url") ?? "https://projectmarcus.com").replace(/\/$/u, "");
const target = targetLabel();
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

const bootstrapResponse = await fetch(`${baseUrl}/install`, { redirect: "error" });
if (!bootstrapResponse.ok) throw new Error(`Public bootstrap returned HTTP ${bootstrapResponse.status}`);
const bootstrap = await bootstrapResponse.text();
if (!bootstrap.startsWith("#!/bin/sh\n")) throw new Error("Public /install is not the Marcus POSIX bootstrap");

const manifestUrl = `${baseUrl}/releases/stable/${target}/release-manifest.json`;
const manifestResponse = await fetch(manifestUrl, { redirect: "error" });
if (!manifestResponse.ok) throw new Error(`Public release manifest returned HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json() as {
  target?: string;
  distributionBundle?: string;
  distributionBundleParts?: Array<{ name?: string; sha256?: string; size?: number }>;
  artifacts?: Array<{ name?: string; sha256?: string; size?: number }>;
};
if (manifest.target !== target) throw new Error(`Public release target is ${manifest.target ?? "missing"}, expected ${target}`);
const artifacts = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.name, artifact]));
for (const name of requiredArtifacts) {
  const artifact = artifacts.get(name);
  if (artifact === undefined || !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "") || !Number.isSafeInteger(artifact.size) || (artifact.size ?? 0) < 1) {
    throw new Error(`Public release manifest has no valid ${name} artifact`);
  }
}
const bundle = artifacts.get(manifest.distributionBundle);
if (
  typeof manifest.distributionBundle !== "string"
  || bundle === undefined
  || !/^[a-f0-9]{64}$/u.test(bundle.sha256 ?? "")
  || !Number.isSafeInteger(bundle.size)
  || (bundle.size ?? 0) < 1
) {
  throw new Error("Public release manifest has no valid distribution bundle");
}
const parts = manifest.distributionBundleParts ?? [];
if (parts.length === 0) throw new Error("Public release manifest has no distribution bundle parts");
let partsSize = 0;
for (const [index, part] of parts.entries()) {
  if (
    part.name !== `${manifest.distributionBundle}.part-${String(index).padStart(3, "0")}`
    || !/^[a-f0-9]{64}$/u.test(part.sha256 ?? "")
    || !Number.isSafeInteger(part.size)
    || (part.size ?? 0) < 1
  ) {
    throw new Error(`Public release manifest has an invalid distribution bundle part at index ${index}`);
  }
  partsSize += part.size ?? 0;
}
if (partsSize !== bundle.size) throw new Error("Public release bundle parts do not match its declared size");

if (process.argv.includes("--full")) {
  const temporary = await mkdtemp(resolve(tmpdir(), "marcus-public-installer-"));
  try {
    const prefix = resolve(temporary, "prefix");
    const install = Bun.spawn([
      "sh",
      "-c",
      `curl -fsSL "$1/install" | MARCUS_RELEASE_BASE_URL="$1/releases/stable" sh -s -- --prefix "$2"`,
      "public-installer",
      baseUrl,
      prefix,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([new Response(install.stderr).text(), install.exited]);
    if (exitCode !== 0) throw new Error(`Public end-to-end installation failed (${exitCode}): ${stderr.trim()}`);
    for (const path of ["bin/marcus", "bin/marcusd", "bin/marcus-api", "lib/marcus/marcus-runtime-host", "lib/marcus/marcus-agent-process", "lib/marcus/marcus-manifest-loader"]) {
      if (!(await Bun.file(resolve(prefix, path)).exists())) throw new Error(`Public installation did not create ${path}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify({ baseUrl, target, bootstrap: true, manifest: true, artifacts: requiredArtifacts.length, bundleParts: parts.length, fullInstall: process.argv.includes("--full") })}\n`);

function targetLabel(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `${platform}-${process.arch}`;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
