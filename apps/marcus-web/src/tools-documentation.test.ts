import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { MARCUS_OFFICIAL_TOOL_CATALOG } from "@marcus/contracts";

test("the public Tools guide renders the complete shared official catalog", async () => {
  const source = await Bun.file(resolve(import.meta.dir, "app/documentacion/tools/page.tsx")).text();
  expect(MARCUS_OFFICIAL_TOOL_CATALOG).toHaveLength(13);
  for (const id of [
    "marcus/files.list",
    "marcus/files.stat",
    "marcus/files.write",
    "marcus/files.move",
    "marcus/files.delete",
    "marcus/http.request",
    "marcus/artifacts.create",
    "marcus/agents.invoke",
    "marcus/runs.get",
    "marcus/events.publish",
    "marcus/approvals.request",
  ]) {
    expect(MARCUS_OFFICIAL_TOOL_CATALOG.some((tool) => tool.id === id)).toBeTrue();
    expect(source).toContain(`"${id}"`);
  }
  expect(source).toContain("MARCUS_OFFICIAL_TOOL_CATALOG");
  expect(source).toContain("Schemas exactos");
});
