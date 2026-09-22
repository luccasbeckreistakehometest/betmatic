import { bookJson } from "@/lib/sources/br-books/http";
import { cleanDecimal, normaliseTeam, sportOf } from "@/lib/sources/br-books/normalise";
import type { BookAdapter, BookEvent, BookPrice, BookSport, FetchArgs } from "@/lib/sources/br-books/types";

/**
 * Betnacional's events BFF (bet6.com.br, provider "ramp"). The public list endpoint answers one
 * market per sport — the match winner — as flat rows with the Betradar id in `dataviz_id`. The
 * per-event market endpoint its site uses was not captured from the homepage, so this adapter is a
 * moneyline source only; the research measured its WNBA underdog price 21% above another book's.
 */
const BASE = "https://prod-global-bff-events.bet6.com.br/api/odds/1/events-by-seasons";
const SPORT: Record<BookSport, { id: number; market: number }> = { basketball: { id: 2, market: 219 }, soccer: { id: 1, market: 1 } };
const LEAGUES: Record<string, RegExp> = {
  wnba: /^WNBA$/i,
  nba: /^NBA$/i,
  "soccer-bra": /Brasileir[ãa]o S[ée]rie A$/i,
  "soccer-eng": /Premier League$/i,
  "soccer-esp": /La ?Liga$/i,
  "soccer-ucl": /Champions League|Liga dos Campe/i,
  "soccer-lib": /Libertadores/i,
};

export interface RampRow {
  event_id: number; tournament_name?: string; home: string; away: string;
  /** "2026-09-22 19:30:00", Brasília local time. */
  date_start: string;
  market_id: number; market_name?: string; outcome_name: string; outcome_code?: string; odd: number; dataviz_id?: string; is_live?: number; selection_active?: boolean;
}
export interface RampPayload { odds?: RampRow[] }

/** The feed prints Brasília wall-clock time with no offset; the exchange and ESPN speak UTC. */
export function rampStartToIso(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +(m[6] ?? 0));
  return new Date(utc).toISOString();
}

export function rampEvent(row: RampRow, sport: BookSport): BookEvent | null {
  const startsAt = rampStartToIso(row.date_start);
  if (!startsAt) return null;
  const externalIds: Record<string, string> = { betnacional: String(row.event_id) };
  if (row.dataviz_id) externalIds.betradar = String(row.dataviz_id);
  return { key: `betnacional:betnacional:${row.event_id}`, home: normaliseTeam(row.home), away: normaliseTeam(row.away), startsAt, externalIds, league: row.tournament_name, sport };
}

export function parseRampRows(payload: RampPayload, sportKey: string, sport: BookSport, from: string, to: string, fetchedAt: string): BookPrice[] {
  const re = LEAGUES[sportKey];
  if (!re) return [];
  const lo = Date.parse(from), hi = Date.parse(to);
  const events = new Map<number, BookEvent>();
  const out: BookPrice[] = [];
  for (const row of payload.odds ?? []) {
    if (!re.test(row.tournament_name ?? "") || row.is_live === 1 || row.selection_active === false) continue;
    let event = events.get(row.event_id);
    if (!event) {
      const built = rampEvent(row, sport);
      if (!built) continue;
      const t = Date.parse(built.startsAt);
      if (t < lo || t > hi) continue;
      events.set(row.event_id, built);
      event = built;
    }
    const p = cleanDecimal(row.odd);
    if (p === null) continue;
    const name = normaliseTeam(row.outcome_name).toLowerCase();
    const side = name === event.home.toLowerCase() ? "home" : name === event.away.toLowerCase() ? "away" : /^(empate|draw|x)$/i.test(name) ? "draw" : null;
    if (!side) continue;
    out.push({ book: "Betnacional", platform: "betnacional", sport, event, market: "moneyline", side, decimal: p, fetchedAt });
  }
  return out;
}

export async function fetchBetnacional(args: FetchArgs): Promise<BookPrice[]> {
  const sport = sportOf(args.sportKey);
  if (!sport || !LEAGUES[args.sportKey]) return [];
  const cfg = SPORT[sport];
  const list = await bookJson<RampPayload>(`${BASE}?sport_id=${cfg.id}&category_id=0&tournament_id=&markets=${cfg.market}&filter_time_event=&provider=ramp`, { signal: args.signal });
  return parseRampRows(list.data, args.sportKey, sport, args.from, args.to, new Date().toISOString());
}

export const betnacionalAdapter: BookAdapter = {
  id: "betnacional",
  book: "Betnacional",
  platform: "betnacional",
  sports: Object.keys(LEAGUES),
  coverage: "somente vencedor (1X2 / moneyline) pela lista pública",
  hosts: ["prod-global-bff-events.bet6.com.br"],
  fetchBookOdds: fetchBetnacional,
};
