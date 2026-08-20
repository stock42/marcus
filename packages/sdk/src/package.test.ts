import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

describe("Bun-native SDK package", () => {
  test("declares Bun types and keeps internal workspaces development-only", async () => {
    const packageJson = await Bun.file(resolve(packageRoot, "package.json")).json() as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toEqual({ "@types/bun": ">=1.3.14 <2" });
    expect(packageJson.devDependencies).toEqual({
      "@marcus/contracts": "workspace:*",
      "@marcus/schema": "workspace:*",
    });
  });

  test("exports TypeScript source without a dist contract", async () => {
    const packageJson = await Bun.file(resolve(packageRoot, "package.json")).json() as {
      types: string;
      exports: Record<string, { types: string; import: string }>;
      files: string[];
      engines: { bun: string };
      repository: { type: string; url: string; directory: string };
      homepage: string;
      publishConfig: { access: string };
    };
    expect(packageJson.types).toBe("./src/index.ts");
    expect(packageJson.exports["."]).toEqual({ types: "./src/index.ts", import: "./src/index.ts" });
    expect(packageJson.exports["./testing"]).toEqual({ types: "./src/testing.ts", import: "./src/testing.ts" });
    expect(packageJson.files).toContain("src");
    expect(packageJson.files).not.toContain("dist");
    expect(packageJson.files).toContain("NOTICE");
    expect(packageJson.engines.bun).toBe(">=1.3.14");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/stock42/marcus.git",
      directory: "packages/sdk",
    });
    expect(packageJson.homepage).toBe("https://projectmarcus.com/documentacion/sdk");
    expect(packageJson.publishConfig).toEqual({ access: "public" });
  });
});
