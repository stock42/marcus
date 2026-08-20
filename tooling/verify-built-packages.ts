import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const errors: string[] = [];
let verified = 0;

for (const packageFile of new Bun.Glob("packages/*/package.json").scanSync({ cwd: root, absolute: true })) {
  const packageJson = (await Bun.file(packageFile).json()) as {
    name: string;
    exports?: Record<string, string | { import?: string }>;
  };
  const rootExport = packageJson.exports?.["."];
  const target = typeof rootExport === "string" ? rootExport : rootExport?.import;
  if (target === undefined) continue;
  const source = resolve(packageFile, "..", target);
  if (!(await Bun.file(source).exists())) {
    errors.push(`${packageJson.name}: missing source export ${target}`);
    continue;
  }
  try {
    const exports = (await import(`${source}?verify=${Date.now()}`)) as Record<string, unknown>;
    if (Object.keys(exports).length === 0) errors.push(`${packageJson.name}: source entrypoint has no exports`);
    else verified += 1;
  } catch (error) {
    errors.push(`${packageJson.name}: source entrypoint cannot be imported: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const asset of ["BUILD_ID", "server/app/page.js", "server/app/favicon.ico/route.js"]) {
  const path = resolve(root, "apps/marcus-backoffice/.next", asset);
  if (!(await Bun.file(path).exists())) errors.push(`@marcus/backoffice: missing .next/${asset}`);
}

for (const asset of ["BUILD_ID", "server/app/page.js"]) {
  const path = resolve(root, "apps/marcus-web/.next", asset);
  if (!(await Bun.file(path).exists())) errors.push(`@marcus/web: missing .next/${asset}`);
}

for (const asset of [
  "install",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "marcus-logo.png",
  "site.webmanifest",
]) {
  const path = resolve(root, "apps/marcus-web/public", asset);
  if (!(await Bun.file(path).exists())) errors.push(`@marcus/web: missing public/${asset}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`BUILD_ARTIFACT_INVALID: ${error}`);
  process.exit(1);
}

console.log(`Imported Bun-native source entrypoints for ${verified} packages and verified both Next applications.`);
