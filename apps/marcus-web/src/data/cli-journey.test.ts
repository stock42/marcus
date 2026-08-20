import { describe, expect, test } from "bun:test";
import { parseCommand } from "@marcus/cli";
import journey from "./cli-journey.json";

describe("public CLI journey", () => {
  test("keeps the four documented stages in order", () => {
    expect(journey.steps.map((step) => step.id)).toEqual(["install", "start", "project", "agent"]);
  });

  test("parses every Marcus command with the production command parser", () => {
    const context = { projectId: "prj_fixture", projectSlug: "testing-project", projectPath: "project:/" };
    const commands = journey.steps.flatMap((step) => step.lines)
      .filter((line) => line.scope === "marcus" && line.command !== undefined);

    for (const line of commands) {
      expect(() => parseCommand(line.command!, context), line.command).not.toThrow();
    }
  });

  test("stores machine-readable transcript responses as valid JSON", () => {
    const responses = journey.steps.flatMap((step) => step.lines)
      .filter((line) => line.format === "json");

    for (const line of responses) expect(() => JSON.parse(line.value)).not.toThrow();
  });

  test("reproduces the observed login and Project session", () => {
    const transcript = journey.steps.flatMap((step) => step.lines).map((line) => line.value).join("\n");
    expect(transcript).toContain('Password for "admin" (press Enter to connect):');
    expect(transcript).toContain("Marcus CLI 0.1.0 · MNP/1\nType help for commands.");
    expect(transcript).toContain("LLM: not configured");
    expect(transcript).toContain("config default");
    expect(transcript).toContain('"projectId": "prj_019ff2fda9e97000b6069cdc9c22b180"');
    expect(transcript).toContain("marcus[testing-project:project:/]>");
    expect(transcript).not.toContain("842 ms");
    expect(transcript).not.toContain("✓");
  });

  test("installs every personal component below the unified Marcus home", () => {
    const transcript = journey.steps.flatMap((step) => step.lines).map((line) => line.value).join("\n");
    expect(transcript).toContain("Plataforma detectada: linux-x64");
    expect(transcript).toContain("Descargando parte 1/9");
    expect(transcript).toContain("Instalación completada correctamente");
    expect(transcript).toContain("Marcus home: /home/developer/.marcus");
    expect(transcript).toContain("Public executables: /home/developer/.marcus/bin");
    expect(transcript).toContain("Runtime Host components: /home/developer/.marcus/lib/marcus");
    expect(transcript).toContain("/home/developer/.marcus/bin/marcusd");
    expect(transcript).toContain("/home/developer/.marcus/bin/marcus-api");
    expect(transcript).toContain("bun run backoffice · http://127.0.0.1:6636");
    expect(transcript).not.toContain("/.local/");
  });

  test("documents the actual scaffold input contract and queued Run response", () => {
    const transcript = journey.steps.flatMap((step) => step.lines).map((line) => line.value).join("\n");
    expect(transcript).toContain("agent scaffold ./alertas --kind sdk");
    expect(transcript).toContain("agent run alertas --input '{\"text\":\"estado de alertas\"}'");
    expect(transcript).toContain('"state": "queued"');
    expect(transcript).not.toContain('"severity":"high"');
    expect(transcript).not.toContain("Completado");
  });
});
