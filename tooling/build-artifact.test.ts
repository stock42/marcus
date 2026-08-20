import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("artifact builds stay independent from the Next landing build", async () => {
  const artifactSource = await Bun.file(resolve(root, "tooling", "build-artifact.ts")).text();
  const websitePackage = await Bun.file(resolve(root, "apps", "marcus-web", "package.json")).json() as {
    scripts?: { build?: string };
  };

  expect(artifactSource).not.toContain('"next"');
  expect(artifactSource).not.toContain("verifyBuiltWebsite");
  expect(websitePackage.scripts?.build).toBe("bun --bun next build");
});

test("changed-surface packaging still builds a changed website beside server artifacts", async () => {
  const packageChangedSource = await Bun.file(resolve(root, "tooling", "package-changed.ts")).text();

  expect(packageChangedSource).toContain('if (website) await run([process.execPath, "run", "--filter", "@marcus/web", "build"]);');
  expect(packageChangedSource).not.toContain("website && !server");
});
