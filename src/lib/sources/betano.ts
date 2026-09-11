import { chromium, type Browser, type BrowserContext } from "playwright";
import { cached } from "@/lib/cache";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TTL = { feed: 3 * 60_000 };

const SPORT_PATH: Record<string, string> = {
  nba: "basquete", wnba: "basquete",
  "soccer-bra": "futebol", "soccer-eng": "futebol", "soccer-esp": "futebol",
  "soccer-ucl": "futebol", "soccer-lib": "futebol",
  "tennis-atp": "tenis", "tennis-wta": "tenis",
};

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export interface BetanoSelection {
  name: string;
  price: number;
}

export interface BetanoMarket {
  name: string;
  type: string;
  selections: BetanoSelection[];
}

export interface BetanoEvent {
  id: string;
  participants: string[];
  startsAt?: string;
  markets: BetanoMarket[];
}

type Json = Record<string, unknown>;

/** Betano ships collections keyed by id in some payloads and as arrays in others. */
function asList(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (value && typeof value === "object") return Object.values(value as Json) as Json[];
  return [];
}

function indexById(value: unknown): Map<string, Json> {
  return new Map(asList(value).map((x) => [String((x as { id?: unknown }).id), x]));
}

/**
 * Reads Betano's own overview feed rather than the rendered page. The odds live in three separate
 * collections joined by id — event.marketIdList → market.selectionIdList → selection.price — which
 * is why scraping the DOM for anything class-based finds nothing: prices render into Tailwind
 * utility spans with no semantic hook.
 */
export async function getBetanoEvents(sportKey: string): Promise<BetanoEvent[]> {
  const path = SPORT_PATH[sportKey];
  if (!path) return [];

  return cached<BetanoEvent[]>(`betano-${path}`, TTL.feed, async () => {
    if (!browser) {
      browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
      context = await browser.newContext({
        userAgent: UA, viewport: { width: 1600, height: 1100 },
        locale: "pt-BR", timezoneId: "America/Sao_Paulo",
      });
    }
    const page = await context!.newPage();
    let feed = "";
    page.on("response", async (res) => {
      try {
        if (res.url().includes("/live/overview/latest") && res.ok()) feed = await res.text();
      } catch {
        // Bodies are occasionally unavailable; the caller handles an empty feed.
      }
    });

    try {
      await page.goto(`https://www.betano.bet.br/sport/${path}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2_500);
    } catch {
      return [];
    } finally {
      await page.close().catch(() => {});
    }
    if (!feed) return [];

    let parsed: Json;
    try {
      parsed = JSON.parse(feed) as Json;
    } catch {
      return [];
    }

    const markets = indexById(parsed.markets);
    const selections = indexById(parsed.selections);

    return asList(parsed.events)
      .map((event): BetanoEvent | null => {
        const e = event as {
          id?: unknown;
          participants?: { name?: string }[];
          marketIdList?: unknown[];
          startTime?: string;
        };
        const participants = (e.participants ?? []).map((p) => p.name ?? "").filter(Boolean);
        if (participants.length < 2) return null;

        const eventMarkets = (e.marketIdList ?? [])
          .map((id) => markets.get(String(id)))
          .filter((m): m is Json => Boolean(m))
          .map((m) => {
            const market = m as { name?: string; type?: string; selectionIdList?: unknown[] };
            const sels = (market.selectionIdList ?? [])
              .map((id) => selections.get(String(id)))
              .filter((s): s is Json => Boolean(s))
              .map((s) => {
                const sel = s as { name?: string; price?: number };
                return { name: sel.name ?? "", price: Number(sel.price) };
              })
              .filter((s) => s.name && Number.isFinite(s.price));
            return { name: market.name ?? "", type: market.type ?? "", selections: sels };
          })
          .filter((m) => m.selections.length >= 2);

        if (!eventMarkets.length) return null;
        return { id: String(e.id), participants, startsAt: e.startTime, markets: eventMarkets };
      })
      .filter((e): e is BetanoEvent => e !== null);
  });
}

function normalise(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
}

/** Joins an ESPN fixture to Betano's by team name, which differ between providers. */
export async function findBetanoMatch(
  sportKey: string,
  homeName: string,
  awayName: string,
): Promise<BetanoEvent | null> {
  const events = await getBetanoEvents(sportKey).catch(() => []);
  const home = normalise(homeName);
  const away = normalise(awayName);
  return (
    events.find((e) => {
      const names = e.participants.map(normalise);
      const matches = (target: string) => names.some((n) => n.includes(target) || target.includes(n));
      return matches(home) && matches(away);
    }) ?? null
  );
}

export async function closeBetano(): Promise<void> {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  context = null;
  browser = null;
}

export function betanoPrompt(event: BetanoEvent | null): string {
  if (!event) return "BETANO: no matching fixture found in the live feed.";
  return [
    `BETANO PRICES for ${event.participants.join(" x ")}:`,
    ...event.markets
      .slice(0, 8)
      .map((m) => `- ${m.name}: ${m.selections.map((s) => `${s.name} ${s.price}`).join(" | ")}`),
    "These are live decimal prices read from Betano's own feed. Quote them exactly and name Betano as the book.",
  ].join("\n");
}

/**
 * Full market pool for one fixture, in bet-builder mode.
 *
 * Two things learned the hard way and worth keeping:
 * - The "Todos" tab (bt=10) lists every market at once. Walking tabs one by one is slower and far
 *   less reliable — individual tabs frequently render empty in a headless browser.
 * - The /criar-aposta/ path segment restricts the page to markets that can actually be combined
 *   into a slip, which is exactly the pool a parlay builder should choose from.
 * Markets also close as kickoff approaches, so an empty result near kick-off is expected, not a bug.
 */
export function eventPoolUrl(slug: string, eventId: string): string {
  return `https://www.betano.bet.br/odds/${slug}/criar-aposta/${eventId}/?bt=10`;
}

/**
 * In-play URL. Betano moves a fixture to /live/ once it kicks off, and the slug gains a "-vs-"
 * separator plus the club suffix ("flamengo-rj") that the pre-match slug omits, so the pre-match URL
 * stops resolving the moment the match starts.
 */
export function liveEventUrl(liveSlug: string, eventId: string, tab = 10): string {
  return `https://www.betano.bet.br/live/${liveSlug}/criar-aposta/${eventId}/?bt=${tab}`;
}

/** True once the fixture has kicked off, which is when live pricing replaces pre-match. */
export function isInPlay(startsAt: string | undefined): boolean {
  if (!startsAt) return false;
  return Date.parse(startsAt) <= Date.now();
}
