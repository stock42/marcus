import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type PackageJson = {
  name: string;
  version: string;
  license: string;
};

const packageRoot = resolve(import.meta.dir, "..");
const destination = resolve(packageRoot, "../../artifacts/packages");
const packageJson = await Bun.file(resolve(packageRoot, "package.json")).json() as PackageJson;
const archiveName = `${packageJson.name.replace(/^@/u, "").replaceAll("/", "-")}-${packageJson.version}.tgz`;
const temporaryRoot = await mkdtemp(join(tmpdir(), "marcus-sdk-pack-"));
const stagingRoot = resolve(temporaryRoot, "package");

await mkdir(destination, { recursive: true });
await mkdir(resolve(stagingRoot, "src/internal/contracts"), { recursive: true });
await mkdir(resolve(stagingRoot, "src/internal/schema"), { recursive: true });

try {
  await stagePackage();
  const child = Bun.spawn(
    [process.execPath, "pm", "pack", "--destination", destination],
    { cwd: stagingRoot, stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const archivePath = resolve(destination, archiveName);
const archive = new Uint8Array(await Bun.file(archivePath).arrayBuffer());
const sha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
const metadata = await stat(archivePath);

await verifyPackedPackage(archivePath);

await Bun.write(resolve(destination, "SHA256SUMS"), `${sha256}  ${archiveName}\n`);
await Bun.write(resolve(destination, "release-manifest.json"), `${JSON.stringify({
  package: packageJson.name,
  version: packageJson.version,
  license: packageJson.license,
  artifact: { name: archiveName, sha256, size: metadata.size },
  compatibility: { agentManifest: "v1", runtimeHost: 1 },
}, null, 2)}\n`);

async function stagePackage(): Promise<void> {
  const publishPackage = {
    name: packageJson.name,
    version: packageJson.version,
    description: "TypeScript SDK for Marcus Agentic OS agents",
    license: packageJson.license,
    keywords: ["ai", "agents", "agentic", "bun", "typescript", "marcus"],
    repository: {
      type: "git",
      url: "git+https://github.com/stock42/marcus.git",
      directory: "packages/sdk",
    },
    homepage: "https://projectmarcus.com/documentacion/sdk",
    bugs: { url: "https://github.com/stock42/marcus/issues" },
    type: "module",
    sideEffects: false,
    types: "./src/index.ts",
    exports: {
      ".": { types: "./src/index.ts", import: "./src/index.ts" },
      "./testing": { types: "./src/testing.ts", import: "./src/testing.ts" },
    },
    files: ["src", "README.md", "LICENSE", "NOTICE"],
    engines: { bun: ">=1.3.14" },
    peerDependencies: { "@types/bun": ">=1.3.14 <2" },
    publishConfig: { access: "public" },
  };
  await Bun.write(resolve(stagingRoot, "package.json"), `${JSON.stringify(publishPackage, null, 2)}\n`);
  await Bun.write(resolve(stagingRoot, "README.md"), Bun.file(resolve(packageRoot, "README.md")));
  await Bun.write(resolve(stagingRoot, "LICENSE"), Bun.file(resolve(packageRoot, "../../LICENSE")));
  await Bun.write(resolve(stagingRoot, "NOTICE"), Bun.file(resolve(packageRoot, "../../NOTICE")));

  const sdkIndex = await Bun.file(resolve(packageRoot, "src/index.ts")).text();
  const sdkTesting = await Bun.file(resolve(packageRoot, "src/testing.ts")).text();
  const contracts = await Bun.file(resolve(packageRoot, "../contracts/src/index.ts")).text();
  const toolCatalog = await Bun.file(resolve(packageRoot, "../contracts/src/tool-catalog.ts")).text();
  const schema = await Bun.file(resolve(packageRoot, "../schema/src/index.ts")).text();

  await Bun.write(resolve(stagingRoot, "src/index.ts"), rewriteSdkImports(sdkIndex));
  await Bun.write(resolve(stagingRoot, "src/testing.ts"), rewriteSdkImports(sdkTesting).replaceAll('from "./index"', 'from "./index.ts"'));
  await Bun.write(resolve(stagingRoot, "src/internal/contracts/index.ts"), contracts);
  await Bun.write(resolve(stagingRoot, "src/internal/contracts/tool-catalog.ts"), toolCatalog);
  await Bun.write(resolve(stagingRoot, "src/internal/schema/index.ts"), schema.replaceAll('from "@marcus/contracts"', 'from "../contracts/index.ts"'));
}

function rewriteSdkImports(source: string): string {
  return source
    .replaceAll('from "@marcus/contracts"', 'from "./internal/contracts/index.ts"')
    .replaceAll('from "@marcus/schema"', 'from "./internal/schema/index.ts"');
}

async function verifyPackedPackage(archivePath: string): Promise<void> {
  const smokeRoot = await mkdtemp(join(tmpdir(), "marcus-sdk-consumer-"));
  try {
    await Bun.write(resolve(smokeRoot, "package.json"), `${JSON.stringify({
      name: "marcus-sdk-package-smoke",
      private: true,
      type: "module",
      dependencies: { "@marcus/sdk": `file:${archivePath}` },
    }, null, 2)}\n`);
    await Bun.write(resolve(smokeRoot, "tsconfig.json"), `${JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        lib: ["ESNext", "DOM"],
      },
      include: ["index.ts"],
    }, null, 2)}\n`);
    await Bun.write(resolve(smokeRoot, "index.ts"), `import { defineAgent, m, MARCUS_SDK_VERSION } from "@marcus/sdk";\nimport { createAgentTestHarness } from "@marcus/sdk/testing";\n\nconst agent = defineAgent({\n  id: "package-smoke",\n  name: "Package Smoke",\n  input: m.object({ name: m.string() }),\n  output: m.object({ greeting: m.string() }),\n  async onRun(_context, input) { return { greeting: \`Hola \${input.name}\` }; },\n});\n\nconst result = await createAgentTestHarness(agent).run({ name: "Marcus" });\nif (MARCUS_SDK_VERSION !== ${JSON.stringify(packageJson.version)} || result.output.greeting !== "Hola Marcus") throw new Error("Installed SDK package smoke failed");\n`);
    await run([process.execPath, "install", "--ignore-scripts"], smokeRoot);
    await run([process.execPath, "run", "index.ts"], smokeRoot);
    await run([process.execPath, resolve(packageRoot, "../../node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], smokeRoot);
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}
