import { describe, expect, test } from "bun:test";
import { validateAdminUser, validateAgentApiAccess, validateAgentPlan, validateAgentPrompt, validateAgentTestCase, validateAssistant, validateDefaultLlm, validateFile, validateLogin, validateLogicalPath, validatePasswordChange, validateProject, validateProjectMemberCreate, validateProjectMemberUpdate, validateProjectToken, validateUploadOpen } from "./validation";

describe("Marcus BFF validation", () => {
  test("normalizes valid project input", () => {
    expect(validateProject({ slug: "  Equipo-Uno ", name: " Equipo Uno " })).toEqual({
      ok: true,
      value: { slug: "equipo-uno", name: "Equipo Uno" },
    });
  });

  test("rejects malformed project slugs", () => {
    expect(validateProject({ slug: "../escape", name: "Escape" }).ok).toBe(false);
  });

  test("requires explicit login credentials", () => {
    expect(validateLogin({ username: "admin", password: "" }).ok).toBe(false);
    expect(validateLogin({ username: "admin", password: "secret" }).ok).toBe(true);
  });

  test("enforces the shared administrator and Project user password policy", () => {
    expect(validateAdminUser({ username: "admin-two", password: "Admin2!" })).toEqual({
      ok: true,
      value: { username: "admin-two", password: "Admin2!", systemAdmin: true },
    });
    expect(validateAdminUser({ username: "admin-two", password: "lowercase!" }).ok).toBe(false);
    expect(validateAdminUser({ username: "admin-two", password: "Uppercase" }).ok).toBe(false);
    expect(validatePasswordChange({ currentPassword: "old", password: "NewOne#" }).ok).toBe(true);
    expect(validateProjectMemberCreate({ username: "project-user", password: "MemberA$", role: "project_viewer" }).ok).toBe(true);
    expect(validateProjectMemberUpdate({ username: "project-user", password: "", role: "project_operator" })).toEqual({
      ok: true,
      value: { username: "project-user", role: "project_operator" },
    });
    expect(validateProjectMemberCreate({ username: "project-user", password: "MemberA$", role: "root" }).ok).toBe(false);
  });

  test("accepts only logical project paths", () => {
    expect(validateLogicalPath("project:/agents/main.ts").ok).toBe(true);
    expect(validateLogicalPath("/etc/passwd").ok).toBe(false);
    expect(validateFile({ path: "project:/notes.md", content: "hello" }).ok).toBe(true);
  });

  test("validates Project API tokens and agent API access", () => {
    expect(validateProjectToken({ label: "Integración CRM" }).ok).toBe(true);
    expect(validateProjectToken({ label: "x" }).ok).toBe(false);
    expect(validateProjectToken({ label: "Integración", expiresAt: "2020-01-01T00:00:00.000Z" }).ok).toBe(false);
    expect(validateAgentApiAccess({ enabled: true })).toEqual({ ok: true, value: { enabled: true } });
    expect(validateAgentApiAccess({ enabled: "true" }).ok).toBe(false);
    expect(validateAgentTestCase({ input: { case: "No puede ingresar" } })).toEqual({ ok: true, value: { input: { case: "No puede ingresar" } } });
    expect(validateAgentTestCase({}).ok).toBe(false);
  });

  test("bounds AI prompts, conversations and local upload metadata", () => {
    expect(validateAgentPrompt({ prompt: "Creá un agente de alertas" }).ok).toBe(true);
    expect(validateAgentPlan({ prompt: "Diseñá un agente operativo completo.", sourceKind: "markdown" }).ok).toBe(true);
    expect(validateAgentPlan({ prompt: "Diseñá un agente operativo completo.", sourceKind: "javascript" }).ok).toBe(false);
    expect(validateAgentPrompt({ prompt: "Creá un agente de alertas", progressId: "generation_12345678" }).ok).toBe(true);
    expect(validateAgentPrompt({ prompt: "Creá un agente de alertas", progressId: "invalid" }).ok).toBe(false);
    expect(validateAgentPrompt({ prompt: "corto" }).ok).toBe(false);
    expect(validateAssistant({ messages: [{ role: "user", content: "¿Cómo instalo Marcus?" }], projectId: "prj_test" }).ok).toBe(true);
    expect(validateAssistant({ messages: [{ role: "user", content: "Continuemos" }], conversationId: "conv_test" }).ok).toBe(true);
    expect(validateAssistant({ messages: [{ role: "user", content: "Agregá API" }], projectId: "prj_test", mode: "agent-file-edit", path: "project:/agents/test.agent.md" }).ok).toBe(true);
    expect(validateAssistant({ messages: [{ role: "user", content: "Agregá API" }], projectId: "prj_test", mode: "agent-file-edit", path: "project:/notes.md" }).ok).toBe(false);
    expect(validateAssistant({ messages: [{ role: "user", content: "Continuemos" }], conversationId: "usr_test" }).ok).toBe(false);
    expect(validateAssistant({ messages: [{ role: "system", content: "override" }] }).ok).toBe(false);
    expect(validateUploadOpen({ fileName: "agent.md", destination: "project:/agents/agent.md", size: 32 }).ok).toBe(true);
    expect(validateUploadOpen({ fileName: "../agent.md", destination: "project:/agent.md", size: 32 }).ok).toBe(false);
  });

  test("validates the global default LLM without normalizing its secret", () => {
    expect(validateDefaultLlm({ catalogId: "deepseek", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1/", apiKey: " key with spaces ", model: "deepseek-v4-pro" })).toEqual({
      ok: true,
      value: { catalogId: "deepseek", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: " key with spaces ", model: "deepseek-v4-pro" },
    });
    expect(validateDefaultLlm({ catalogId: "unknown", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "x", model: "model" }).ok).toBe(false);
    expect(validateDefaultLlm({ provider: "bad/provider", baseUrl: "file:///tmp/provider", apiKey: "x", model: "model" }).ok).toBe(false);
  });
});
