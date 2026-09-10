#!/usr/bin/env node
/**
 * Captures a logged-in browser session for a site that has no API.
 *
 *   pnpm login x
 *   pnpm login propscash
 *   pnpm login mamaknowsbets
 *
 * Opens a real Chromium window, you log in by hand (password, 2FA, captcha — whatever it takes),
 * press Enter, and the cookies + localStorage land in .sessions/<site>.json for the scrapers to reuse.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";

const SITES = {
  x: "x",
  twitter: "x",
  propscash: "propscash",
  mamaknowsbets: "mamaknowsbets",
  mama: "mamaknowsbets",
  dimers: "dimers",
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const arg = (process.argv[2] ?? "").toLowerCase();
const site = SITES[arg];

if (!site) {
  console.error("Usage: pnpm login <x|propscash|mamaknowsbets|dimers>");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "sources.json"), "utf8"));
const loginUrl = config[site]?.loginUrl;
if (!loginUrl) {
  console.error(`No loginUrl configured for "${site}" in config/sources.json`);
  process.exit(1);
}

const sessionDir = path.join(process.cwd(), ".sessions");
const sessionFile = path.join(sessionDir, `${site}.json`);
fs.mkdirSync(sessionDir, { recursive: true });

console.log(`\nOpening ${loginUrl}`);
console.log("Log in in the browser window that just opened.");
console.log("Leave it on a signed-in page, then come back here and press Enter.\n");

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({
  storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
  userAgent: USER_AGENT,
  viewport: { width: 1440, height: 1000 },
  locale: "en-US",
  timezoneId: "America/New_York",
});
const page = await context.newPage();
await page.goto(loginUrl, { waitUntil: "domcontentloaded" }).catch((err) => {
  console.warn(`Could not open ${loginUrl}: ${err.message}`);
  console.warn("Navigate there manually in the open window.");
});

const rl = readline.createInterface({ input: stdin, output: stdout });
await rl.question("Press Enter once you are logged in… ");
rl.close();

const finalUrl = page.url();
await context.storageState({ path: sessionFile });
const state = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
const cookieCount = state.cookies?.length ?? 0;

await context.close();
await browser.close();

console.log(`\nSaved ${cookieCount} cookies to ${path.relative(process.cwd(), sessionFile)}`);
console.log(`Last page was ${finalUrl}`);
if (cookieCount === 0) {
  console.warn("No cookies captured — the login probably did not complete. Run it again.");
  process.exit(1);
}
console.log("Done. The dashboard will reuse this session until the site expires it.\n");
