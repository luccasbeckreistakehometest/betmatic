import { bookJson } from "@/lib/sources/br-books/http";
import { cleanDecimal, normalisePlayer, normaliseTeam, sportOf, statFromLabel } from "@/lib/sources/br-books/normalise";
import type { BookAdapter, BookEvent, BookPrice, BookSport, FetchArgs } from "@/lib/sources/br-books/types";

/**
 * Kambi's offering CDN, the public feed behind KTO (and Stake.bet.br, which carries the same event
 * ids). KTO's own site sits behind a Cloudflare challenge; the CDN does not, and it is the same
 * data the site renders. Verified live 22/09/2026: WNBA games carry game lines only (winner,
 * handicap, total — 23 to 26 offers each, no player ladders), so this adapter is a game-line source
 * for basketball and a 1X2 / total source for football.
 */
export const KAMBI_BASE = "https://us.offering-api.kambicdn.com/offering/v2018";

/** Kambi listView paths per repo sport key. */
const LIST_PATHS: Record<string, string> = {
  wnba: "basketball/wnba",
  nba: "basketball/nba",
  "soccer-bra": "football/brazil/brasileirao_serie_a",
  "soccer-eng": "football/england/premier_league",
  "soccer-esp": "football/spain/la_liga",
  "soccer-ucl": "football/champions_league",
  "soccer-lib": "football/copa_libertadores",
};

export interface KambiEvent {
  id: number; name: string; homeName?: string; awayName?: string; start: string; state?: string; group?: string; sport?: string;
  participants?: { participantId: number; name: string; home?: boolean }[];
}
export interface KambiOutcome {
  id: number; label?: string; englishLabel?: string; odds?: number; line?: number; participant?: string; participantId?: number; type?: string; status?: string;
}
export interface KambiBetOffer {
  id: number; eventId: number;
  criterion?: { id: number; label?: string; englishLabel?: string; lifetime?: string };
  betOfferType?: { id: number; name?: string; englishName?: string };
  outcomes?: KambiOutcome[];
  tags?: string[];
}
export interface KambiListView { events?: ({ event?: KambiEvent } & Partial<KambiEvent>)[] }
export interface KambiEventOffers { betOffers?: KambiBetOffer[]; events?: KambiEvent[] }

export function kambiEvent(ev: KambiEvent, sport: BookSport, book: string, operator: string): BookEvent | null {
  const [homeRaw, awayRaw] = ev.homeName && ev.awayName ? [ev.homeName, ev.awayName] : ev.name.split(" - ");
  if (!homeRaw || !awayRaw) return null;
  return {
    key: `kambi:${operator}:${ev.id}`,
    home: normaliseTeam(homeRaw),
    away: normaliseTeam(awayRaw),
    startsAt: ev.start,
    externalIds: { kambi: String(ev.id) },
    league: ev.group,
    sport,
  };
}

const FULL_TIME = (o: KambiBetOffer) => !o.criterion?.lifetime || /FULL_TIME/.test(o.criterion.lifetime);

/**
 * Bet offers of one event. Kambi prices are ×1000 and lines ×1000. Outcome types carry the side:
 * OT_ONE / OT_TWO / OT_CROSS for match markets, OT_OVER / OT_UNDER for totals. A player line is an
 * over/under offer whose outcomes name a participant.
 */
export function parseKambiOffers(payload: KambiEventOffers, event: BookEvent, book: string, fetchedAt: string, url?: string): BookPrice[] {
  const out: BookPrice[] = [];
  const base = { book, platform: "kambi", sport: event.sport, event, fetchedAt, url } as const;
  for (const o of payload.betOffers ?? []) {
    if (!FULL_TIME(o)) continue;
    const label = o.criterion?.englishLabel ?? o.criterion?.label ?? "";
    const type = o.betOfferType?.id;
    const outcomes = (o.outcomes ?? []).filter((x) => !x.status || x.status === "OPEN");
    const price = (x: KambiOutcome) => cleanDecimal((x.odds ?? 0) / 1000);
    const line = (x: KambiOutcome) => (typeof x.line === "number" ? x.line / 1000 : null);
    // The ids a coupon deep link names (deeplinks.ts): the event, the bet offer and the outcome.
    const ref = (x: KambiOutcome) => ({ eventId: String(o.eventId ?? event.externalIds.kambi), marketId: String(o.id), outcomeId: String(x.id) });

    // Match winner (2) — "Match Winner - Including Overtime", "Full Time" (soccer 1X2).
    if (type === 2 && /winner|moneyline|full time|match odds|1x2|result/i.test(label) && !/quarter|half|period/i.test(label)) {
      for (const x of outcomes) {
        const p = price(x); if (p === null) continue;
        const side = x.type === "OT_ONE" ? "home" : x.type === "OT_TWO" ? "away" : x.type === "OT_CROSS" ? "draw" : null;
        if (side) out.push({ ...base, market: "moneyline", side, decimal: p, ref: ref(x) });
      }
      continue;
    }
    // Handicap (1): the line on each outcome is that side's handicap.
    if (type === 1 && /spread|handicap/i.test(label) && !/quarter|half|period/i.test(label) && event.sport === "basketball") {
      for (const x of outcomes) {
        const p = price(x), l = line(x); if (p === null || l === null) continue;
        const side = x.type === "OT_ONE" ? "home" : x.type === "OT_TWO" ? "away" : null;
        if (side) out.push({ ...base, market: "spread", side, line: l, decimal: p, ref: ref(x) });
      }
      continue;
    }
    // Over/Under (6): a game total, or a player line when the outcomes carry a participant.
    if (type === 6) {
      const player = outcomes.find((x) => x.participant)?.participant;
      if (player) {
        const stat = statFromLabel(label, event.sport);
        if (!stat) continue;
        for (const x of outcomes) {
          const p = price(x), l = line(x); if (p === null || l === null) continue;
          const side = x.type === "OT_OVER" ? "over" : x.type === "OT_UNDER" ? "under" : null;
          if (side) out.push({ ...base, market: "player_prop", player: normalisePlayer(player), stat, line: l, side, decimal: p, kind: "total", ref: ref(x) });
        }
      } else if (/total (points|goals)|total de (pontos|gols)/i.test(label) && !/quarter|half|period|team|equipe/i.test(label)) {
        for (const x of outcomes) {
          const p = price(x), l = line(x); if (p === null || l === null) continue;
          const side = x.type === "OT_OVER" ? "over" : x.type === "OT_UNDER" ? "under" : null;
          if (side) out.push({ ...base, market: "total", side, line: l, decimal: p, ref: ref(x) });
        }
      }
    }
  }
  return out;
}

export function selectKambiEvents(list: KambiListView, from: string, to: string): KambiEvent[] {
  const lo = Date.parse(from), hi = Date.parse(to);
  return (list.events ?? [])
    .map((e) => (e.event ?? e) as KambiEvent)
    .filter((e) => { const t = Date.parse(e.start); return Number.isFinite(t) && t >= lo && t <= hi && e.state !== "STARTED"; });
}

export function makeKambiAdapter(operator: string, book: string): BookAdapter {
  const fetchBookOdds = async (args: FetchArgs): Promise<BookPrice[]> => {
    const sport = sportOf(args.sportKey);
    const path = LIST_PATHS[args.sportKey];
    if (!sport || !path) return [];
    const list = await bookJson<KambiListView>(`${KAMBI_BASE}/${operator}/listView/${path}.json?lang=pt_BR&market=BR`, { signal: args.signal });
    const fetchedAt = new Date().toISOString();
    const out: BookPrice[] = [];
    for (const ev of selectKambiEvents(list.data, args.from, args.to)) {
      const event = kambiEvent(ev, sport, book, operator);
      if (!event) continue;
      const offers = await bookJson<KambiEventOffers>(`${KAMBI_BASE}/${operator}/betoffer/event/${ev.id}.json?lang=pt_BR&market=BR`, { signal: args.signal });
      out.push(...parseKambiOffers(offers.data, event, book, fetchedAt));
    }
    return out;
  };
  return { id: `kambi:${operator === "ktobr" ? "kto" : operator}`, book, platform: "kambi", sports: Object.keys(LIST_PATHS), coverage: "vencedor, handicap e total (sem props de jogador na WNBA)", hosts: ["us.offering-api.kambicdn.com"], fetchBookOdds };
}

export const ktoAdapter = makeKambiAdapter("ktobr", "KTO");
