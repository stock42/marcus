import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const releaseDirectory = resolve(option("--release-directory") ?? resolve(root, "apps", "marcus-web", "public", "releases", "stable", targetLabel()));
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) await run([process.execPath, "run", "build:artifact"], root);
if (!(await Bun.file(resolve(releaseDirectory, "release-manifest.json")).exists())) {
  throw new Error(`Release manifest is missing at ${releaseDirectory}; run bun run build:artifact first`);
}

const temporary = await mkdtemp(resolve(tmpdir(), "marcus-installer-smoke-"));
const home = resolve(temporary, "home");
const prefix = resolve(home, ".marcus");
await mkdir(home, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const targetPrefix = `/releases/stable/${targetLabel()}/`;
    const requestedPath = url.pathname === "/install"
      ? resolve(root, "apps", "marcus-web", "public", "install")
      : url.pathname.startsWith(targetPrefix)
        ? resolve(releaseDirectory, url.pathname.slice(targetPrefix.length))
        : undefined;
    if (
      requestedPath === undefined
      || (url.pathname !== "/install" && !requestedPath.startsWith(`${releaseDirectory}/`))
    ) {
      response.writeHead(404).end("Not found");
      return;
    }
    const file = Bun.file(requestedPath);
    if (!(await file.exists())) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": requestedPath.endsWith(".json") ? "application/json" : "application/octet-stream" });
    response.end(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : "Installer smoke server failed");
  }
});

try {
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Installer smoke server did not expose a TCP port");
  const bootstrap = Bun.spawn([
    "sh",
    "-c",
    `export HOME="$1"; curl -fsSL http://127.0.0.1:${address.port}/install | MARCUS_RELEASE_BASE_URL=http://127.0.0.1:${address.port}/releases/stable sh`,
    "installer-smoke",
    home,
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(bootstrap.stdout).text(),
    new Response(bootstrap.stderr).text(),
    bootstrap.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Public bootstrap failed (${exitCode}): ${stderr.trim()}`);
  if (!stdout.includes(`Marcus home: ${prefix}`)) {
    throw new Error(`Public bootstrap did not use the unified personal home: ${stdout.trim()}`);
  }
  for (const stage of [
    "[marcus] Plataforma detectada:",
    "[marcus] Descargando el manifiesto de la release estable",
    "[marcus] Descargando parte",
    "[marcus] Verificando el archivo completo de la release",
    "[marcus] Instalando comandos públicos",
    "[marcus] Instalación completada correctamente",
  ]) {
    if (!stderr.includes(stage)) throw new Error(`Public bootstrap did not report stage ${stage}: ${stderr.trim()}`);
  }
  for (const instruction of ["iniciá el daemon", "completá una sola vez el bootstrap", "iniciá Marcus API", "abrí la CLI de Marcus", "bun run backoffice"]) {
    if (!stdout.includes(instruction)) throw new Error(`Public bootstrap did not explain how to ${instruction}: ${stdout.trim()}`);
  }

  const executables = [
    resolve(prefix, "bin/marcus"),
    resolve(prefix, "bin/marcusd"),
    resolve(prefix, "bin/marcus-api"),
    resolve(prefix, "lib/marcus/marcus-runtime-host"),
    resolve(prefix, "lib/marcus/marcus-agent-process"),
    resolve(prefix, "lib/marcus/marcus-manifest-loader"),
  ];
  for (const executable of executables) {
    const mode = (await stat(executable)).mode;
    if ((mode & 0o111) === 0) throw new Error(`Installed artifact is not executable: ${executable}`);
  }
  process.stdout.write(`${JSON.stringify({ installed: true, target: targetLabel(), executables: executables.length, progressReported: true, nextStepsReported: true })}\n`);
} finally {
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  await rm(temporary, { recursive: true, force: true });
}

function targetLabel(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `${platform}-${process.arch}`;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}
