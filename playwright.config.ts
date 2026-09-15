import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the dev server with a throwaway database seeded by global-setup (the Sevilla x
 * Valencia slate). No AI key is needed: the app serves pre-generated inventory; generation is a
 * background job and is not exercised here.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3300", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "pt-BR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "DATA_DIR=data/e2e ADMIN_EMAIL=admin@betmatic.app ADMIN_PASSWORD=betmatic2026 npx next dev -p 3300",
    url: "http://localhost:3300/login",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
