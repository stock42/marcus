import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const workspace = resolve(root, "apps", "marcus-backoffice");
const output = resolve(root, "artifacts", "backoffice");
const stage = resolve(output, "package");
const packageManifest = await Bun.file(resolve(workspace, "package.json")).json() as { name: string; version: string };
const sourceCommit = await gitCommit();

await run([process.execPath, "run", "build"], workspace);
await rm(output, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(resolve(workspace, ".next", "standalone"), stage, { recursive: true, force: true });
await cp(resolve(root, "LICENSE"), resolve(stage, "LICENSE"), { force: true });
await Bun.write(resolve(stage, "run.sh"), `#!/bin/sh
set -eu

package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export HOSTNAME=127.0.0.1
export PORT="\${MARCUS_BACKOFFICE_PORT:-6636}"
exec bun "$package_root/apps/marcus-backoffice/server.js"
`, { mode: 0o755 });

const archiveName = `marcus-backoffice-${packageManifest.version}-${targetLabel()}.tgz`;
await run(["tar", "-czf", resolve(output, archiveName), "-C", output, "package"], root);
const archivePath = resolve(output, archiveName);
await smokeArchive(archivePath);
const bytes = new Uint8Array(await Bun.file(archivePath).arrayBuffer());
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const size = (await stat(archivePath)).size;
const manifest = {
  name: packageManifest.name,
  version: packageManifest.version,
  gitCommit: sourceCommit,
  bunVersion: Bun.version,
  target: targetLabel(),
  entrypoint: "package/run.sh",
  listener: "127.0.0.1",
  artifact: { name: archiveName, sha256, size },
};
await Bun.write(resolve(output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await Bun.write(resolve(output, "SHA256SUMS"), `${sha256}  ${archiveName}\n`);
process.stdout.write(`${JSON.stringify({ output, artifact: archiveName, size })}\n`);

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

async function gitCommit(): Promise<string> {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "ignore" });
  if (await child.exited !== 0) return "unversioned";
  return (await new Response(child.stdout).text()).trim() || "unversioned";
}

function targetLabel(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `${platform}-${process.arch}`;
}

async function smokeArchive(archivePath: string): Promise<void> {
  const temporary = await mkdtemp(resolve(tmpdir(), "marcus-backoffice-package-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    await run(["tar", "-xzf", archivePath, "-C", temporary], root);
    const port = await availablePort();
    child = Bun.spawn(["sh", resolve(temporary, "package", "run.sh")], {
      cwd: temporary,
      env: { ...process.env, MARCUS_BACKOFFICE_PORT: String(port) },
      stdout: "ignore",
      stderr: "pipe",
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) {
        const stderr = await new Response(child.stderr).text();
        throw new Error(`Packaged Backoffice exited before becoming ready: ${stderr.trim()}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
        if (response.ok && (await response.arrayBuffer()).byteLength > 0) return;
      } catch {
        // The standalone server is still starting.
      }
      await Bun.sleep(100);
    }
    throw new Error("Packaged Backoffice did not become ready on its loopback listener");
  } finally {
    if (child !== undefined && child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not reserve a Backoffice smoke-test port");
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  return address.port;
}
