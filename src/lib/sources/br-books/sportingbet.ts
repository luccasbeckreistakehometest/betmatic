import { bookJson } from "@/lib/sources/br-books/http";
import { cleanDecimal, normaliseTeam, parseLineValue, sportOf } from "@/lib/sources/br-books/normalise";
import type { BookAdapter, BookEvent, BookPrice, BookSport, FetchArgs } from "@/lib/sources/br-books/types";

/**
 * Sportingbet (Entain's CDS API), with the public access id its own frontend embeds. One call per
 * sport lists the fixtures with their gridable markets: handicap and total for WNBA (the site
 * exposed no moneyline or player ladders for the WNBA on 22/09/2026), 1X2 and totals for football.
 * The fixture carries the Betradar id, which joins it to Superbet and Betnacional exactly.
 */
const CDS = "https://www.sportingbet.bet.br/cds-api/bettingoffer/fixtures";
export const SPORTINGBET_ACCESS_ID = "YTRhMjczYjctNTBlNy00MWZlLTliMGMtMWNkOWQxMThmZTI2";
const SPORT_ID: Record<BookSport, number> = { basketball: 7, soccer: 4 };
const LEAGUES: Record<string, RegExp> = {
  wnba: /^WNBA$/i,
  nba: /^NBA$/i,
  "soccer-bra": /^Brasileiro Serie A$/i,
  "soccer-eng": /^Premier League$/i,
  "soccer-esp": /^La ?Liga$/i,
  "soccer-ucl": /Liga dos Campe|Champions League/i,
  "soccer-lib": /Libertadores/i,
};

export interface CdsResult { id: number; odds?: number; name?: { value?: string }; visibility?: string; attr?: string; totalsPrefix?: string; playerId?: number }
export interface CdsGame { id: number; name?: { value?: string }; results?: CdsResult[]; categoryId?: number; templateCategory?: { name?: { value?: string } }; visibility?: string; attr?: string; isMain?: boolean }
export interface CdsFixture {
  id: string; name?: { value?: string }; startDate: string; stage?: string; sourceId?: number;
  competition?: { id?: number; name?: { value?: string } };
  participants?: { name?: { value?: string }; properties?: { type?: string } }[];
  addons?: { betRadar?: number };
  games?: CdsGame[];
}
export interface CdsFixtures { fixtures?: CdsFixture[]; totalCount?: number }

/** "Connecticut Sun at Washington Mystics" → away at home; "A - B" (football) → home, away. */
export function splitCdsName(name: string): { home: string; away: string } | null {
  const at = name.split(/\s+at\s+/i);
  if (at.length === 2) return { home: normaliseTeam(at[1]), away: normaliseTeam(at[0]) };
  const dash = name.split(/\s+-\s+/);
  if (dash.length === 2) return { home: normaliseTeam(dash[0]), away: normaliseTeam(dash[1]) };
  return null;
}

export function cdsEvent(f: CdsFixture, sport: BookSport): BookEvent | null {
  const teams = (f.participants ?? []).filter((p) => !p.properties?.type).map((p) => p.name?.value ?? "");
  const names = teams.length === 2 && sport === "soccer" ? { home: normaliseTeam(teams[0]), away: normaliseTeam(teams[1]) } : splitCdsName(f.name?.value ?? "");
  if (!names) return null;
  const externalIds: Record<string, string> = { sportingbet: f.id };
  if (f.addons?.betRadar) externalIds.betradar = String(f.addons.betRadar);
  return { key: `sportingbet:sportingbet:${f.id}`, ...names, startsAt: f.startDate, externalIds, league: f.competition?.name?.value, sport };
}

export function selectCdsFixtures(payload: CdsFixtures, sportKey: string, from: string, to: string): CdsFixture[] {
  const re = LEAGUES[sportKey];
  if (!re) return [];
  const lo = Date.parse(from), hi = Date.parse(to);
  return (payload.fixtures ?? []).filter((f) => {
    const t = Date.parse(f.startDate);
    return Number.isFinite(t) && t >= lo && t <= hi && f.stage !== "Live" && re.test(f.competition?.name?.value ?? "");
  });
}

/** The gridable markets that ride on the fixture list: handicap, totals, match result. */
export function parseCdsFixture(f: CdsFixture, event: BookEvent, fetchedAt: string): BookPrice[] {
  const out: BookPrice[] = [];
  const base = { book: "Sportingbet", platform: "sportingbet", sport: event.sport, event, fetchedAt } as const;
  const homeKey = event.home.toLowerCase(), awayKey = event.away.toLowerCase();
  const teamSide = (label: string): "home" | "away" | null => {
    const n = normaliseTeam(label.replace(/\s*[+-]?\d+(?:[.,]\d+)?\s*$/, "")).toLowerCase();
    return n === homeKey ? "home" : n === awayKey ? "away" : null;
  };
  for (const g of f.games ?? []) {
    if (g.visibility && g.visibility !== "Visible") continue;
    const category = g.templateCategory?.name?.value ?? g.name?.value ?? "";
    const results = (g.results ?? []).filter((r) => !r.visibility || r.visibility === "Visible");
    if (/handicap|spread/i.test(category) && event.sport === "basketball") {
      for (const r of results) {
        const p = cleanDecimal(r.odds), line = parseLineValue((r.attr ?? "").replace(",", ".")), side = teamSide(r.name?.value ?? "");
        if (p === null || line === null || !side) continue;
        out.push({ ...base, market: "spread", side, line, decimal: p });
      }
    } else if (/^totais$|^totals?$|total de gols|total goals/i.test(category)) {
      for (const r of results) {
        const p = cleanDecimal(r.odds), line = parseLineValue((g.attr ?? r.attr ?? "").replace(",", "."));
        const side = r.totalsPrefix === "Over" ? "over" : r.totalsPrefix === "Under" ? "under" : null;
        if (p === null || line === null || !side) continue;
        out.push({ ...base, market: "total", side, line, decimal: p });
      }
    } else if (/resultado da partida|money ?line|vencedor|1x2|match result|winner/i.test(category) && !/quarter|half|tempo|período/i.test(category)) {
      for (const r of results) {
        const p = cleanDecimal(r.odds); if (p === null) continue;
        const label = r.name?.value ?? "";
        const side = teamSide(label) ?? (/^(empate|x|draw)$/i.test(label) ? "draw" : null);
        if (side) out.push({ ...base, market: "moneyline", side, decimal: p });
      }
    }
  }
  return out;
}

export async function fetchSportingbet(args: FetchArgs): Promise<BookPrice[]> {
  const sport = sportOf(args.sportKey);
  if (!sport || !LEAGUES[args.sportKey]) return [];
  const url = `${CDS}?x-bwin-accessid=${SPORTINGBET_ACCESS_ID}&lang=pt-br&country=BR&userCountry=BR&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=${SPORT_ID[sport]}&skip=0&take=100&sortBy=Tags`;
  const list = await bookJson<CdsFixtures>(url);
  const fetchedAt = new Date().toISOString();
  const out: BookPrice[] = [];
  for (const f of selectCdsFixtures(list.data, args.sportKey, args.from, args.to)) {
    const event = cdsEvent(f, sport);
    if (event) out.push(...parseCdsFixture(f, event, fetchedAt));
  }
  return out;
}

export const sportingbetAdapter: BookAdapter = {
  id: "sportingbet",
  book: "Sportingbet",
  platform: "sportingbet",
  sports: Object.keys(LEAGUES),
  coverage: "handicap e total (WNBA); 1X2 e total (futebol); sem props de jogador para um cliente simples",
  fetchBookOdds: fetchSportingbet,
};
