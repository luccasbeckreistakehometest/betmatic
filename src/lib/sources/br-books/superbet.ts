import { bookJson } from "@/lib/sources/br-books/http";
import { cleanDecimal, milestoneLine, milestoneRung, normalisePlayer, normaliseTeam, parseLineValue, sideFromLabel, sportOf, statFromLabel, stripAccents } from "@/lib/sources/br-books/normalise";
import type { BookAdapter, BookEvent, BookPrice, BookSport, FetchArgs, LiveFetchArgs } from "@/lib/sources/br-books/types";

/**
 * Superbet's offer API: plain JSON behind Fastly, no wall, the most complete public feed found.
 * Two calls: the pre-match event list for a sport inside a window (dates must be whole hours —
 * the API says so in its 400), then one call per event for every market including the player
 * ladders. Verified live on 22/09/2026: 7 WNBA games, 221 player-prop rows on Fever × Lynx.
 */
export const SUPERBET_BASE = "https://production-superbet-offer-br.freetls.fastly.net";
const SPORT_ID: Record<BookSport, number> = { basketball: 4, soccer: 5 };

/** Tournament ids seen in the feed; names are matched as a fallback through the struct file. */
const LEAGUES: Record<string, { ids: number[]; name: RegExp }> = {
  wnba: { ids: [2174], name: /\bWNBA\b/i },
  nba: { ids: [], name: /^EUA - NBA$|\bNBA\b(?! ?2K| Cup| Summer| G League)/i },
  "soccer-bra": { ids: [], name: /Brasileir\w* - S[ée]rie A\b|Brasileir[ãa]o\b.*S[ée]rie A\b/i },
  "soccer-eng": { ids: [], name: /^Inglaterra - Premier League$/i },
  "soccer-esp": { ids: [], name: /Espanha - La ?Liga\b/i },
  "soccer-ucl": { ids: [], name: /UEFA - Champions League$/i },
  "soccer-lib": { ids: [], name: /Libertadores/i },
};
// Série B is on the same feed; the repo has no sport key for it yet, so it is listed for the future.
export const SUPERBET_SERIE_B = { id: 1697, name: /Brasileiro - S[ée]rie B/i };

export interface SuperbetListEvent {
  event_id: number;
  fixture: { betradar_id?: string; event_name: string; utc_date: string; tournament_id: number; sport_id: number; home_team_id?: string; away_team_id?: string };
  /**
   * What the in-play index adds: the game's own status, the period label the site prints ("3Q"),
   * and how many markets and odds each index holds — `counts.odds["2"]` is the LIVE index, and a
   * zero there means the book has nothing on the board for this game right now.
   */
  inplay_stats_metadata?: { status?: string; event_status_label?: string; period_status?: string; counts?: { markets?: Record<string, number>; odds?: Record<string, number> } };
}
export interface SuperbetOdd {
  marketId: number; marketName: string; name: string; price: number; code?: string; status?: string;
  /** The odd's own id, market template id and the value its betslip loader resolves a selection by (deeplinks.ts). */
  uuid?: string; outcomeId?: number;
  specialBetValue?: string | null;
  specifiers?: { player?: string; total?: string; hcp?: string; milestone?: string };
  info?: string;
}
export interface SuperbetEventDetail { data: { eventId: number; matchName: string; utcDate: string; betradarId?: string; tournamentId: number; odds: SuperbetOdd[] | null }[] }

const hourFloor = (iso: string) => { const d = new Date(iso); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
const hourCeil = (iso: string) => { const d = new Date(iso); if (d.getUTCMinutes() || d.getUTCSeconds() || d.getUTCMilliseconds()) { d.setUTCHours(d.getUTCHours() + 1); } d.setUTCMinutes(0, 0, 0); return d.toISOString(); };

const SPORT_SLUG: Record<BookSport, string> = { basketball: "basquete", soccer: "futebol" };
const slug = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The event page as the site's own sitemap lists it: /odds/<sport>/<home>-x-<away>-<eventId> (any slug renders). */
export function superbetEventUrl(event: BookEvent): string {
  return `https://superbet.bet.br/odds/${SPORT_SLUG[event.sport]}/${slug(event.home)}-x-${slug(event.away)}-${event.externalIds.superbet}`;
}

/** "Washington Mystics (F)·Connecticut Sun (F)" → home, away. */
export function splitEventName(name: string): { home: string; away: string } | null {
  const parts = name.split("·").map((s) => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { home: normaliseTeam(parts[0]), away: normaliseTeam(parts[1]) };
}

export function superbetEvent(ev: { event_id: number; fixture: SuperbetListEvent["fixture"] }, sport: BookSport, league?: string): BookEvent | null {
  const names = splitEventName(ev.fixture.event_name);
  if (!names) return null;
  return {
    key: `superbet:superbet:${ev.event_id}`,
    home: names.home,
    away: names.away,
    startsAt: ev.fixture.utc_date,
    externalIds: { superbet: String(ev.event_id), ...(ev.fixture.betradar_id ? { betradar: String(ev.fixture.betradar_id) } : {}) },
    league,
    sport,
  };
}

const FULL_GAME = /Inc\.?\s*prorroga|incl\.?\s*overtime|Resultado Final/i;
const PARTIAL = /quarto|tempo|1º|2º|3º|4º|intervalo|half|quarter|Primeira equipe|Ímpar|Par\b|Dupla Chance|Empate Anula/i;

/**
 * Maps one event's odds rows. Only full-game markets are kept (quarters and halves are noise for a
 * ticket that settles on the final box score). Player ladders come in two shapes: an over/under
 * pair per line ("Jogador - Total de Pontos") and "N+" rungs ("Jogador - Pontos", priced here as
 * over N − 0.5, the same convention the ESPN parser uses).
 */
export function parseSuperbetEvent(detail: SuperbetEventDetail, event: BookEvent, fetchedAt: string, inPlay = false): BookPrice[] {
  const data = detail.data?.[0];
  const odds = data?.odds ?? [];
  const out: BookPrice[] = [];
  const base = { book: "Superbet", platform: "superbet", sport: event.sport, event, fetchedAt, url: superbetEventUrl(event), ...(inPlay ? { inPlay: true } : {}) } as const;
  for (const o of odds) {
    if (o.status && o.status !== "active") continue;
    const price = cleanDecimal(o.price);
    if (price === null) continue;
    // What a deep link needs (deeplinks.ts): the event, the outcome and the odd's uuid.
    const ref = { eventId: String(data?.eventId ?? event.externalIds.superbet), marketId: String(o.marketId), outcomeId: o.outcomeId !== undefined ? String(o.outcomeId) : undefined, uuid: o.uuid, specialBetValue: o.specialBetValue ?? undefined };
    const name = o.marketName ?? "";
    if (PARTIAL.test(name) && !/^Jogador|do Jogador|pelo Jogador/i.test(name)) continue;

    // Player markets: "Jogador - Total de X" (pair), "Jogador - X" / "X do Jogador" (rungs).
    if (/^Jogador\b|do Jogador\b|pelo Jogador\b/i.test(name)) {
      const stat = statFromLabel(name.replace(/^Jogador\s*-\s*/i, "").replace(/\bTotal de\b/i, ""), event.sport);
      const player = o.specifiers?.player ? normalisePlayer(o.specifiers.player) : null;
      if (!stat || !player) continue;
      if (o.specifiers?.total !== undefined) {
        const line = parseLineValue(o.specifiers.total);
        const side = sideFromLabel(o.name);
        if (line === null || !side) continue;
        out.push({ ...base, market: "player_prop", player, stat, line, side, decimal: price, kind: "total", ref });
      } else if (o.specifiers?.milestone !== undefined) {
        const rung = parseLineValue(o.specifiers.milestone) ?? milestoneRung(o.name);
        if (rung === null || rung < 1) continue;
        out.push({ ...base, market: "player_prop", player, stat, line: milestoneLine(rung), side: "over", decimal: price, kind: "milestone", ref });
      }
      continue;
    }
    if (!FULL_GAME.test(name) && event.sport === "basketball") continue;

    // Game lines. Basketball: Vencedor / Handicap / Total de Pontos. Soccer: Resultado Final (1X2),
    // Total de Gols; the handicap market is left out (Asian lines settle differently from spreads).
    if (/^Vencedor\b/i.test(name) || /^Resultado Final\b/i.test(name)) {
      const side = o.code === "1" ? "home" : o.code === "2" ? "away" : o.code === "X" || o.code === "0" ? "draw" : null;
      if (!side) continue;
      out.push({ ...base, market: "moneyline", side, decimal: price, ref });
    } else if (/^Handicap\b/i.test(name) && event.sport === "basketball") {
      const hcp = parseLineValue(o.specifiers?.hcp ?? o.specialBetValue);
      if (hcp === null) continue;
      const side = o.code === "1" ? "home" : o.code === "2" ? "away" : null;
      if (!side) continue;
      out.push({ ...base, market: "spread", side, line: side === "home" ? hcp : -hcp, decimal: price, ref });
    } else if (/^Total de (Pontos|Gols)\b/i.test(name)) {
      const line = parseLineValue(o.specifiers?.total ?? o.specialBetValue);
      const side = o.code === "+" ? "over" : o.code === "-" ? "under" : sideFromLabel(o.name);
      if (line === null || !side) continue;
      out.push({ ...base, market: "total", side, line, decimal: price, ref });
    }
  }
  return out;
}

interface StructNode { id?: number | string; localNames?: Record<string, string>; [k: string]: unknown }

/**
 * Tournament id → Portuguese name, from the (large, daily-cached) struct file. The struct prints
 * its ids as strings ("2174"); the event list prints them as numbers. Both are read as numbers.
 */
export function tournamentNames(struct: { data?: unknown }): Map<number, string> {
  const out = new Map<number, string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const n = node as StructNode;
    const id = typeof n.id === "number" ? n.id : typeof n.id === "string" && /^\d+$/.test(n.id) ? Number(n.id) : null;
    if (id !== null && n.localNames?.["pt-BR"]) out.set(id, n.localNames["pt-BR"]);
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  walk(struct.data);
  return out;
}

export function selectSuperbetEvents(events: SuperbetListEvent[], sportKey: string, names: Map<number, string>, from: string, to: string): { ev: SuperbetListEvent; league: string }[] {
  const league = LEAGUES[sportKey];
  if (!league) return [];
  const lo = Date.parse(from), hi = Date.parse(to);
  return events
    .filter((e) => {
      const t = Date.parse(e.fixture.utc_date);
      if (!Number.isFinite(t) || t < lo || t > hi) return false;
      if (e.inplay_stats_metadata?.status && /finished|ended/i.test(e.inplay_stats_metadata.status)) return false;
      const name = names.get(e.fixture.tournament_id) ?? "";
      return league.ids.includes(e.fixture.tournament_id) || league.name.test(name);
    })
    .map((ev) => ({ ev, league: names.get(ev.fixture.tournament_id) ?? sportKey }));
}

export async function fetchSuperbet(args: FetchArgs): Promise<BookPrice[]> {
  const sport = sportOf(args.sportKey);
  if (!sport || !LEAGUES[args.sportKey]) return [];
  const struct = await bookJson<{ data?: unknown }>(`${SUPERBET_BASE}/v2/pt-BR/struct`, { ttlMs: 24 * 60 * 60_000, signal: args.signal });
  const names = tournamentNames(struct.data);
  const list = await bookJson<{ events: SuperbetListEvent[] }>(
    `${SUPERBET_BASE}/v3/pt-BR/events?startDate=${hourFloor(args.from)}&endDate=${hourCeil(args.to)}&index=prematch&sports=${SPORT_ID[sport]}`,
    { signal: args.signal },
  );
  const fetchedAt = new Date().toISOString();
  const out: BookPrice[] = [];
  for (const { ev, league } of selectSuperbetEvents(list.data.events ?? [], args.sportKey, names, args.from, args.to)) {
    const event = superbetEvent(ev, sport, league);
    if (!event) continue;
    const detail = await bookJson<SuperbetEventDetail>(`${SUPERBET_BASE}/v2/pt-BR/events/${ev.event_id}`, { signal: args.signal });
    out.push(...parseSuperbetEvent(detail.data, event, fetchedAt));
  }
  return out;
}

/**
 * The in-play index of the same event list. `index=live` is a first-class index of the v3 endpoint
 * (an unknown value answers 400; `live` answered 200 with 1 014 events across a twelve-hour window
 * on 24/09/2026, WNBA among them), and the per-event document is the SAME `/v2/pt-BR/events/<id>`
 * the pre-game read already calls — pointed at a game under way it returns that game's live board.
 * Verified on a basketball game in its third quarter: 29 of 29 outcomes priced and active, winner
 * 1.02 / 9.50, total re-hung at 149.5, plus the running quarter's own markets.
 */
export const SUPERBET_LIVE_INDEX = "live";

/** How many live odds the book must actually hold for an event to be worth a per-event call. */
const liveOddsCount = (e: SuperbetListEvent): number => Number(e.inplay_stats_metadata?.counts?.odds?.["2"] ?? 0);

/**
 * The events of one league that are under way AND have a live board. A finished game still sits on
 * the live index for a while with every count at zero: it is dropped here rather than read, priced
 * and stored as if the board were open.
 */
export function selectSuperbetLiveEvents(events: SuperbetListEvent[], sportKey: string, names: Map<number, string>): { ev: SuperbetListEvent; league: string }[] {
  const league = LEAGUES[sportKey];
  if (!league) return [];
  return events
    .filter((e) => {
      const status = e.inplay_stats_metadata?.status ?? "";
      if (status !== "STARTED" || liveOddsCount(e) < 1) return false;
      const name = names.get(e.fixture.tournament_id) ?? "";
      return league.ids.includes(e.fixture.tournament_id) || league.name.test(name);
    })
    .map((ev) => ({ ev, league: names.get(ev.fixture.tournament_id) ?? sportKey }));
}

/** The window the live index is asked for: games that tipped off in the last `LIVE_LOOKBACK_H` hours. */
const LIVE_LOOKBACK_H = 6;

export async function fetchSuperbetLive(args: LiveFetchArgs): Promise<BookPrice[]> {
  const sport = sportOf(args.sportKey);
  if (!sport || !LEAGUES[args.sportKey]) return [];
  const struct = await bookJson<{ data?: unknown }>(`${SUPERBET_BASE}/v2/pt-BR/struct`, { ttlMs: 24 * 60 * 60_000, signal: args.signal });
  const names = tournamentNames(struct.data);
  const now = Date.now();
  const list = await bookJson<{ events: SuperbetListEvent[] }>(
    `${SUPERBET_BASE}/v3/pt-BR/events?startDate=${hourFloor(new Date(now - LIVE_LOOKBACK_H * 3_600_000).toISOString())}&endDate=${hourCeil(new Date(now).toISOString())}&index=${SUPERBET_LIVE_INDEX}&sports=${SPORT_ID[sport]}`,
    { ttlMs: 0, signal: args.signal },
  );
  const out: BookPrice[] = [];
  for (const { ev, league } of selectSuperbetLiveEvents(list.data.events ?? [], args.sportKey, names)) {
    const event = superbetEvent(ev, sport, league);
    if (!event) continue;
    const detail = await bookJson<SuperbetEventDetail>(`${SUPERBET_BASE}/v2/pt-BR/events/${ev.event_id}`, { ttlMs: 0, signal: args.signal });
    out.push(...parseSuperbetEvent(detail.data, event, new Date().toISOString(), true));
  }
  return out;
}

export const superbetAdapter: BookAdapter = {
  id: "superbet",
  book: "Superbet",
  platform: "superbet",
  sports: Object.keys(LEAGUES),
  coverage: "moneyline, handicap, total e props de jogador (linhas e escadas N+)",
  liveCoverage: "ao vivo: moneyline, handicap e total pelo índice `live`; props de jogador quando a casa as mantém em jogo",
  hosts: ["production-superbet-offer-br.freetls.fastly.net"],
  fetchBookOdds: fetchSuperbet,
  fetchLiveOdds: fetchSuperbetLive,
};
