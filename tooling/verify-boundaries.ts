import { relative, resolve } from "node:path";

type PackageJson = {
  name: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Workspace = {
  name: string;
  directory: string;
  packageJson: PackageJson;
  imports: Set<string>;
};

const root = resolve(import.meta.dir, "..");
const errors: string[] = [];
const workspaces: Workspace[] = [];
const acceptedRuntimeDependencies = new Map<string, ReadonlySet<string>>([
  ["@marcus/api", new Set(["s42-core", "@modelcontextprotocol/sdk", "zod"])],
  ["@marcus/studio-gateway", new Set(["typescript"])],
]);
const packageFiles = [
  ...new Bun.Glob("packages/*/package.json").scanSync({ cwd: root, absolute: true }),
  ...new Bun.Glob("apps/*/package.json").scanSync({ cwd: root, absolute: true }),
];

for (const packageFile of packageFiles) {
  const packageJson = (await Bun.file(packageFile).json()) as PackageJson;
  const directory = resolve(packageFile, "..");
  const imports = new Set<string>();
  for (const source of new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: directory, absolute: true })) {
    if (/\.test\.tsx?$/u.test(source)) continue;
    const text = await Bun.file(source).text();
    const loader = source.endsWith(".tsx") ? "tsx" : "ts";
    for (const item of new Bun.Transpiler({ loader }).scanImports(text)) imports.add(item.path);
  }
  workspaces.push({ name: packageJson.name, directory, packageJson, imports });
}

const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));

for (const workspace of workspaces) {
  if (workspace.packageJson.license !== "Apache-2.0") {
    errors.push(`${workspace.name}: license must be Apache-2.0`);
  }
  const runtimeDependencies = workspace.packageJson.dependencies ?? {};
  const declared = { ...(workspace.packageJson.devDependencies ?? {}), ...runtimeDependencies };
  for (const specifier of workspace.imports) {
    if (!specifier.startsWith("@marcus/")) continue;
    if (!(specifier in declared)) errors.push(`${workspace.name}: undeclared internal import ${specifier}`);
  }
  for (const dependency of Object.keys(runtimeDependencies)) {
    const internal = dependency.startsWith("@marcus/");
    const architectureDecision = acceptedRuntimeDependencies.get(workspace.name)?.has(dependency) === true;
    const backofficeException = workspace.name === "@marcus/backoffice";
    const websiteException = workspace.name === "@marcus/web" && ["next", "react", "react-dom"].includes(dependency);
    if (!internal && !architectureDecision && !backofficeException && !websiteException) {
      errors.push(`${workspace.name}: third-party runtime dependency ${dependency} requires an ADR`);
    }
    if (dependency === "s42-core" && workspace.name !== "@marcus/api") {
      errors.push(`${workspace.name}: S42-Core is confined to @marcus/api`);
    }
  }
  enforceImportRules(workspace);
}

detectCycles();

if (errors.length > 0) {
  for (const error of errors) console.error(`BOUNDARY_VIOLATION: ${error}`);
  process.exit(1);
}

console.log(`Verified package boundaries for ${workspaces.length} workspaces.`);

function enforceImportRules(workspace: Workspace): void {
  const forbidden = new Set<string>();
  if (workspace.name === "@marcus/contracts") {
    for (const candidate of byName.keys()) forbidden.add(candidate);
  }
  if (workspace.name === "@marcus/sdk") {
    for (const candidate of byName.keys()) {
      if (!["@marcus/contracts", "@marcus/schema", "@marcus/sdk"].includes(candidate)) forbidden.add(candidate);
    }
  }
  if (workspace.name === "@marcus/cli") {
    forbidden.add("@marcus/kernel");
    forbidden.add("@marcus/service");
    forbidden.add("@marcus/storage-sqlite");
  }
  if (workspace.name === "@marcus/api") {
    forbidden.add("@marcus/kernel");
    forbidden.add("@marcus/storage-sqlite");
  }
  for (const specifier of workspace.imports) {
    if (forbidden.has(specifier)) errors.push(`${workspace.name}: forbidden import ${specifier}`);
  }
}

function detectCycles(): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (name: string): void => {
    if (visiting.has(name)) {
      const start = path.indexOf(name);
      errors.push(`circular dependency: ${[...path.slice(start), name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    path.push(name);
    const workspace = byName.get(name);
    const dependencies = {
      ...(workspace?.packageJson.devDependencies ?? {}),
      ...(workspace?.packageJson.dependencies ?? {}),
    };
    for (const dependency of Object.keys(dependencies)) {
      if (byName.has(dependency)) visit(dependency);
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of byName.keys()) visit(name);
}

void relative;
