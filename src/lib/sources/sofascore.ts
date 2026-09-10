import { chromium, type Browser, type BrowserContext } from "playwright";
import { cached } from "@/lib/cache";

const HOME = "https://www.sofascore.com/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TTL = { search: 30 * 60_000, event: 15 * 60_000, referee: 12 * 60 * 60_000, form: 6 * 60 * 60_000 };

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Sofascore's API rejects bare fetches, but serves the site's own XHRs fine. Rather than guess at
 * headers, every call is issued from inside a loaded page so it carries whatever context the site
 * itself sends. One context is reused across calls — launching a browser per request is far slower
 * than the requests themselves.
 */
async function api<T>(path: string): Promise<T | null> {
  if (!browser) {
    browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
    context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: "en-US" });
    const warm = await context.newPage();
    await warm.goto(HOME, { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(() => {});
    await warm.waitForTimeout(1500);
    await warm.close();
  }
  const page = await context!.newPage();
  try {
    await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    return await page.evaluate(async (p) => {
      const res = await fetch(p);
      return res.ok ? ((await res.json()) as unknown) : null;
    }, path) as T | null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeSofascore(): Promise<void> {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  context = null;
  browser = null;
}

export interface SofaEvent {
  id: number;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  startTimestamp: number;
  tournament?: { name?: string; uniqueTournament?: { id?: number; name?: string } };
  referee?: SofaReferee;
}

export interface SofaReferee {
  id: number;
  name: string;
  games: number;
  yellowCards: number;
  redCards: number;
  yellowRedCards: number;
  country?: { name?: string };
}

/** Finds the Sofascore event matching a team pair on a date, so ESPN games can be joined to it. */
export async function findEvent(
  homeName: string,
  awayName: string,
  dateKey: string,
): Promise<SofaEvent | null> {
  const day = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
  return cached(
    `sofa-event-${homeName}-${awayName}-${dateKey}`,
    TTL.search,
    async () => {
      const data = await api<{ events?: SofaEvent[] }>(`/api/v1/sport/football/scheduled-events/${day}`);
      const events = data?.events ?? [];
      const norm = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
      const h = norm(homeName);
      const a = norm(awayName);
      // Names differ between providers ("Man City" vs "Manchester City"), so match on containment.
      const hit = events.find((e) => {
        const eh = norm(e.homeTeam?.name ?? "");
        const ea = norm(e.awayTeam?.name ?? "");
        return (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea));
      });
      return hit ?? null;
    },
  );
}

export async function getEvent(eventId: number): Promise<SofaEvent | null> {
  return cached(`sofa-ev-${eventId}`, TTL.event, async () => {
    const data = await api<{ event?: SofaEvent }>(`/api/v1/event/${eventId}`);
    return data?.event ?? null;
  });
}

export interface SofaLineupPlayer {
  name: string;
  position: string;
  substitute: boolean;
  shirtNumber?: number;
  playerId?: number;
}

export interface SofaLineups {
  homeFormation?: string;
  awayFormation?: string;
  home: SofaLineupPlayer[];
  away: SofaLineupPlayer[];
  confirmed: boolean;
}

export async function getLineups(eventId: number): Promise<SofaLineups | null> {
  return cached(`sofa-lineups-${eventId}`, TTL.event, async () => {
    const data = await api<{
      confirmed?: boolean;
      home?: { formation?: string; players?: { player?: { name?: string; id?: number }; position?: string; substitute?: boolean; shirtNumber?: number }[] };
      away?: { formation?: string; players?: { player?: { name?: string; id?: number }; position?: string; substitute?: boolean; shirtNumber?: number }[] };
    }>(`/api/v1/event/${eventId}/lineups`);
    if (!data?.home?.players?.length) return null;

    type Side = NonNullable<typeof data.home>;
    const map = (side: Side | undefined): SofaLineupPlayer[] =>
      (side?.players ?? []).map((p) => ({
        name: p.player?.name ?? "",
        position: p.position ?? "",
        substitute: Boolean(p.substitute),
        shirtNumber: p.shirtNumber,
        playerId: p.player?.id,
      }));

    return {
      homeFormation: data.home?.formation,
      awayFormation: data.away?.formation,
      home: map(data.home),
      away: map(data.away),
      confirmed: Boolean(data.confirmed),
    };
  });
}
