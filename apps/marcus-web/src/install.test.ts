import { expect, test } from "bun:test";
import { resolve } from "node:path";

const path = resolve(import.meta.dir, "../public/install");

test("the public installer bootstrap is valid POSIX shell", async () => {
  const check = Bun.spawn(["sh", "-n", path], { stdout: "pipe", stderr: "pipe" });
  expect(await check.exited).toBe(0);

  const delegated = Bun.spawn(["sh", "-n", resolve(import.meta.dir, "../../../distribution/install.sh")], { stdout: "pipe", stderr: "pipe" });
  expect(await delegated.exited).toBe(0);
});

test("the public installer resolves a platform release and delegates arguments", async () => {
  const source = await Bun.file(path).text();
  expect(source).toContain("https://projectmarcus.com/releases/stable");
  expect(source).toContain("$target_base_url/release-manifest.json");
  expect(source).toContain("$target_base_url/distribution/install.sh");
  expect(source).toContain('"$@"');
  expect(source).toContain("Descargando el instalador de la release de Marcus");
  expect(source).toContain("--progress-bar");
});

test("the delegated installer keeps its personal installation in ~/.marcus", async () => {
  const source = await Bun.file(resolve(import.meta.dir, "../../../distribution/install.sh")).text();
  expect(source).toContain('prefix="${HOME}/.marcus"');
  expect(source).not.toContain('prefix="${HOME}/.local"');
});

test("the delegated installer reports download progress and exact next steps", async () => {
  const source = await Bun.file(resolve(import.meta.dir, "../../../distribution/install.sh")).text();

  expect(source).toContain("Descargando parte $part_index/$part_count");
  expect(source).toContain("Verificando el archivo completo de la release");
  expect(source).toContain("Instalación completada correctamente");
  expect(source).toContain("iniciá el daemon y dejalo ejecutándose");
  expect(source).toContain("--bootstrap-token-file %s/bootstrap.token");
  expect(source).toContain("iniciá Marcus API y dejala ejecutándose");
  expect(source).toContain("abrí la CLI de Marcus");
  expect(source).toContain("bun run backoffice");
  expect(source).toContain("http://127.0.0.1:6636");
  expect(source).toContain("El Backoffice no está incluido en este instalador");
});
