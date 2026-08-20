import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const packageJson = await Bun.file(resolve(root, "packages/sdk/package.json")).json() as { name: string; version: string };
const archive = resolve(root, "artifacts/packages", `${packageJson.name.replace(/^@/u, "").replaceAll("/", "-")}-${packageJson.version}.tgz`);
const dryRun = process.argv.includes("--dry-run");

if (!dryRun) {
  const status = await output(["git", "status", "--porcelain"]);
  if (status !== "") throw new Error("Refusing to publish @marcus/sdk from a dirty worktree");
  const [head, remote] = await Promise.all([
    output(["git", "rev-parse", "HEAD"]),
    output(["git", "rev-parse", "origin/main"]),
  ]);
  if (head !== remote) throw new Error("Refusing to publish @marcus/sdk before main is synchronized with origin/main");
  await run([process.execPath, "pm", "whoami"]);
}

await run([process.execPath, "run", "pack"]);
await run([process.execPath, "publish", "--access", "public", ...(dryRun ? ["--dry-run"] : []), archive]);

console.log(JSON.stringify({ package: packageJson.name, version: packageJson.version, archive, dryRun }));

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

async function output(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Command failed: ${command.join(" ")}: ${stderr.trim()}`);
  return stdout.trim();
}
