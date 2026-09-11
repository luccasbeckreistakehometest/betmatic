import { chromium } from "playwright";
import type { LiveState } from "@/lib/live/state";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface LiveCapture {
  state: Partial<LiveState> & { minute: number };
  /** Which fields came from the page rather than being assumed. */
  captured: string[];
  missing: string[];
  finalUrl: string;
}

/**
 * Reads what the live page reliably exposes.
 *
 * The match clock and the score parse consistently. The right-hand statistics panel — possession,
 * shots, fouls, cards per side — does not: it renders only for a real user session and its feed
 * (/api/statistics/events/{id}/overview/) refuses a direct fetch. Rather than guess those counters,
 * they are reported as missing so a caller never mistakes an assumption for an observation.
 */
export async function captureLiveState(liveSlug: string, eventId: string): Promise<LiveCapture | null> {
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1600, height: 1100 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    const page = await ctx.newPage();
    const url = `https://www.betano.bet.br/live/${liveSlug}/criar-aposta/${eventId}/`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 50_000 });
    await page.waitForTimeout(3_500);

    const read = await page.evaluate(() => {
      const text = document.body.innerText;
      // The clock renders as M:SS or MM:SS near the fixture header.
      const clock = text.match(/\b(\d{1,3}):(\d{2})\b/);
      const score = text.match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
      return {
        minute: clock ? Number(clock[1]) : null,
        homeGoals: score ? Number(score[1]) : null,
        awayGoals: score ? Number(score[2]) : null,
      };
    });

    if (read.minute === null) return null;

    const captured = ["minute"];
    const missing = ["homeCards", "awayCards", "homeFouls", "awayFouls"];
    if (read.homeGoals !== null) captured.push("score");
    else missing.push("score");

    return {
      state: {
        minute: read.minute,
        homeGoals: read.homeGoals ?? 0,
        awayGoals: read.awayGoals ?? 0,
      },
      captured,
      missing,
      finalUrl: page.url(),
    };
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}
