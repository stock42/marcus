import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compileMarkdownAgent, emitMarkdownArtifact, parseMarkdownAgent } from "./index";

const source = `---
schema: marcus.agent/v1
id: support-consultant
name: Support Consultant
kind: assistant
runtime:
  profile: worker
cli-enabled: true
api-enabled: true
api:
  authentication:
    type: marcus-token
rate-limits:
  - scope: principal
    algorithm: fixed-window
    limit: 10
    window: 1m
---
# Objective
Answer support questions.
# System
Never invent facts.
# Input
\`\`\`yaml schema
object:
  message:
    type: string
    min-length: 1
required: [message]
additional-properties: false
\`\`\`
# Output
\`\`\`yaml schema
object:
  text:
    type: string
required: [text]
additional-properties: false
\`\`\`
`;

test("parses and deterministically compiles structured Markdown", async () => {
  const result = await compileMarkdownAgent(source);
  expect(result.deterministic).toBe(true);
  expect(result.manifest.identity.id).toBe("support-consultant");
  expect(result.manifest.rateLimits?.[0]?.windowMs).toBe(60_000);
  expect(result.manifest.contract.inputSchema.required).toEqual(["message"]);
});

test("compiles concise top-level schema properties used by generated Markdown agents", async () => {
  const concise = source
    .replace("object:\n  message:\n    type: string", "ingredients:\n  type: array\n  items:\n    type: string")
    .replace("required: [message]", "required: [ingredients]");
  const result = await compileMarkdownAgent(concise);
  expect(result.manifest.contract.inputSchema).toMatchObject({
    type: "object",
    required: ["ingredients"],
    additionalProperties: false,
    properties: {
      ingredients: { type: "array", items: { type: "string" } },
    },
  });
});

test("emits an executable first-party runtime artifact", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "marcus-markdown-"));
  try {
    const compilation = await compileMarkdownAgent(source);
    const artifact = await emitMarkdownArtifact(compilation, directory);
    const imported = (await import(artifact.artifactPath)) as { default: { toManifest(): { identity: { id: string } } } };
    expect(imported.default.toManifest().identity.id).toBe("support-consultant");
    expect(artifact.artifactHash).toHaveLength(64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports deterministic syntax errors with a source line", () => {
  expect(() => parseMarkdownAgent("# no frontmatter")).toThrow("must start with ---");
});
