import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AgentBuildService } from "./index";

test("keeps the SDK sources embedded by the standalone compiler synchronized", async () => {
  const pairs = [
    ["../../sdk/src/index.ts", "embedded/sdk.ts.txt"],
    ["../../contracts/src/index.ts", "embedded/contracts.ts.txt"],
    ["../../contracts/src/tool-catalog.ts", "embedded/tool-catalog.ts.txt"],
    ["../../schema/src/index.ts", "embedded/schema.ts.txt"],
  ] as const;
  for (const [source, embedded] of pairs) {
    expect(await Bun.file(resolve(import.meta.dir, source)).text()).toBe(await Bun.file(resolve(import.meta.dir, embedded)).text());
  }
});

test("builds an SDK artifact and extracts its manifest in a subprocess", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-build-"));
  const source = resolve(directory, "source");
  const output = resolve(directory, "output");
  try {
    await mkdir(source);
    await Bun.write(resolve(source, "index.ts"), `import { defineAgent, m } from "@marcus/sdk";\n\nexport default defineAgent({\n  id: "compiled-echo",\n  name: "Compiled Echo",\n  input: m.object({ text: m.string() }),\n  output: m.object({ text: m.string() }),\n  async onRun(_context, input) { return { text: input.text }; },\n});\n`);
    const result = await new AgentBuildService().buildSdk({
      entrypoint: resolve(source, "index.ts"),
      outputDirectory: output,
      installPolicy: "never-install",
    });
    expect(result.manifest.identity.id).toBe("compiled-echo");
    expect(result.manifest.build.sourceHash).toHaveLength(64);
    expect(result.artifactHash).toHaveLength(64);
    expect(await Bun.file(result.artifactPath).exists()).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("builds and validates a reusable auth validator in a subprocess", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-validator-build-"));
  const source = resolve(directory, "source");
  const output = resolve(directory, "output");
  try {
    await mkdir(source);
    await Bun.write(resolve(source, "index.ts"), `import { defineAuthValidator } from "@marcus/sdk";\n\nexport default defineAuthValidator({\n  id: "compiled-token",\n  scheme: "bearer",\n  async validate() { return { authenticated: false, code: "INVALID" }; },\n});\n`);
    const result = await new AgentBuildService().buildAuthValidator({
      entrypoint: resolve(source, "index.ts"),
      outputDirectory: output,
      installPolicy: "never-install",
    });
    expect(result.descriptor).toEqual({ type: "auth-validator", id: "compiled-token", scheme: "bearer" });
    expect(result.sourceHash).toHaveLength(64);
    expect(result.artifactHash).toHaveLength(64);
    expect(await Bun.file(result.artifactPath).exists()).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
