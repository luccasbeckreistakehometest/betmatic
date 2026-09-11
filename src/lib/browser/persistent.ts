import { chromium, type BrowserContext } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PROFILE_DIR = path.join(process.cwd(), ".browser-profiles");

/**
 * A persistent, headed browser profile.
 *
 * Why this exists, measured against Betano's live pages: a headless, cookie-less session gets 403
 * across essentially the whole authenticated surface — market offers, the live event feed, live
 * stats, sportsbook settings, and the signalr socket that pushes in-play updates — and the
 * Sportradar widget loader (widgets.sir.sportradar.com/.../widgetloader) fails outright. That last
 * one is why the Stream / Campo / Estatísticas panel has zero elements in the DOM rather than
 * merely being hard to click: the widget never renders, so there is nothing to click. Only the
 * match clock survives, because it ships in the initial HTML.
 *
 * A persistent profile keeps the cookies and storage that make a site treat the client as a
 * returning visitor, and running headed passes the checks that look for automation. It opens a
 * visible window, so it belongs in an interactive run or on a machine with a display — never in a
 * headless server job.
 *
 * Blocking also hardens with volume: early scrapes of the same site succeeded and later ones did
 * not. A caller needs rate limiting as much as it needs a session.
 *
 * Measured outcome of switching to headed: the Stream / Campo / Estatísticas tab bar renders and is
 * clickable, where headless produced zero matching elements. The statistics panel itself still did
 * not populate in testing, so the widget wants more than a headed window — treat live team stats as
 * unavailable until that is proven, rather than assuming this unlocked them.
 */
export async function withPersistentContext<T>(
  profile: string,
  fn: (ctx: BrowserContext) => Promise<T>,
  options: { headless?: boolean } = {},
): Promise<T> {
  const dir = path.join(PROFILE_DIR, profile);
  fs.mkdirSync(dir, { recursive: true });

  const ctx = await chromium.launchPersistentContext(dir, {
    headless: options.headless ?? false,
    viewport: { width: 1600, height: 1100 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Dismisses the cookie banner, which sits above the page and silently swallows clicks meant for
 * anything underneath. With a persistent profile this only has to happen on the first run.
 */
export async function acceptCookies(page: import("playwright").Page): Promise<boolean> {
  for (const label of ["Permitir Todos", "Aceitar Todos", "Aceitar", "Allow All", "Accept All"]) {
    const btn = page.getByText(label, { exact: true }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(2_000);
      return true;
    }
  }
  return false;
}

export function profileExists(profile: string): boolean {
  return fs.existsSync(path.join(PROFILE_DIR, profile));
}

/** Endpoints observed returning 403 to a headless session; reachable targets once authenticated. */
export const BETANO_GATED_ENDPOINTS = {
  markets: (eventId: string) => `/api/event/markets-offers/${eventId}`,
  liveStats: (eventId: string) => `/api/liveevent/statsplayer?id=${eventId}`,
  liveFeed: (eventId: string) => `/danae-webapi/api/live/events/${eventId}/latest`,
} as const;
