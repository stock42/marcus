import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compileMarkdownAgent } from "../packages/markdown/src/index";

describe("canonical agent fixtures", () => {
  test("SDK and Markdown API assistants produce the same public contract", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "marcus-fixture-parity-"));
    try {
      const source = await Bun.file(resolve(import.meta.dir, "../fixtures/agents/markdown/api-assistant.agent.md")).text();
      const markdown = (await compileMarkdownAgent(source, { sourceHash: "fixture" })).manifest;
      const build = await Bun.build({
        entrypoints: [resolve(import.meta.dir, "../fixtures/agents/sdk/api-assistant/index.ts")],
        outdir: directory,
        target: "bun",
        plugins: [{
          name: "fixture-sdk",
          setup(builder) {
            builder.onResolve({ filter: /^@marcus\/(sdk|contracts|schema)$/u }, ({ path }) => ({
              path: resolve(import.meta.dir, `../packages/${path.slice("@marcus/".length)}/src/index.ts`),
            }));
          },
        }],
      });
      expect(build.success).toBe(true);
      const sdkAssistant = (await import(build.outputs.find((output) => output.path.endsWith(".js"))!.path)).default as { toManifest(options: { sourceHash: string; compilerVersion: string }): typeof markdown };
      const sdk = sdkAssistant.toManifest({ sourceHash: "fixture", compilerVersion: "0.1.0" });
      const { build: _markdownBuild, ...markdownContract } = markdown;
      const { build: _sdkBuild, ...sdkContract } = sdk;
      expect(markdownContract).toEqual(sdkContract);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("scheduled Markdown fixture compiles durable scheduling and recovery policy", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../fixtures/agents/markdown/scheduled.agent.md")).text();
    const manifest = (await compileMarkdownAgent(source)).manifest;
    expect(manifest.entrypoints.schedules).toEqual([{ id: "daily-report", cron: "0 3 * * *", timezone: "UTC", input: { period: "daily" } }]);
    expect(manifest.recovery).toEqual({ policy: "restart-instance", maxRestarts: 3 });
  });
});
