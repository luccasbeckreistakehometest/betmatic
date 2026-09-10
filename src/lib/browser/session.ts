import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { SiteKey } from "@/lib/config";
import type { ScrapeCapture } from "@/lib/types";

const SESSION_DIR = path.join(process.cwd(), ".sessions");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function sessionPath(site: SiteKey): string {
  return path.join(SESSION_DIR, `${site}.json`);
}

export function hasSession(site: SiteKey): boolean {
  return fs.existsSync(sessionPath(site));
}

export function sessionAgeMs(site: SiteKey): number | null {
  try {
    return Date.now() - fs.statSync(sessionPath(site)).mtimeMs;
  } catch {
    return null;
  }
}

export function sessionSummary(
  sites: SiteKey[] = ["x", "propscash", "mamaknowsbets", "dimers"],
): Record<string, { present: boolean; ageMs: number | null }> {
  return Object.fromEntries(sites.map((s) => [s, { present: hasSession(s), ageMs: sessionAgeMs(s) }]));
}

export class NeedsLoginError extends Error {
  constructor(public site: SiteKey) {
    super(`No saved session for "${site}". Run: pnpm login ${site}`);
    this.name = "NeedsLoginError";
  }
}

interface PageRunOptions {
  headless?: boolean;
  requireSession?: boolean;
}

/** Opens a browser context restored from the site's saved session, runs `fn`, then persists any refreshed cookies. */
export async function withPage<T>(
  site: SiteKey,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: PageRunOptions = {},
): Promise<T> {
  const { headless = true, requireSession = true } = opts;
  const storagePath = sessionPath(site);
  const restored = fs.existsSync(storagePath);
  if (requireSession && !restored) throw new NeedsLoginError(site);

  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;
  try {
    browser = await chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    ctx = await browser.newContext({
      storageState: restored ? storagePath : undefined,
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 1100 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await ctx.newPage();
    const result = await fn(page, ctx);
    // Persist rotated cookies/tokens so sessions survive longer.
    if (restored) await ctx.storageState({ path: storagePath });
    return result;
  } finally {
    await ctx?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

/** Headed browser for a one-time manual login; blocks until the operator confirms. */
export async function captureLogin(
  site: SiteKey,
  loginUrl: string,
  waitForConfirm: () => Promise<void>,
): Promise<string> {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const storagePath = sessionPath(site);
  const browser = await chromium.launch({ headless: false, args: ["--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    storageState: fs.existsSync(storagePath) ? storagePath : undefined,
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  await waitForConfirm();
  await ctx.storageState({ path: storagePath });
  await ctx.close();
  await browser.close();
  return storagePath;
}

export interface CaptureOptions {
  waitForSelector?: string;
  loggedOutSelector?: string;
  scrollPasses?: number;
  captureNetworkJson?: boolean;
  screenshot?: boolean;
  timeoutMs?: number;
  /** Set false for open sites — capture then runs without a saved session. */
  requireSession?: boolean;
}

const MAX_JSON_BODY = 180_000;
const MAX_JSON_TOTAL = 700_000;

/**
 * Consent banners, analytics SDKs and tag managers emit enormous JSON blobs — on one real page these
 * were 96% of everything captured. Dropping them keeps the extraction budget on actual page data.
 */
const NOISE_HOSTS =
  /(cookielaw|onetrust|cookiebot|usercentrics|braze|segment\.io|segment\.com|google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.|connect\.facebook|hotjar|mixpanel|amplitude|optimizely|launchdarkly|statsig|sentry\.io|datadoghq|newrelic|nr-data|intercom|fullstory|clarity\.ms|taboola|outbrain|criteo|adservice|quantserve|scorecardresearch|chartbeat|parsely|onesignal|pusher|cloudflareinsights|cosmicjs)/i;

const NOISE_PATHS = /(consent|cookie|geolocation|telemetry|beacon|analytics|gtm|pixel|collect\b|\/ping|session-replay)/i;

function isNoisePayload(url: string, body: string): boolean {
  if (NOISE_HOSTS.test(url)) return true;
  if (NOISE_PATHS.test(url)) return true;
  // Consent payloads that slip past the host list still announce themselves in their keys.
  return /"(DomainData|CookieSPAEnabled|GroupNameMLHtml|otPcPanel|attributes_blacklist)"/.test(body.slice(0, 2000));
}

/**
 * Loads a page inside an authenticated context and captures everything an extractor could need:
 * the JSON the page's own frontend fetched, the rendered text, and any tables serialised to TSV.
 * Capturing the XHR payloads is what makes API-less sites reliably parseable.
 */
export async function capturePage(
  site: SiteKey,
  url: string,
  opts: CaptureOptions = {},
): Promise<ScrapeCapture> {
  const {
    waitForSelector,
    loggedOutSelector,
    scrollPasses = 4,
    captureNetworkJson = true,
    screenshot = false,
    timeoutMs = 45_000,
    requireSession = true,
  } = opts;

  return withPage(site, async (page) => {
    const apiPayloads: { url: string; body: string }[] = [];
    let jsonBudget = MAX_JSON_TOTAL;

    if (captureNetworkJson) {
      page.on("response", async (res) => {
        try {
          if (jsonBudget <= 0) return;
          const ct = res.headers()["content-type"] ?? "";
          if (!ct.includes("json")) return;
          const reqUrl = res.url();
          if (/\.(png|jpg|svg|woff2?|css|js)(\?|$)/i.test(reqUrl)) return;
          if (!res.ok()) return;
          const body = await res.text();
          if (body.length < 40) return;
          if (isNoisePayload(reqUrl, body)) return;
          const trimmed = body.slice(0, MAX_JSON_BODY);
          jsonBudget -= trimmed.length;
          apiPayloads.push({ url: reqUrl, body: trimmed });
        } catch {
          // Response bodies can be unavailable (redirects, aborted requests) — skip quietly.
        }
      });
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 15_000 }).catch(() => {});
    }

    for (let i = 0; i < scrollPasses; i += 1) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(700);
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    let loggedIn = true;
    if (loggedOutSelector) {
      // Any of the comma-separated selectors being visible means the session lapsed.
      for (const sel of loggedOutSelector.split(",").map((s) => s.trim()).filter(Boolean)) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        if (visible) {
          loggedIn = false;
          break;
        }
      }
    }

    const text = await page.evaluate(() => document.body?.innerText ?? "");
    const tables = await page.$$eval("table", (nodes) =>
      nodes.slice(0, 12).map((table) =>
        Array.from(table.querySelectorAll("tr"))
          .slice(0, 200)
          .map((row) =>
            Array.from(row.querySelectorAll("th,td"))
              .map((cell) => (cell as HTMLElement).innerText.replace(/\s+/g, " ").trim())
              .join("\t"),
          )
          .filter(Boolean)
          .join("\n"),
      ),
    );

    let screenshotBase64: string | undefined;
    if (screenshot) {
      const buf = await page.screenshot({ type: "jpeg", quality: 70 });
      if (buf.byteLength < 4_000_000) screenshotBase64 = buf.toString("base64");
    }

    return {
      url,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      text,
      tables: tables.filter((t) => t.length > 0),
      apiPayloads,
      screenshotBase64,
      loggedIn,
    };
  }, { requireSession });
}
