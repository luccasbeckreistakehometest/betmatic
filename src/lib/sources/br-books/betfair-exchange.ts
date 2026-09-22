import { bookJson } from "@/lib/sources/br-books/http";
import { cleanDecimal, normaliseTeam, parseLineValue, sportOf } from "@/lib/sources/br-books/normalise";
import type { BookAdapter, BookEvent, BookPrice, BookSport, FetchArgs } from "@/lib/sources/br-books/types";

/**
 * Betfair Exchange (Brazil), read-only, through the same `_ak` application key its own web page
 * ships to every visitor (captured from an anonymous headless session of the public event page,
 * scratchpad/books/api-betfair-ex.json — no login, no token of ours). An exchange is not a
 * bookmaker: the best back and lay prices bracket the price the crowd is actually trading, which
 * makes it the cleanest reference to measure every other book's margin against — but only where
 * both sides exist: a lone 1.01 back order on a 35-point handicap rung is dust, not a price, and is
 * dropped here so it can never become a "fair" price downstream (compare.ts asks for a lay within
 * 10% of the back before it trusts the exchange). Three calls: the navigation graph lists a
 * competition's events, a `byevent` call names the markets, a `bymarket` call carries the prices.
 * Player props are not traded on the Brazilian exchange, so this covers moneyline, handicap, total.
 */
export const BETFAIR_APP_KEY = "PksAmrbOikTyDo03";
const NAV = "https://scan-inbf.betfair.bet.br/www/sports/navigation/v2/graph/bynode";
const ERO = "https://ero.betfair.bet.br/www/sports/exchange/readonly/v1";
const TYPES = "MARKET_STATE,MARKET_RATES,MARKET_DESCRIPTION,EVENT,RUNNER_DESCRIPTION,RUNNER_STATE,RUNNER_EXCHANGE_PRICES_BEST,";

/** Event type (sport) and competition ids, from the exchange's own navigation. */
const EVENT_TYPE: Record<BookSport, string> = { basketball: "7522", soccer: "1" };
const COMPETITIONS: Record<string, { id: string; name: RegExp }> = {
  wnba: { id: "11295025", name: /^WNBA$/i },
  nba: { id: "", name: /^NBA$/i },
  "soccer-bra": { id: "268489", name: /Brasileir[ãa]o S[ée]rie A$/i },
  "soccer-eng": { id: "", name: /^Premier League$|Premier League Inglesa/i },
  "soccer-esp": { id: "", name: /^La Liga$|^Primera Divis/i },
  "soccer-ucl": { id: "", name: /Champions League|Liga dos Campe/i },
  "soccer-lib": { id: "", name: /Libertadores/i },
};

export interface NavNode { nodeId: string; name?: string; nodeType?: string; eventInfo?: { eventId: number; name: string; openDate: string; competitionId?: number } }
export interface NavPayload { nodes?: NavNode[] }
export interface Runner { selectionId: number; handicap?: number; description?: { runnerName?: string }; state?: { status?: string; lastPriceTraded?: number; totalMatched?: number }; exchange?: { availableToBack?: { price: number; size: number }[]; availableToLay?: { price: number; size: number }[] } }
export interface MarketNode { marketId: string; description?: { marketName?: string; marketType?: string }; state?: { status?: string; inplay?: boolean; totalMatched?: number }; runners?: Runner[] }
export interface EventNode { eventId: number; event?: { eventName?: string; openDate?: string }; marketNodes?: MarketNode[] }
export interface ExchangePayload { eventTypes?: { eventNodes?: EventNode[] }[] }

/** "Connecticut Sun @ Washington Mystics" — the exchange lists the away side first. */
export function splitExchangeName(name: string): { home: string; away: string } | null {
  const at = name.split(" @ ");
  if (at.length === 2) return { home: normaliseTeam(at[1]), away: normaliseTeam(at[0]) };
  const vs = name.split(/\s+(?:x|v|vs\.?)\s+/i);
  if (vs.length === 2) return { home: normaliseTeam(vs[0]), away: normaliseTeam(vs[1]) };
  return null;
}

export function selectNavEvents(nav: NavPayload, from: string, to: string): { id: string; name: string; openDate: string }[] {
  const lo = Date.parse(from), hi = Date.parse(to);
  const seen = new Set<string>();
  const out: { id: string; name: string; openDate: string }[] = [];
  for (const n of nav.nodes ?? []) {
    if (n.nodeType !== "EVENT" || !n.eventInfo) continue;
    const t = Date.parse(n.eventInfo.openDate);
    const id = String(n.eventInfo.eventId);
    if (!Number.isFinite(t) || t < lo || t > hi || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: n.eventInfo.name, openDate: n.eventInfo.openDate });
  }
  return out;
}

export function exchangeEvent(ev: { id: string; name: string; openDate: string }, sport: BookSport, league?: string): BookEvent | null {
  const names = splitExchangeName(ev.name);
  if (!names) return null;
  return { key: `betfair-exchange:betfair:${ev.id}`, ...names, startsAt: ev.openDate, externalIds: { betfair: ev.id }, league, sport, url: `https://www.betfair.bet.br/exchange/plus/pt/apostas-${ev.id}` };
}

/** A back offer with no lay behind it and a price this short is an unmatched dust order, not a market. */
export const EXCHANGE_DUST_BACK = 1.05;

/**
 * Prices of one event's markets. `decimal` is the best back (what a bettor can take right now),
 * `lay` the best lay; a runner with nothing to back, or with a dust back and no lay, is skipped.
 * Handicap runners carry the line on the runner; totals name the side ("Mais"/"Menos") and carry
 * the line as the handicap.
 */
export function parseExchangeMarkets(payload: ExchangePayload, event: BookEvent, fetchedAt: string): BookPrice[] {
  const out: BookPrice[] = [];
  const base = { book: "Betfair Exchange", platform: "betfair-exchange", sport: event.sport, event, fetchedAt, url: event.url } as const;
  const homeKey = event.home.toLowerCase(), awayKey = event.away.toLowerCase();
  const sideOfRunner = (name: string): "home" | "away" | "draw" | null => {
    const n = normaliseTeam(name).toLowerCase();
    if (n === homeKey) return "home";
    if (n === awayKey) return "away";
    if (/^(the draw|empate|draw)$/i.test(n)) return "draw";
    return null;
  };
  for (const et of payload.eventTypes ?? []) for (const en of et.eventNodes ?? []) {
    if (String(en.eventId) !== event.externalIds.betfair) continue;
    for (const m of en.marketNodes ?? []) {
      if (m.state?.status && m.state.status !== "OPEN") continue;
      const type = m.description?.marketType ?? "";
      for (const r of m.runners ?? []) {
        if (r.state?.status && r.state.status !== "ACTIVE") continue;
        const back = cleanDecimal(r.exchange?.availableToBack?.[0]?.price);
        const lay = cleanDecimal(r.exchange?.availableToLay?.[0]?.price) ?? undefined;
        if (back === null || (lay === undefined && back <= EXCHANGE_DUST_BACK)) continue;
        const runnerName = r.description?.runnerName ?? "";
        if (type === "MATCH_ODDS") {
          const side = sideOfRunner(runnerName);
          if (side) out.push({ ...base, market: "moneyline", side, decimal: back, lay });
        } else if (type === "HANDICAP" && event.sport === "basketball") {
          const side = sideOfRunner(runnerName);
          const line = parseLineValue(r.handicap);
          if (side && side !== "draw" && line !== null) out.push({ ...base, market: "spread", side, line, decimal: back, lay });
        } else if (type === "COMBINED_TOTAL" || type === "OVER_UNDER" || /^OVER_UNDER_\d+/.test(type)) {
          const side = /^(mais|over)/i.test(runnerName) ? "over" : /^(menos|under)/i.test(runnerName) ? "under" : null;
          const line = parseLineValue(r.handicap) ?? parseLineValue(runnerName.replace(/^[^\d]+/, "")) ?? parseLineValue(type.replace("OVER_UNDER_", "").replace(/(\d)5$/, "$1.5"));
          if (side && line !== null) out.push({ ...base, market: "total", side, line, decimal: back, lay });
        }
      }
    }
  }
  return out;
}

async function competitionId(sport: BookSport, sportKey: string, signal?: AbortSignal): Promise<string | null> {
  const comp = COMPETITIONS[sportKey];
  if (!comp) return null;
  if (comp.id) return comp.id;
  const nav = await bookJson<NavPayload>(`${NAV}?_ak=${BETFAIR_APP_KEY}&alt=json&attachments=COMPETITION&currencyCode=BRL&locale=pt_BR&maxInDistance=10&maxOutDistance=2&maxResults=1&nodeIds=EVENT_TYPE:${EVENT_TYPE[sport]}&outs=%5BCOMPETITION%5D`, { ttlMs: 12 * 60 * 60_000, signal });
  const hit = (nav.data.nodes ?? []).find((n) => n.nodeType === "COMPETITION" && comp.name.test(n.name ?? ""));
  return hit ? hit.nodeId.replace(/^COMP:/, "") : null;
}

export async function fetchBetfairExchange(args: FetchArgs): Promise<BookPrice[]> {
  const sport = sportOf(args.sportKey);
  if (!sport || !COMPETITIONS[args.sportKey]) return [];
  const comp = await competitionId(sport, args.sportKey, args.signal);
  if (!comp) return [];
  const nav = await bookJson<NavPayload>(`${NAV}?_ak=${BETFAIR_APP_KEY}&alt=json&attachments=MENU,EVENT&currencyCode=BRL&locale=pt_BR&maxInDistance=10&maxOutDistance=5&maxResults=1&nodeIds=COMP:${comp}&outs=%5BMENU,EVENT%5D`, { signal: args.signal });
  const events = selectNavEvents(nav.data, args.from, args.to);
  if (!events.length) return [];
  const fetchedAt = new Date().toISOString();
  const out: BookPrice[] = [];
  // One event per call: the read-only API answers TOO_MUCH_DATA to a batch of six, and one event's
  // three main markets fit comfortably in a single bymarket call (the page does the same).
  for (const ev of events) {
    const event = exchangeEvent(ev, sport, args.sportKey);
    if (!event) continue;
    const named = await bookJson<ExchangePayload>(`${ERO}/byevent?_ak=${BETFAIR_APP_KEY}&alt=json&currencyCode=BRL&eventIds=${ev.id}&locale=pt_BR&rollupLimit=50&rollupModel=STAKE&types=MARKET_STATE,EVENT,MARKET_DESCRIPTION`, { signal: args.signal });
    const marketIds: string[] = [];
    for (const et of named.data.eventTypes ?? []) for (const en of et.eventNodes ?? []) for (const m of en.marketNodes ?? []) {
      if (/^(MATCH_ODDS|HANDICAP|COMBINED_TOTAL|OVER_UNDER_\d+)$/.test(m.description?.marketType ?? "")) marketIds.push(m.marketId);
    }
    if (!marketIds.length) continue;
    const priced = await bookJson<ExchangePayload>(`${ERO}/bymarket?_ak=${BETFAIR_APP_KEY}&alt=json&currencyCode=BRL&locale=pt_BR&marketIds=${marketIds.slice(0, 8).join(",")}&rollupLimit=50&rollupModel=STAKE&types=${TYPES}`, { signal: args.signal });
    out.push(...parseExchangeMarkets(priced.data, event, fetchedAt));
  }
  return out;
}

export const betfairExchangeAdapter: BookAdapter = {
  id: "betfair-exchange",
  book: "Betfair Exchange",
  platform: "betfair-exchange",
  sports: Object.keys(COMPETITIONS),
  coverage: "exchange: vencedor, handicap e total com back/lay (referência de preço justo)",
  hosts: ["scan-inbf.betfair.bet.br", "ero.betfair.bet.br"],
  fetchBookOdds: fetchBetfairExchange,
};
