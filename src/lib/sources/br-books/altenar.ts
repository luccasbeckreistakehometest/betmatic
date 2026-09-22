import { bookJson } from "@/lib/sources/br-books/http";
import { cleanDecimal, milestoneLine, milestoneRung, normalisePlayer, normaliseTeam, parseLineValue, sideFromLabel, sportOf, statFromLabel } from "@/lib/sources/br-books/normalise";
import type { BookAdapter, BookEvent, BookPrice, BookSport, FetchArgs } from "@/lib/sources/br-books/types";

/**
 * Altenar's multi-tenant widget API (biahosted.com). EstrelaBet, Aposta Ganha, BetPix365, LotoGreen
 * and Vaidebet all read it with their own `integration` tenant and share event ids. The tenant
 * sites may sit behind a challenge (EstrelaBet does); the platform API answers a plain client.
 * GetEvents lists a sport with its three main markets; GetEventDetails carries the whole offer,
 * player ladders included, as `childMarkets` keyed to a parent market type.
 */
export const ALTENAR_BASE = "https://sb2frontend-altenar2.biahosted.com/api/widget";
const SPORT_ID: Record<BookSport, number> = { basketball: 67, soccer: 66 };

const LEAGUES: Record<string, RegExp> = {
  wnba: /^WNBA$/i,
  nba: /^NBA$/i,
  "soccer-bra": /^Brasileir[ãa]o A$|^S[ée]rie A$/i,
  "soccer-eng": /^Premier League$/i,
  "soccer-esp": /^La ?Liga$/i,
  "soccer-ucl": /Champions League|Liga dos Campe/i,
  "soccer-lib": /Libertadores/i,
};

export const ALTENAR_TENANTS: { integration: string; book: string }[] = [
  { integration: "estrelabet", book: "EstrelaBet" },
  { integration: "apostaganha", book: "Aposta Ganha" },
  { integration: "betpix365", book: "BetPix365" },
  { integration: "lotogreen", book: "LotoGreen" },
  { integration: "vaidebet", book: "Vaidebet" },
];

export interface AltenarListEvent { id: number; name: string; startDate: string; champId: number; competitorIds: number[]; extId?: string; status?: number; mc?: number }
export interface AltenarList { events?: AltenarListEvent[]; champs?: { id: number; name: string }[]; competitors?: { id: number; name: string }[] }
export interface AltenarOdd { id: number; typeId: number; price: number; name?: string; sv?: string; competitorId?: number; oddStatus?: number }
export interface AltenarMarket { id: number; typeId: number; name?: string; shortName?: string; desktopOddIds?: number[][]; childMarketIds?: number[]; sv?: string }
export interface AltenarChildMarket extends AltenarMarket { childName?: string; competitorId?: number }
export interface AltenarEventDetails {
  id: number; name: string; startDate: string; feedEventId?: number;
  competitors?: { id: number; name: string; abbreviation?: string }[];
  markets?: AltenarMarket[]; childMarkets?: AltenarChildMarket[]; odds?: AltenarOdd[];
}

/** Parent market type ids (basketball): winner, handicap, total; player O/U pairs and N+ ladders. */
const TYPE = {
  winner: 219, handicap: 223, total: 225,
  ou: new Set([768, 772, 770, 774]),
  ladder: new Set([2105, 2107, 31042, 2111, 2110, 2109, 2108, 2134]),
  soccerWinner: 1, soccerTotal: 18,
} as const;

export function altenarEvent(ev: AltenarListEvent | AltenarEventDetails, sport: BookSport, integration: string, competitors: Map<number, string>, league?: string): BookEvent | null {
  const ids = "competitorIds" in ev ? ev.competitorIds : (ev.competitors ?? []).map((c) => c.id);
  const [h, a] = ids.map((id) => competitors.get(id) ?? "");
  const fromName = ev.name.split(/\s+vs\.?\s+/i);
  const home = h || fromName[0], away = a || fromName[1];
  if (!home || !away) return null;
  const externalIds: Record<string, string> = { altenar: String(ev.id) };
  const ext = "extId" in ev ? ev.extId : undefined;
  if (ext) externalIds.altenarFeed = ext;
  return { key: `altenar:${integration}:${ev.id}`, home: normaliseTeam(home), away: normaliseTeam(away), startsAt: ev.startDate, externalIds, league, sport };
}

export function selectAltenarEvents(list: AltenarList, sportKey: string, from: string, to: string): { ev: AltenarListEvent; league: string }[] {
  const re = LEAGUES[sportKey];
  if (!re) return [];
  const champs = new Map((list.champs ?? []).map((c) => [c.id, c.name]));
  const lo = Date.parse(from), hi = Date.parse(to);
  return (list.events ?? [])
    .filter((e) => { const t = Date.parse(e.startDate); return Number.isFinite(t) && t >= lo && t <= hi && re.test(champs.get(e.champId) ?? ""); })
    .map((ev) => ({ ev, league: champs.get(ev.champId) ?? sportKey }));
}

/**
 * The full offer of one event. Team names ride on `competitorId`; a player's name is the child
 * market's `childName`; the line is the odd's `sv` for pairs and the "N+" label for ladders.
 */
export function parseAltenarEvent(detail: AltenarEventDetails, event: BookEvent, book: string, fetchedAt: string, url?: string): BookPrice[] {
  const odds = new Map((detail.odds ?? []).map((o) => [o.id, o]));
  const comps = detail.competitors ?? [];
  const homeId = comps[0]?.id, awayId = comps[1]?.id;
  const out: BookPrice[] = [];
  const base = { book, platform: "altenar", sport: event.sport, event, fetchedAt, url } as const;
  const oddsOf = (m: AltenarMarket) => (m.desktopOddIds ?? []).flat().map((id) => odds.get(id)).filter((o): o is AltenarOdd => !!o && (o.oddStatus ?? 0) === 0);
  const sideOfTeam = (o: AltenarOdd) => (o.competitorId === homeId ? "home" : o.competitorId === awayId ? "away" : null);
  // The platform's own ids of the selection, kept for a deep link (deeplinks.ts).
  const ref = (m: AltenarMarket, o: AltenarOdd) => ({ eventId: String(detail.id ?? event.externalIds.altenar), marketId: String(m.id), outcomeId: String(o.id) });

  for (const m of detail.markets ?? []) {
    if (event.sport === "basketball" && m.typeId === TYPE.winner || event.sport === "soccer" && m.typeId === TYPE.soccerWinner) {
      for (const o of oddsOf(m)) {
        const p = cleanDecimal(o.price); if (p === null) continue;
        const side = sideOfTeam(o) ?? (/^(empate|draw|x)$/i.test(o.name ?? "") ? "draw" : null);
        if (side) out.push({ ...base, market: "moneyline", side, decimal: p, ref: ref(m, o) });
      }
    } else if (event.sport === "basketball" && m.typeId === TYPE.handicap) {
      for (const o of oddsOf(m)) {
        const p = cleanDecimal(o.price), side = sideOfTeam(o);
        if (p === null || !side) continue;
        // `sv` is the market's HOME line on both outcomes ("-7" under "Connecticut Sun (F) (+7)"). The
        // outcome name carries each side's own handicap, so it wins; without one the away side gets
        // the home line with its sign flipped.
        const named = parseLineValue((o.name ?? "").match(/\(([+-]?\d+(?:[.,]\d+)?)\)\s*$/)?.[1]);
        const sv = parseLineValue(o.sv);
        const line = named ?? (sv === null ? null : side === "home" ? sv : -sv);
        if (line === null) continue;
        out.push({ ...base, market: "spread", side, line, decimal: p, ref: ref(m, o) });
      }
    } else if (m.typeId === TYPE.total || m.typeId === TYPE.soccerTotal) {
      for (const o of oddsOf(m)) {
        const p = cleanDecimal(o.price), line = parseLineValue(o.sv), side = sideFromLabel(o.name ?? "");
        if (p === null || line === null || !side) continue;
        out.push({ ...base, market: "total", side, line, decimal: p, ref: ref(m, o) });
      }
    }
  }

  for (const cm of detail.childMarkets ?? []) {
    const player = cm.childName ? normalisePlayer(cm.childName) : null;
    if (!player) continue;
    if (TYPE.ou.has(cm.typeId)) {
      const stat = statFromLabel(cm.name ?? "", event.sport);
      if (!stat) continue;
      for (const o of oddsOf(cm)) {
        const p = cleanDecimal(o.price), line = parseLineValue(o.sv ?? cm.sv);
        const side = o.typeId === 2501 ? "over" : o.typeId === 2502 ? "under" : sideFromLabel(o.name ?? "");
        if (p === null || line === null || !side) continue;
        out.push({ ...base, market: "player_prop", player, stat, line, side, decimal: p, kind: "total", ref: ref(cm, o) });
      }
    } else if (TYPE.ladder.has(cm.typeId)) {
      // "Pontos - Kiki Iriafen (WAS)": the stat sits before the dash; the player after it.
      const stat = statFromLabel((cm.name ?? "").split(" - ")[0].replace(/\b(?:convertidas|conseguidos)\b/i, ""), event.sport);
      if (!stat) continue;
      for (const o of oddsOf(cm)) {
        const p = cleanDecimal(o.price), rung = milestoneRung(o.name ?? "");
        if (p === null || rung === null) continue;
        out.push({ ...base, market: "player_prop", player, stat, line: milestoneLine(rung), side: "over", decimal: p, kind: "milestone", ref: ref(cm, o) });
      }
    }
  }
  return out;
}

export function makeAltenarAdapter(integration: string, book: string): BookAdapter {
  const query = `culture=pt-BR&timezoneOffset=180&integration=${integration}&deviceType=1&numFormat=en-GB&countryCode=BR`;
  const fetchBookOdds = async (args: FetchArgs): Promise<BookPrice[]> => {
    const sport = sportOf(args.sportKey);
    if (!sport || !LEAGUES[args.sportKey]) return [];
    const list = await bookJson<AltenarList>(`${ALTENAR_BASE}/GetEvents?${query}&sportId=${SPORT_ID[sport]}&period=0`, { signal: args.signal });
    const competitors = new Map((list.data.competitors ?? []).map((c) => [c.id, c.name]));
    const fetchedAt = new Date().toISOString();
    const out: BookPrice[] = [];
    for (const { ev, league } of selectAltenarEvents(list.data, args.sportKey, args.from, args.to)) {
      const event = altenarEvent(ev, sport, integration, competitors, league);
      if (!event) continue;
      const detail = await bookJson<AltenarEventDetails>(`${ALTENAR_BASE}/GetEventDetails?${query}&eventId=${ev.id}`, { signal: args.signal });
      out.push(...parseAltenarEvent(detail.data, event, book, fetchedAt));
    }
    return out;
  };
  return { id: `altenar:${integration}`, book, platform: "altenar", sports: Object.keys(LEAGUES), coverage: "vencedor, handicap, total e props de jogador (pares e escadas N+)", hosts: ["sb2frontend-altenar2.biahosted.com"], fetchBookOdds };
}

export const altenarAdapters: BookAdapter[] = ALTENAR_TENANTS.map((t) => makeAltenarAdapter(t.integration, t.book));
