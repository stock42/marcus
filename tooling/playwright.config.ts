import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const toolingDirectory = fileURLToPath(new URL(".", import.meta.url));
const backofficePort = Number(process.env.MARCUS_BACKOFFICE_TEST_PORT ?? "4313");
const apiPort = Number(process.env.MARCUS_BACKOFFICE_API_TEST_PORT ?? "4314");
const baseURL = `http://127.0.0.1:${backofficePort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;
const backofficeLogs = resolve(toolingDirectory, "../artifacts/playwright-backoffice/logs");

export default defineConfig({
  testDir: toolingDirectory,
  testMatch: "backoffice.playwright.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "../artifacts/playwright-backoffice",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `MARCUS_BACKOFFICE_API_TEST_PORT=${apiPort} bun serve-backoffice-test.ts`,
      cwd: toolingDirectory,
      url: `${apiURL}/health/live`,
      reuseExistingServer: false,
      timeout: 10_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    },
    {
      command: `MARCUS_API_URL=${apiURL} MARCUS_BACKOFFICE_PORT=${backofficePort} MARCUS_LOGS_DIR=${backofficeLogs} bun run start`,
      cwd: resolve(toolingDirectory, "../apps/marcus-backoffice"),
      url: baseURL,
      reuseExistingServer: false,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    },
  ],
});
