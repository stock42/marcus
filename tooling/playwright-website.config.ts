import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const toolingDirectory = fileURLToPath(new URL(".", import.meta.url));
const websitePort = Number(process.env.MARCUS_WEB_TEST_PORT ?? "4322");
const baseURL = `http://127.0.0.1:${websitePort}`;

export default defineConfig({
  testDir: toolingDirectory,
  testMatch: "website.playwright.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "../artifacts/playwright-website",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun tooling/serve-studio-test.ts",
      cwd: resolve(toolingDirectory, ".."),
      url: "http://127.0.0.1:7447/health/live",
      reuseExistingServer: false,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    },
    {
      command: `MARCUS_WEB_PORT=${websitePort} bun run start`,
      cwd: resolve(toolingDirectory, "../apps/marcus-web"),
      url: baseURL,
      reuseExistingServer: false,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    },
  ],
});
