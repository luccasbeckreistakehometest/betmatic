import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import base from "./playwright.config";

// The same suite against a PRODUCTION build (`next start`): the dev server keeps Turbopack's cache in
// memory and has filled the disk before. Build first with the same env (NEXT_PUBLIC_* is baked in):
//   NEXT_PUBLIC_BASE_URL=http://localhost:3300 NEXT_PUBLIC_LIVE_POLL_MS=1500 npx next build
//   npx playwright test --config playwright.prod.config.ts
// E2E_PRODUCTION_BUILD=1 lets the test switches through the startup guard, on localhost only.
const web = base.webServer as Exclude<PlaywrightTestConfig["webServer"], undefined | unknown[]>;
export default defineConfig({
  ...base,
  // A production server refuses the Telegram webhook without a secret (dev lets it through), so the
  // secret is set here and sent on every request: only the webhook route reads that header.
  use: { ...base.use, extraHTTPHeaders: { "x-telegram-bot-api-secret-token": "e2e-webhook-secret" } },
  webServer: {
    ...web,
    command: "E2E_PRODUCTION_BUILD=1 TELEGRAM_WEBHOOK_SECRET=e2e-webhook-secret " + web.command!.replace("npx next dev -p 3300", "npx next start -p 3300"),
    reuseExistingServer: false,
  },
});
