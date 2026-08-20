import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const ignoredDirectories = new Set([".git", ".turbo", "artifacts", "docs", "node_modules"]);
const errors: string[] = [];

await findDistDirectories(root);

const configurationFiles = [
  resolve(root, "package.json"),
  ...new Bun.Glob("apps/*/package.json").scanSync({ cwd: root, absolute: true }),
  ...new Bun.Glob("packages/*/package.json").scanSync({ cwd: root, absolute: true }),
  resolve(root, "tsconfig.base.json"),
  ...new Bun.Glob("apps/*/tsconfig.json").scanSync({ cwd: root, absolute: true }),
  ...new Bun.Glob("packages/*/tsconfig.json").scanSync({ cwd: root, absolute: true }),
];

for (const path of configurationFiles) {
  const text = await Bun.file(path).text();
  if (/(?:^|[\s"'=:/])dist(?:[\s"'./]|$)/imu.test(text)) {
    errors.push(`${relative(root, path)} configures or references dist output`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`DIST_FORBIDDEN: ${error}`);
  process.exit(1);
}

console.log(`Verified no dist output across ${configurationFiles.length} build and TypeScript configurations.`);

async function findDistDirectories(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.name === "dist") {
      errors.push(`${relative(root, path)}/ exists`);
      continue;
    }
    await findDistDirectories(path);
  }
}
