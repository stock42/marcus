import type { BunPlugin } from "bun";
import sdkSource from "./embedded/sdk.ts.txt" with { type: "text" };
import contractsSource from "./embedded/contracts.ts.txt" with { type: "text" };
import toolCatalogSource from "./embedded/tool-catalog.ts.txt" with { type: "text" };
import schemaSource from "./embedded/schema.ts.txt" with { type: "text" };

const namespace = "marcus-embedded-sdk";
const sources = new Map<string, string>([
  ["sdk/index.ts", sdkSource],
  ["contracts/index.ts", contractsSource.replaceAll('"./tool-catalog"', '"@marcus/contracts/tool-catalog"')],
  ["contracts/tool-catalog.ts", toolCatalogSource.replaceAll('"./index"', '"@marcus/contracts"')],
  ["schema/index.ts", schemaSource.replaceAll('import("./index")', 'import("@marcus/schema")')],
]);

const packages = new Map<string, string>([
  ["@marcus/sdk", "sdk/index.ts"],
  ["@marcus/contracts", "contracts/index.ts"],
  ["@marcus/contracts/tool-catalog", "contracts/tool-catalog.ts"],
  ["@marcus/schema", "schema/index.ts"],
]);

export function embeddedMarcusSdkPlugin(): BunPlugin {
  return {
    name: "marcus-embedded-sdk",
    setup(build) {
      build.onResolve({ filter: /^@marcus\/(?:sdk|contracts(?:\/tool-catalog)?|schema)$/u }, (args) => {
        const path = packages.get(args.path);
        if (path === undefined) return undefined;
        return { path, namespace };
      });
      build.onLoad({ filter: /.*/u, namespace }, (args) => {
        const contents = sources.get(args.path);
        if (contents === undefined) throw new Error(`Embedded Marcus SDK source is unavailable: ${args.path}`);
        return { contents, loader: "ts" };
      });
    },
  };
}
