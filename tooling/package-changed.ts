import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const explicitBase = option("--base");
const paths = await changedPaths(explicitBase);
const all = process.argv.includes("--all");
const server = all || paths.some(isServerReleasePath);
const backoffice = all || paths.some((path) => path.startsWith("apps/marcus-backoffice/")
  || path === "bun.lock"
  || path === "turbo.json"
  || path === "tooling/package-backoffice.ts"
  || path === "tooling/prepare-backoffice-standalone.ts");
const sdk = all || paths.some((path) => path.startsWith("packages/sdk/") || path.startsWith("packages/schema/") || path.startsWith("packages/contracts/"));
const website = all || paths.some((path) => path.startsWith("apps/marcus-web/") || path === "bun.lock" || path === "turbo.json");
const studio = all || paths.some((path) => path.startsWith("apps/marcus-studio-gateway/")
  || path.startsWith("packages/studio-contracts/")
  || path.startsWith("packages/provider-contracts/")
  || path === "bun.lock"
  || path === "turbo.json");

if (server) {
  await run([process.execPath, "run", "package:release"]);
}
if (backoffice) await run([process.execPath, "run", "package:backoffice"]);
if (sdk) await run([process.execPath, "run", "pack"]);
if (website) await run([process.execPath, "run", "--filter", "@marcus/web", "build"]);
if (studio) await run([process.execPath, "run", "--filter", "@marcus/studio-gateway", "test"]);

process.stdout.write(`${JSON.stringify({ base: explicitBase ?? "HEAD", changed: paths.length, packaged: { server, backoffice, sdk, website, studio } })}\n`);

function isServerReleasePath(path: string): boolean {
  return path === "package.json"
    || path === "bun.lock"
    || path.startsWith("apps/marcusd/")
    || path.startsWith("apps/marcus-api/")
    || path.startsWith("apps/marcus-cli/")
    || path.startsWith("packages/")
    || path.startsWith("distribution/")
    || path === "apps/marcus-web/public/install"
    || path === "tooling/build-executables.ts"
    || path === "tooling/installer-smoke.ts"
    || path === "tooling/build-artifact.ts"
    || path === "tooling/package-release.ts"
    || path === "tooling/package-changed.ts";
}

async function changedPaths(base?: string): Promise<string[]> {
  const commands = [
    ...(base === undefined ? [] : [["git", "diff", "--name-only", `${base}...HEAD`]]),
    ["git", "diff", "--name-only"],
    ["git", "diff", "--cached", "--name-only"],
    ["git", "ls-files", "--others", "--exclude-standard"],
  ];
  const values = new Set<string>();
  for (const command of commands) {
    const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`Unable to inspect changed paths: ${stderr.trim()}`);
    for (const path of stdout.split("\n")) if (path !== "") values.add(path);
  }
  return [...values].sort();
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}
