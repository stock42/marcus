import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const providerPort = Number(process.env.MARCUS_BACKOFFICE_API_TEST_PORT ?? "4314") + 1;

type BrowserErrors = { page: string[]; console: string[] };

function captureBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { page: [], console: [] };
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  return errors;
}

async function expectDocumentScrollOnly(page: Page): Promise<void> {
  const nestedVerticalScrollers = await page.locator("main#main-content").evaluate((main) => Array.from(main.querySelectorAll("*")).filter((node) => {
    const element = node as HTMLElement;
    const overflowY = getComputedStyle(element).overflowY;
    return (overflowY === "auto" || overflowY === "scroll") && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1;
  }).map((node) => `${node.tagName.toLowerCase()}${node.getAttribute("data-slot") === null ? "" : `[data-slot=${node.getAttribute("data-slot")}]`}`));
  expect(nestedVerticalScrollers, "page content must use the browser scrollbar").toEqual([]);
}

test("the production Next Backoffice renders anonymous login through the semantic session BFF", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tu infraestructura agéntica, bajo control." })).toBeVisible();
  await expect(page.getByLabel("Usuario")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  const session = await page.request.get("/api/session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ ok: true, data: { authenticated: false } });
  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/x-icon");
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("the Next login remains keyboard usable on a narrow viewport", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const username = page.getByLabel("Usuario");
  await expect(username).toBeVisible();
  await username.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Contraseña")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("a real Next session manages a Project, agents, files, uploads and Marcus AI", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  const browserRequests: string[] = [];
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    let active = 0;
    let maximum = 0;
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) super(url);
        else super(url, protocols);
        active += 1;
        maximum = Math.max(maximum, active);
        this.addEventListener("close", () => { active -= 1; }, { once: true });
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: TrackedWebSocket });
    Object.defineProperty(window, "__marcusWebSocketStats", {
      configurable: true,
      get: () => ({ active, maximum }),
    });
  });
  page.on("request", (request) => browserRequests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await page.getByLabel("Usuario").fill("browser-admin");
  await page.getByLabel("Contraseña").fill("browser-test-passwordA!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Configuremos el primer LLM" })).toBeVisible();
  await page.getByRole("radio", { name: /DeepSeek/ }).click();
  await page.getByText("Endpoint avanzado").click();
  await page.getByLabel("URL base del proveedor").fill(`http://127.0.0.1:${providerPort}/v1`);
  await page.getByLabel("API key").fill("browser-provider-key");
  await page.getByLabel("Modelo por defecto").fill("browser-model");
  await page.getByRole("button", { name: "Configurar Marcus" }).click();
  await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible();
  await expect(page.getByText("Actividad de agentes", { exact: true })).toBeVisible();
  await expect(page.locator("[data-realtime-status=online]")).toContainText("EN VIVO");
  await page.getByRole("button", { name: "Ayuda de esta pantalla" }).click();
  await expect(page.getByRole("dialog", { name: "Centro de control" })).toContainText("Qué revisar");
  await page.keyboard.press("Escape");
  const sidebarNavigation = page.locator('[data-slot="sidebar-content"]');
  await expect(sidebarNavigation.getByText("Archivos", { exact: true })).toHaveCount(0);
  await expect(sidebarNavigation.getByText("Agentes", { exact: true })).toHaveCount(0);
  await expect(sidebarNavigation.getByRole("link", { name: "Buscar", exact: true })).toHaveCount(0);
  await expect(page.locator("header").getByRole("link", { name: "Buscar", exact: true })).toBeVisible();

  await page.locator("header").getByRole("link", { name: "Buscar", exact: true }).click();
  await page.getByPlaceholder("Agente, path, Run ID, error, concepto…").fill("Browser Runner");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByText("Browser Runner", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Runtime", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Runtime" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Procesos/ })).toBeVisible();
  await page.getByRole("link", { name: "Logs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Eventos de logs" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Fecha y hora" })).toBeVisible();
  await expectDocumentScrollOnly(page);

  await page.getByRole("link", { name: "Agent Studio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent Studio" })).toBeVisible();
  await page.getByLabel("Necesidad").fill("Planificá un agente que reciba una consulta operativa y responda con datos verificables.");
  await page.getByRole("button", { name: "Planificar agente" }).click();
  await expect(page.locator("[data-agent-plan]")).toContainText("Operational Planner", { timeout: 30_000 });
  await page.getByRole("button", { name: "Crear y activar" }).click();
  const studioActivity = page.locator("[data-agent-generation-activity]");
  await expect(studioActivity).toBeVisible();
  await expect(studioActivity).toContainText("provider.chat.completions", { timeout: 10_000 });
  await expect(studioActivity).toContainText("deepseek · browser-model");
  await expect(page.getByRole("heading", { name: "Studio Assistant" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "General", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Acceso administrativo" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Administradores/u })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Acceso MCP/u }).click();
  await page.getByRole("button", { name: "Crear token MCP" }).click();
  const mcpDialog = page.getByRole("dialog", { name: "Crear acceso MCP global" });
  await mcpDialog.getByLabel("Nombre").fill("Playwright Codex");
  await mcpDialog.getByRole("button", { name: "Crear token" }).click();
  const mcpSecret = await mcpDialog.locator("[data-mcp-token-secret]").textContent();
  expect(mcpSecret).toMatch(/^marcus_/u);
  const mcpClient = await playwrightRequest.newContext();
  const mcpHeaders = { Accept: "application/json, text/event-stream", Authorization: `Bearer ${mcpSecret}`, "MCP-Protocol-Version": "2025-11-25" };
  const mcpInitialize = await mcpClient.post(`http://127.0.0.1:${providerPort - 1}/mcp`, {
    headers: mcpHeaders,
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "playwright", version: "1" } } },
  });
  expect(mcpInitialize.status()).toBe(200);
  expect(await mcpInitialize.json()).toMatchObject({ result: { serverInfo: { name: "marcus" } } });
  const mcpTools = await mcpClient.post(`http://127.0.0.1:${providerPort - 1}/mcp`, {
    headers: mcpHeaders,
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  expect(mcpTools.status()).toBe(200);
  expect((await mcpTools.json() as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toContain("agents_build");
  await mcpDialog.getByRole("button", { name: "Listo" }).click();
  const mcpRow = page.getByRole("row").filter({ has: page.getByText("Playwright Codex", { exact: true }) });
  await mcpRow.getByRole("button", { name: "Revocar" }).click();
  await expect(mcpRow.getByText("revoked", { exact: true })).toBeVisible();
  const revokedMcp = await mcpClient.post(`http://127.0.0.1:${providerPort - 1}/mcp`, {
    headers: mcpHeaders,
    data: { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
  });
  expect(revokedMcp.status()).toBe(401);
  await mcpClient.dispose();

  await page.getByRole("tab", { name: /Administradores/u }).click();
  await page.getByRole("button", { name: "Nuevo administrador" }).click();
  const administratorDialog = page.getByRole("dialog", { name: "Crear administrador" });
  await administratorDialog.getByLabel("Usuario").fill("browser-admin-two");
  await administratorDialog.getByLabel("Contraseña", { exact: true }).fill("SecondA!");
  await administratorDialog.getByLabel("Confirmar contraseña").fill("SecondA!");
  await administratorDialog.getByRole("button", { name: "Crear administrador" }).click();
  await expect(page.getByText("browser-admin-two", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Mi contraseña", exact: true }).click();
  const passwordCard = page.locator('[data-slot="card"]').filter({ has: page.getByText("Tu contraseña", { exact: true }) });
  await passwordCard.getByLabel("Contraseña actual").fill("browser-test-passwordA!");
  await passwordCard.getByLabel("Nueva contraseña").fill("BrowserChangedA!");
  await passwordCard.getByLabel("Confirmar contraseña").fill("BrowserChangedA!");
  await passwordCard.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText("Contraseña actualizada")).toBeVisible();

  await page.getByRole("link", { name: "Proveedores", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible();
  await expect(page.getByText("deepseek", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("agent.default", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Probar", exact: true }).click();
  await expect(page.getByText("Proveedor disponible")).toBeVisible();
  await page.getByRole("tab", { name: "LLM predeterminado", exact: true }).click();
  await expect(page.getByText("Reconfigurar LLM global", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Roles de modelo/u }).click();
  await expect(page.getByRole("heading", { name: "Asignaciones activas" })).toBeVisible();

  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await expect(page.getByText("Browser Runner", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Abrir", exact: true }).first().click();
  await expect(page.getByText('"text": "PLAYWRIGHT"')).toBeVisible();
  await expectDocumentScrollOnly(page);
  await page.getByRole("link", { name: "Runs", exact: true }).first().click();
  await page.getByRole("link", { name: "Proyectos", exact: true }).first().click();
  const projectsResponse = await page.request.get("/api/projects");
  expect(projectsResponse.status()).toBe(200);
  const projectsEnvelope = await projectsResponse.json() as { data: Array<{ projectId: string; name: string }> };
  const browserProject = projectsEnvelope.data.find((project) => project.name === "Browser Project");
  expect(browserProject).toBeDefined();
  const initialMembersResponse = await page.request.get(`/api/projects/${browserProject!.projectId}/members`);
  expect(initialMembersResponse.status()).toBe(200);
  expect((await initialMembersResponse.json() as { data: unknown[] }).data).toEqual([]);

  await page.getByRole("button", { name: "Nuevo proyecto" }).first().click();
  await page.getByLabel("Slug").fill("next-browser-project");
  await page.getByLabel("Nombre").fill("Next Browser Project");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByText("Next Browser Project", { exact: true })).toBeVisible();
  const projectsAfterCreate = await (await page.request.get("/api/projects")).json() as { data: Array<{ projectId: string; name: string }> };
  const nextBrowserProject = projectsAfterCreate.data.find((project) => project.name === "Next Browser Project");
  expect(nextBrowserProject).toBeDefined();

  const browserCard = page.locator('[data-slot="card"]').filter({ has: page.getByText("Browser Project", { exact: true }) });
  await browserCard.getByRole("link", { name: "Abrir proyecto" }).click();
  await expect(page.getByRole("heading", { name: "Browser Project" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Dashboard/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Consumo de agentes", { exact: true })).toBeVisible();
  await expect(page.getByText("browser-check.txt", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Usuarios/ }).click();
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
  const projectUsers = page.locator('section[aria-labelledby="project-users-title"]');
  await expect(projectUsers.getByText("browser-admin", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  const memberDialog = page.getByRole("dialog", { name: "Crear usuario del Project" });
  await memberDialog.getByLabel("Usuario").fill("project-viewer");
  await memberDialog.getByLabel("Rol").selectOption("project_viewer");
  await memberDialog.getByLabel("Contraseña", { exact: true }).fill("ProjectA!");
  await memberDialog.getByLabel("Confirmar contraseña").fill("ProjectA!");
  await memberDialog.getByRole("button", { name: "Crear usuario" }).click();
  await expect(page.getByText("project-viewer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar project-viewer" }).click();
  const editMemberDialog = page.getByRole("dialog", { name: "Editar project-viewer" });
  await editMemberDialog.getByLabel("Usuario").fill("project-operator");
  await editMemberDialog.getByLabel("Rol").selectOption("project_operator");
  await editMemberDialog.getByLabel("Nueva contraseña").fill("ProjectUpdatedA!");
  await editMemberDialog.getByLabel("Confirmar contraseña").fill("ProjectUpdatedA!");
  await editMemberDialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("project-operator", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Tu infraestructura agéntica, bajo control." })).toBeVisible();
  await page.getByLabel("Usuario", { exact: true }).fill("project-operator");
  await page.getByLabel("Contraseña").fill("ProjectUpdatedA!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible();
  await page.getByRole("link", { name: "Proyectos", exact: true }).first().click();
  await expect(page.getByText("Browser Project", { exact: true })).toBeVisible();
  await expect(page.getByText("Next Browser Project", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "General", exact: true })).toHaveCount(0);
  const memberBrowserCard = page.locator('[data-slot="card"]').filter({ has: page.getByText("Browser Project", { exact: true }) });
  await memberBrowserCard.getByRole("link", { name: "Abrir proyecto" }).click();
  await page.getByRole("tab", { name: /Usuarios/ }).click();
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo usuario" })).toHaveCount(0);
  await expect(page.getByText("Sólo lectura", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Tu infraestructura agéntica, bajo control." })).toBeVisible();
  await page.getByLabel("Usuario", { exact: true }).fill("browser-admin");
  await page.getByLabel("Contraseña").fill("BrowserChangedA!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible();
  await page.getByRole("link", { name: "Proyectos", exact: true }).first().click();
  const returnedBrowserCard = page.locator('[data-slot="card"]').filter({ has: page.getByText("Browser Project", { exact: true }) });
  await returnedBrowserCard.getByRole("link", { name: "Abrir proyecto" }).click();
  await page.getByRole("tab", { name: /Usuarios/ }).click();
  await page.getByRole("button", { name: "Eliminar acceso de project-operator" }).click();
  await page.getByRole("button", { name: "Eliminar acceso", exact: true }).click();
  await expect(page.getByText("project-operator", { exact: true })).toHaveCount(0);

  const filesResponse = await page.request.get(`/api/projects/${browserProject!.projectId}/files`);
  expect(filesResponse.status()).toBe(200);
  expect((await filesResponse.json() as { data: Array<{ relativePath: string }> }).data.some((file) => file.relativePath === "browser-check.txt")).toBe(true);

  await page.getByRole("tab", { name: /Dashboard/ }).click();
  await page.getByRole("link", { name: "Ver todos" }).click();
  await expect(page.getByRole("heading", { name: "Archivos" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo archivo" }).click();
  await page.getByLabel("Path lógico").fill("project:/next-check.md");
  await page.getByLabel("Contenido inicial").fill("Next + Bun + Marcus");
  await page.getByRole("button", { name: "Guardar archivo" }).click();
  await expect(page.getByRole("cell", { name: "next-check.md" })).toBeVisible();

  await page.getByRole("link", { name: "next-check.md" }).click();
  await expect(page.getByLabel("Contenido Markdown")).toHaveValue("Next + Bun + Marcus");
  await page.getByLabel("Contenido Markdown").fill("# Next + Bun + Marcus\n\nEditado con Playwright.\n\n- lista visible\n\n```ts\nconst runtime = 'bun';\n```");
  const sourceHighlighter = page.locator("[data-markdown-highlighter]");
  await expect(sourceHighlighter.locator('[data-markdown-token="heading"]')).toContainText("# Next + Bun + Marcus");
  await expect(sourceHighlighter.locator('[data-markdown-token="text"]')).toContainText("Editado con Playwright.");
  await expect(sourceHighlighter.locator('[data-markdown-token="list"]')).toContainText("- lista visible");
  await expect(sourceHighlighter.locator('[data-markdown-token="code-fence"]')).toHaveCount(2);
  await expect(sourceHighlighter.locator('[data-markdown-token="code"]')).toContainText("const runtime = 'bun';");
  const syntaxColors = await sourceHighlighter.locator("[data-markdown-token]").evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color));
  expect(new Set(syntaxColors).size).toBeGreaterThanOrEqual(4);
  const caretColor = await page.getByLabel("Contenido Markdown").evaluate((editor) => getComputedStyle(editor).caretColor);
  expect(caretColor).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("button", { name: "Guardado" })).toBeVisible();

  await page.getByRole("link", { name: "Proyecto", exact: true }).click();
  await page.getByRole("button", { name: "Subir archivo" }).first().click();
  await page.getByLabel("Archivo local").setInputFiles({ name: "uploaded.md", mimeType: "text/markdown", buffer: Buffer.from("# Uploaded by Playwright") });
  await page.getByRole("button", { name: "Subir", exact: true }).click();
  await expect(page.getByText("uploaded.md", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Crear agente con AI" }).first().click();
  await page.getByLabel("¿Qué tiene que hacer?").fill("Creá un asistente que responda un mensaje de prueba de forma breve.");
  await page.getByRole("button", { name: "Generar agente" }).click();
  await expect(page.getByRole("status")).toContainText("Generando el agente con deepseek · browser-model", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Playwright Assistant" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Editar fuente" })).toBeVisible();

  await page.getByRole("link", { name: "Editar fuente" }).click();
  await expect(page.getByText(/Revisión v[1-9]\d*/u)).toBeVisible();
  const backToAgent = page.getByRole("link", { name: "Volver al agente" });
  await expect(backToAgent).toHaveAttribute("href", `/projects/${browserProject!.projectId}/agents/playwright-assistant`);
  await backToAgent.click();
  await expect(page.getByRole("heading", { name: "Playwright Assistant" })).toBeVisible();
  await page.getByRole("link", { name: "Editar fuente" }).click();
  await page.getByRole("button", { name: "Agente AI" }).click();
  const agentAiDialog = page.getByRole("dialog", { name: "Editar con Agente AI" });
  await agentAiDialog.getByLabel("¿Qué querés cambiar?").fill("Agregá api-enabled: true al frontmatter sin modificar el resto del agente.");
  await agentAiDialog.getByRole("button", { name: "Aplicar con Agente AI" }).click();
  await expect(agentAiDialog.getByText("Cambio aplicado y versión activada")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Contenido Markdown")).toHaveValue(/api-enabled: true/u);
  await expect(page.getByText(/Revisión v[2-9]\d*/u)).toBeVisible();
  await agentAiDialog.getByRole("button", { name: "Cerrar" }).click();

  await page.goto(`/projects/${browserProject!.projectId}/agents/playwright-assistant`);
  await expect(page.getByRole("heading", { name: "Playwright Assistant" })).toBeVisible();
  await expect(page.getByText("clean", { exact: true })).toBeVisible();
  await expect(page.locator("[data-agent-version-created-at]")).toHaveCount(2);
  await expect(page.locator("[data-agent-version-created-at]").first()).toContainText(/\d{1,2}:\d{2}/u);
  await page.getByRole("button", { name: "Ver compilado" }).first().click();
  const compiledDialog = page.getByRole("dialog", { name: "Artefacto compilado" });
  await expect(compiledDialog.locator("[data-compiled-javascript]")).toContainText("playwright-assistant");
  await compiledDialog.getByRole("tab", { name: "TypeScript generado" }).click();
  await expect(compiledDialog.locator("[data-compiled-typescript]")).toContainText("const manifest=");
  await compiledDialog.getByRole("tab", { name: "Manifest JSON" }).click();
  await expect(compiledDialog.locator("[data-compiled-manifest]")).toContainText('"schemaVersion": "marcus.agent/v1"');
  await compiledDialog.getByRole("button", { name: "Cerrar" }).click();

  await page.getByRole("link", { name: "Editar fuente" }).click();
  const manuallyEditedSource = `${await page.getByLabel("Contenido Markdown").inputValue()}\n\n# Notes\n\nEdición manual validada por Playwright.\n`;
  await page.getByLabel("Contenido Markdown").fill(manuallyEditedSource);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("button", { name: "Guardado" })).toBeVisible();
  await page.goto(`/projects/${browserProject!.projectId}/agents/playwright-assistant`);
  await expect(page.getByText("dirty", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cambios guardados pendientes" })).toBeVisible();
  await expect(page.locator("[data-agent-version-created-at]")).toHaveCount(2);
  await page.getByRole("button", { name: "Usar esta edición" }).click();
  const applyDialog = page.getByRole("alertdialog", { name: "¿Usar esta edición como nueva versión activa?" });
  await applyDialog.getByRole("button", { name: "Validar y activar" }).click();
  await expect(page.getByText("La edición fue validada y activada como nueva versión")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("clean", { exact: true })).toBeVisible();
  await expect(page.locator("[data-agent-pending-source]")).toHaveCount(0);
  await expect(page.locator("[data-agent-version-created-at]")).toHaveCount(3);

  await expect(page.getByRole("switch", { name: "Acceso por API" })).toBeChecked();
  const endpoint = page.locator("[data-agent-api-endpoint]");
  await expect(endpoint).toContainText(`/api/v1/projects/${browserProject!.projectId}/agents/playwright-assistant/invoke`, { timeout: 30_000 });
  const apiExample = page.locator("pre").filter({ hasText: "curl -X POST" });
  await expect(apiExample).toContainText("Authorization: Bearer $MARCUS_TOKEN");
  await expect(apiExample).toContainText('"message": "El cliente no puede ingresar a su cuenta."');
  await expect(page.locator("[data-agent-input-example-source]")).toContainText("browser-model");
  await expect(apiExample).not.toContainText("\n+");
  await page.getByRole("link", { name: "Test case" }).click();
  await expect(page).toHaveURL(`/projects/${browserProject!.projectId}/agents/playwright-assistant/test-case`);
  await expect(page.getByRole("heading", { name: "Test case vía API" })).toBeVisible();
  await expect(page.getByText("Contrato activo", { exact: true })).toBeVisible();
  await expect(page.getByText('"message"', { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel("Input JSON del test case")).toHaveValue(/"message": "El cliente no puede ingresar a su cuenta\."/u);
  await page.getByLabel("Input JSON del test case").fill(JSON.stringify({ message: "Resumí este caso de prueba." }, null, 2));
  const testCaseRequestOffset = browserRequests.length;
  await page.getByRole("button", { name: "Probar agente" }).click();
  await expect(page.locator("[data-agent-test-progress]")).toContainText(/Ejecución (aceptada|completada)/u, { timeout: 10_000 });
  await expect(page.locator("[data-agent-test-response]")).toContainText("Respuesta del test case.", { timeout: 30_000 });
  await expect(page.locator("[data-agent-test-progress]")).toContainText("Ejecución completada");
  await page.getByRole("link", { name: "Browser Project" }).click();
  await page.getByRole("tab", { name: /Tokens/ }).click();
  await expect(page.getByText("playwright-assistant", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Crear token" }).click();
  const tokenDialog = page.getByRole("dialog", { name: "Crear token del Project" });
  await tokenDialog.getByLabel("Nombre").fill("Playwright integration");
  await tokenDialog.getByRole("button", { name: "Crear token" }).click();
  const tokenSecret = await tokenDialog.locator("[data-project-token-secret]").textContent();
  expect(tokenSecret).toMatch(/^marcus_/u);
  await tokenDialog.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByText("Playwright integration", { exact: true })).toBeVisible();
  const tokenClient = await playwrightRequest.newContext();
  const tokenRuns = await tokenClient.get(`http://127.0.0.1:${providerPort - 1}/api/v1/projects/${browserProject!.projectId}/runs`, { headers: { Authorization: `Bearer ${tokenSecret}` } });
  expect(tokenRuns.status()).toBe(200);
  const crossProjectRuns = await tokenClient.get(`http://127.0.0.1:${providerPort - 1}/api/v1/projects/${nextBrowserProject!.projectId}/runs`, { headers: { Authorization: `Bearer ${tokenSecret}` } });
  expect(crossProjectRuns.status()).toBe(403);
  const tokenRow = page.getByRole("row").filter({ has: page.getByText("Playwright integration", { exact: true }) });
  await tokenRow.getByRole("button", { name: "Revocar" }).click();
  await expect(tokenRow.getByText("revoked", { exact: true })).toBeVisible();
  const revokedTokenRuns = await tokenClient.get(`http://127.0.0.1:${providerPort - 1}/api/v1/projects/${browserProject!.projectId}/runs`, { headers: { Authorization: `Bearer ${tokenSecret}` } });
  expect(revokedTokenRuns.status()).toBe(401);
  await tokenClient.dispose();

  await page.getByRole("button", { name: "Abrir Marcus AI" }).click();
  await expect(page.getByRole("heading", { name: "Construí y operá Marcus conversando." })).toBeVisible();
  await page.getByLabel("Mensaje para Marcus AI").fill("Listá los proyectos actuales.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByText("Marcus está operativo. Consulté el catálogo real de proyectos mediante Marcus API.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("projects_list", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "Cerrar Marcus AI" }).click();
  await page.getByRole("link", { name: "Proyectos", exact: true }).first().click();
  const createdCard = page.locator('[data-slot="card"]').filter({ has: page.getByText("Next Browser Project", { exact: true }) });
  await createdCard.getByRole("link", { name: "Abrir proyecto" }).click();
  await page.getByRole("button", { name: "Eliminar proyecto" }).click();
  await page.getByRole("button", { name: "Eliminar definitivamente" }).click();
  await expect(page.getByRole("heading", { name: "Proyectos" })).toBeVisible();
  await expect(page.getByText("Next Browser Project", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Nuevo proyecto" }).first().click();
  await page.getByLabel("Slug").fill("next-browser-project");
  await page.getByLabel("Nombre").fill("Proyecto recreado");
  await page.getByRole("button", { name: "Crear proyecto", exact: true }).click();
  await expect(page.getByText("Proyecto recreado", { exact: true })).toBeVisible();

  expect(browserRequests.filter((path) => path.includes("/agents/generations/")), "agent activities must not poll over HTTP").toEqual([]);
  expect(browserRequests.slice(testCaseRequestOffset).filter((path) => /\/api\/projects\/[^/]+\/runs\/[^/]+$/u.test(path)), "test case follow-up must use WebSocket").toEqual([]);
  const websocketStats = await page.evaluate(() => (window as typeof window & { __marcusWebSocketStats: { active: number; maximum: number } }).__marcusWebSocketStats);
  expect(websocketStats.maximum, "the Backoffice must keep at most one WebSocket per document").toBeLessThanOrEqual(1);

  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});
