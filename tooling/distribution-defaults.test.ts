import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("personal install and uninstall share the unified Marcus home", async () => {
  for (const relativePath of ["distribution/install.sh", "distribution/uninstall.sh"]) {
    const source = await Bun.file(resolve(root, relativePath)).text();
    expect(source).toContain('prefix="${HOME}/.marcus"');
    expect(source).not.toContain('prefix="${HOME}/.local"');
  }
});

test("Backoffice development, production, and packaged launchers default to port 6636", async () => {
  const manifest = await Bun.file(resolve(root, "apps/marcus-backoffice/package.json")).json() as {
    scripts: { dev: string; start: string };
  };
  const packager = await Bun.file(resolve(root, "tooling/package-backoffice.ts")).text();

  expect(manifest.scripts.dev).toContain("${MARCUS_BACKOFFICE_PORT:-6636}");
  expect(manifest.scripts.start).toContain("${MARCUS_BACKOFFICE_PORT:-6636}");
  expect(packager).toContain("${MARCUS_BACKOFFICE_PORT:-6636}");
});

test("system services share the Marcus system log directory", async () => {
  const daemon = await Bun.file(resolve(root, "distribution/config/marcusd.json")).json() as { logsDir: string };
  const api = await Bun.file(resolve(root, "distribution/config/marcus-api.json")).json() as { logsDir: string };

  expect(daemon.logsDir).toBe("/var/log/marcus");
  expect(api.logsDir).toBe("/var/log/marcus");
});
