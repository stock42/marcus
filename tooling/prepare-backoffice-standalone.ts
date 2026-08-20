import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const workspace = resolve(root, "apps", "marcus-backoffice");
const source = resolve(workspace, ".next", "static");
const destination = resolve(workspace, ".next", "standalone", "apps", "marcus-backoffice", ".next", "static");

if (!(await Bun.file(resolve(source, "../BUILD_ID")).exists())) {
  throw new Error("Backoffice build output is missing; run this helper only after next build");
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true, force: true });
