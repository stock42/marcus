import { expect, test, type Page } from "@playwright/test";

type BrowserErrors = { page: string[]; console: string[] };

function captureBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { page: [], console: [] };
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  return errors;
}

test("the production website serves the installer and the real CLI journey", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Tus agentes dejan de ser demos/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Creá un agente ahora/ })).toHaveAttribute("href", "/studio");
  await expect(page.getByText("CLI + servidor · instalación estable")).toBeVisible();
  await expect(page).toHaveTitle("Marcus Agentic OS | Infraestructura para agentes de IA");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://projectmarcus.com/marcus-agentic-os-opengraph.png");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain("SoftwareApplication");
  await expect(page.getByRole("link", { name: "Stock42 LLC" })).toHaveAttribute("href", "https://stock42.com");

  const install = await page.request.get("/install");
  expect(install.status()).toBe(200);
  expect((await install.text()).startsWith("#!/bin/sh\n")).toBe(true);

  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap: https://projectmarcus.com/sitemap.xml");

  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("<loc>https://projectmarcus.com</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/empresas</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/casos-de-uso</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/documentacion</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/studio</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/documentacion/sdk</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/documentacion/markdown</loc>");
  expect(sitemapText).toContain("<loc>https://projectmarcus.com/documentacion/tools</loc>");

  const socialImage = await page.request.get("/marcus-agentic-os-opengraph.png");
  expect(socialImage.status()).toBe(200);
  expect(socialImage.headers()["content-type"]).toBe("image/png");

  const llms = await page.request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain("# Marcus Agentic OS");

  const terminal = page.locator("[data-terminal-output]");
  const consoleJourney = page.locator("[data-console]");
  const initialConsoleHeight = await consoleJourney.evaluate((element) => element.getBoundingClientRect().height);

  await page.getByRole("button", { name: "Pausar animaciones" }).click();
  await expect(terminal.getByText("curl -fsSL https://projectmarcus.com/install | sh", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Iniciar/ }).click();
  await expect(terminal.getByText('Password for "admin" (press Enter to connect):', { exact: true })).toBeVisible();
  await expect(terminal.getByText(/Marcus CLI 0\.1\.0 · MNP\/1/)).toBeVisible();
  await expect(terminal.getByText(/LLM: not configured/)).toBeVisible();
  const nextConsoleHeight = await consoleJourney.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(nextConsoleHeight - initialConsoleHeight)).toBeLessThan(1);
  const terminalViewport = await terminal.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(terminalViewport.overflowY).toBe("auto");
  expect(terminalViewport.scrollHeight).toBeGreaterThan(terminalViewport.clientHeight);
  expect(await terminal.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  })).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Reanudar animaciones" }).click();
  await expect.poll(async () => terminal.evaluate((element) => element.scrollTop), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pausar animaciones" }).click();

  await page.getByRole("tab", { name: /Proyecto/ }).click();
  await expect(terminal.getByText("marcus> project create testing-project", { exact: true })).toBeVisible();
  await expect(terminal.getByText(/"projectId": "prj_019ff2fda9e97000b6069cdc9c22b180"/).first()).toBeVisible();
  await expect(terminal.getByText("marcus[testing-project:project:/]>", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Agente/ }).click();
  await expect(terminal.getByText(/agent scaffold \.\/alertas --kind sdk/)).toBeVisible();
  await expect(terminal.getByText(/agent run alertas --input/)).toBeVisible();
  await expect(terminal.getByText(/"state": "queued"/)).toBeVisible();
  await expect(terminal).not.toContainText("842 ms");

  await expect(page.getByRole("heading", { name: /IA conectada con/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Explorar todos los casos de uso/ })).toHaveAttribute("href", "/casos-de-uso");
  await expect(page.getByRole("link", { name: "Documentación" }).first()).toHaveAttribute("href", "/documentacion");

  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("Agent Studio generates, validates, iterates, compares and downloads over HTTP plus WebSocket", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/studio");

  await expect(page).toHaveTitle(/Agent Studio/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/studio");
  await expect(page.getByRole("heading", { name: "Agent Studio", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(page.locator(".studio-connection").getByText("Tiempo real listo", { exact: true })).toBeVisible();
  await expect(page.getByText("10/10", { exact: true })).toBeVisible();
  const brief = await page.locator(".studio-composer").boundingBox();
  const source = await page.locator(".studio-source").boundingBox();
  const terminal = await page.locator(".studio-terminal").boundingBox();
  expect(brief).not.toBeNull();
  expect(source).not.toBeNull();
  expect(terminal).not.toBeNull();
  expect(Math.abs((brief?.y ?? 0) - (source?.y ?? 0))).toBeLessThan(2);
  expect(source?.x ?? 0).toBeGreaterThan((brief?.x ?? 0) + (brief?.width ?? 0) - 2);
  expect(terminal?.y ?? 0).toBeGreaterThan((brief?.y ?? 0) + (brief?.height ?? 0) - 2);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

  await page.getByRole("button", { name: "Generar agente" }).click();
  await expect(page.getByText("✓ Válido para Marcus", { exact: true })).toBeVisible();
  await expect(page.getByText("schema: marcus.agent/v1", { exact: true })).toBeVisible();
  await expect(page.getByText("9/10", { exact: true })).toBeVisible();
  await expect(page.getByText("Actividad verificable. El razonamiento privado no se expone ni se almacena.")).toBeVisible();

  await page.getByLabel("Ajuste sobre v1").fill("Agregá el año de estreno a cada recomendación.");
  await page.getByRole("button", { name: "Crear nueva versión" }).click();
  await expect(page.getByText("Ajuste sobre v2", { exact: true })).toBeVisible();
  await expect(page.getByText("year:", { exact: true })).toBeVisible();
  await expect(page.getByText("8/10", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Comparar" }).click();
  await expect(page.getByRole("heading", { name: "v1 → v2" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar comparación" }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar" }).click();
  expect((await download).suggestedFilename()).toBe("movie-recommender.agent.md");

  await page.locator(".studio-history summary").click();
  const firstVersion = page.locator(".studio-history li").filter({ hasText: "v1 · Movie Recommender" });
  await firstVersion.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByText("Ajuste sobre v1", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.locator(".studio-connection").getByText("Tiempo real listo", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("the documentation hub teaches Markdown and MCP workflows for Codex and Claude", async ({ page, request }) => {
  const errors = captureBrowserErrors(page);
  await page.goto("/documentacion");

  await expect(page.getByRole("heading", { name: /Del brief al agente/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/documentacion");
  await expect(page.locator("pre").filter({ hasText: "schema: marcus.agent/v1" }).first()).toBeVisible();
  const incidentExample = page.locator(".example-card").filter({ has: page.getByRole("heading", { name: "Plan de mitigación con control humano" }) });
  await incidentExample.getByText("Ver fuente completa").click();
  await expect(incidentExample.locator("pre").filter({ hasText: "marcus/approvals.request" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conectá el servidor local" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registralo por Streamable HTTP" })).toBeVisible();
  await expect(page.getByText("documentation_bundle", { exact: true }).first()).toBeVisible();
  const manualLink = page.getByRole("link", { name: "Descargar Manual de Usuario de Marcus 0.1.0 revisión 3 en PDF" });
  await expect(manualLink).toHaveAttribute("href", "/downloads/marcus-manual-de-usuario-es-0.1.0-rev3.pdf");
  await expect(manualLink).toHaveAttribute("download", "Marcus_Manual_de_Usuario_ES_0.1.0.rev3.pdf");
  const manualResponse = await request.get("/downloads/marcus-manual-de-usuario-es-0.1.0-rev3.pdf");
  expect(manualResponse.ok()).toBe(true);
  expect(manualResponse.headers()["content-type"]).toContain("application/pdf");
  expect((await manualResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain("CollectionPage");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("use cases and enterprise pages expose concrete, honest operating paths", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.goto("/casos-de-uso");
  await expect(page.getByRole("heading", { name: /Agentes que viven en/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Triage y respuesta de soporte" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coordinación de incidentes" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/casos-de-uso");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/empresas");
  await expect(page.getByRole("heading", { name: /Tu servidor de agentes/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Servidor Linux de la empresa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instancia privada dentro de tu VPC" })).toBeVisible();
  await expect(page.getByText(/no agrega un medidor comercial por cada agente/)).toBeVisible();
  await expect(page.getByText(/CPU, memoria, almacenamiento/)).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/empresas");
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain("FAQPage");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("the public SDK, Markdown and Tools guides document the executable authoring flow", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.goto("/documentacion/sdk");

  await expect(page.getByRole("heading", { name: /De un archivo TypeScript a un agente versionado/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/documentacion/sdk");
  await expect(page.getByText("agent scaffold ./hello --kind sdk", { exact: true })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "agent create project:/agents/hello/index.ts" })).toBeVisible();
  await expect(page.getByText(/createAgentTestHarness/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Diseñá una fuente TypeScript en Agent Studio/ })).toHaveAttribute("href", "/studio?format=typescript");

  await page.goto("/documentacion/markdown");
  await expect(page.getByRole("heading", { name: /Agentes legibles por humanos/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/documentacion/markdown");
  await expect(page.getByText("schema: marcus.agent/v1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("schema must be marcus.agent/v1", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Convertí tu brief en un agente Markdown/ })).toHaveAttribute("href", "/studio?format=markdown");

  await page.goto("/documentacion/tools");
  await expect(page.getByRole("heading", { name: /Poder para actuar/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://projectmarcus.com/documentacion/tools");
  await expect(page.getByText("marcus/files.delete", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("marcus/approvals.request", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("TOOL RUNTIME · 13 CAPACIDADES · AGENTVERSION", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});

test("the Next landing remains usable on a narrow viewport", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Tus agentes dejan de ser demos/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.page, "unhandled page errors").toEqual([]);
  expect(errors.console, "browser console errors").toEqual([]);
});
