import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the dev server with a throwaway database seeded by global-setup (the Sevilla x
 * Valencia slate). No AI key is used: the seeded games already have tickets, so opening them never
 * reaches the model. The key is blanked on purpose so a developer's
 * .env.local can never make a spec call the model (existing env wins over .env files).
 *
 * The seeded world is relative to the run's clock, so it can be run at any moment: tests/e2e/
 * fake-clock.cjs moves that clock for seed, server and specs alike when a run has to prove it.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3300", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "pt-BR" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    // Phone widths: the app must never scroll sideways — at 393px, and at the 360px of the cheaper
    // Androids the product's readers actually hold.
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /mobile\.spec\.ts/ },
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // IP limits are scaled up because every spec shares one address; account limits stay real.
    // Checkout talks to tests/e2e/fake-mercadopago.ts (started by global-setup).
    command: [
      "DATA_DIR=data/e2e ANTHROPIC_API_KEY= ANTHROPIC_AUTH_TOKEN= AI_PROVIDER=anthropic OPENAI_API_KEY= ADMIN_EMAIL=admin@betmatic.app ADMIN_PASSWORD=betmatic2026",
      "TELEGRAM_BOT_TOKEN=e2e-token TELEGRAM_BOT_USERNAME=betmatic_e2e_bot TELEGRAM_TRANSPORT=file",
      "APP_URL=http://localhost:3300 NEXT_PUBLIC_BASE_URL=http://localhost:3300 MP_ACCESS_TOKEN=TEST-e2e MP_API_BASE=http://localhost:3399 MP_WEBHOOK_SECRET=",
      // Replayed ESPN, an isolated cache, AI answered by fixtures only while a spec switches it on.
      "ESPN_FIXTURES=data/e2e/espn-fixtures CACHE_DIR=data/e2e/cache AI_MOCK=switch SOFASCORE_DISABLED=1",
      // The books' own hosts are never called from a test: BR_BOOKS_OFFLINE makes every adapter
      // request throw instead of leaving the machine, so a spec can drive the jobs end to end
      // (route, deadline, per-book status, store) without a single request to a real bookmaker.
      "BR_BOOKS_OFFLINE=1",
      // The live panel polls every 1.5 s in tests instead of once a minute.
      "NEXT_PUBLIC_LIVE_POLL_MS=1500 ANALYTICS_ALLOW_HEADLESS=1 RATE_LIMIT_IP_FACTOR=100 PROOF_MIN_DECIDED=1 LIVE_CALIBRATION_MIN_LEGS=1 LIVE_PERIOD_MIN_LEGS=1 LEGAL_NAME= LEGAL_DOCUMENT= LEGAL_ADDRESS= LEGAL_EMAIL= SUPPORT_EMAIL=ajuda@betmatic.test SUPPORT_WHATSAPP=",
      // The seeded world predates the real record window (21/09/2026) — its fixtures are older, and
      // one of them is a football match from another season — so the window is opened back to
      // September 1st rather than left at its production date. Not to 2000: the calibration history
      // the short list needs sits in August precisely so it stays OUT of the published record, and
      // this is the line that keeps it out. /prova counts what it always counted; the wallet's gate
      // reads everything, which is the split `calibrationHeadline` exists to hold.
      "RECORD_START_DAY=2026-09-01",
      "npx next dev -p 3300",
    ].join(" "),
    url: "http://localhost:3300/login",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
