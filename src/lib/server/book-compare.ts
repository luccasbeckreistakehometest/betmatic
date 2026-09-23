import { resolveStatLabels } from "@/lib/props/history";
import { booksForGame, pricesForGame } from "@/lib/server/book-prices";
import { compareTicket, groupBySelection, propSignals, selectionKey, type LegComparison, type LegQuery, type PropSignal, type Quote, type TicketComparison } from "@/lib/sources/br-books/compare";
import { ticketSlip, type TicketSlip } from "@/lib/sources/br-books/coverage";
import { affiliateTagsFromEnv, deepLinkFor, type DeepLink } from "@/lib/sources/br-books/deeplinks";
import { playerKey } from "@/lib/sources/br-books/normalise";
import { booksConfig } from "@/lib/sources/br-books/registry";
import type { BookPrice } from "@/lib/sources/br-books/types";
import { getSport } from "@/lib/sports";
import type { BetLeg, BetSuggestion } from "@/lib/types";

/**
 * A served ticket against the books' current prices. The leg's settlement descriptor (the same one
 * the ledger grades on) is the join: player + stat + line + side for a prop, team for a moneyline
 * or spread, line + side for a total. A leg the descriptor cannot name is skipped, never guessed.
 */
export interface GameTeams { home: { abbreviation: string; displayName: string }; away: { abbreviation: string; displayName: string } }

/** MarketDef.key for whatever the model wrote in settlement.stat ("points", "Points", "PTS", "pontos"). */
export function statKeyOf(stat: string | undefined, sportKey: string): string | null {
  if (!stat) return null;
  const sport = getSport(sportKey);
  const direct = sport.markets.find((m) => m.key === stat.trim().toLowerCase());
  if (direct) return direct.key;
  const labels = resolveStatLabels(stat, sportKey);
  if (!labels) return null;
  return sport.markets.find((m) => m.statLabels.length === labels.length && m.statLabels.every((l, i) => l === labels[i]))?.key ?? null;
}

export function legQuery(leg: Pick<BetLeg, "settlement">, game: GameTeams, sportKey: string): LegQuery | null {
  const s = leg.settlement;
  if (!s) return null;
  const teamSide = (): "home" | "away" | null => {
    if (s.side === "home" || s.side === "away") return s.side;
    if (!s.teamAbbreviation) return null;
    const abbr = s.teamAbbreviation.toUpperCase();
    return abbr === game.home.abbreviation.toUpperCase() ? "home" : abbr === game.away.abbreviation.toUpperCase() ? "away" : null;
  };
  if (s.type === "player_prop") {
    const stat = statKeyOf(s.stat, sportKey);
    if (!s.player || !stat || s.line === undefined || (s.side !== "over" && s.side !== "under")) return null;
    return { market: "player_prop", player: s.player, stat, line: s.line, side: s.side };
  }
  if (s.type === "moneyline") {
    const side = teamSide();
    return side ? { market: "moneyline", side } : null;
  }
  if (s.type === "spread") {
    const side = teamSide();
    return side && s.line !== undefined ? { market: "spread", side, line: s.line } : null;
  }
  if (s.type === "total") {
    if (s.teamAbbreviation || s.line === undefined || (s.side !== "over" && s.side !== "under")) return null;
    return { market: "total", side: s.side, line: s.line };
  }
  return null;
}

/** A leg's comparison plus the way to each book that prices it: best book first, same order as `quotes`. */
export interface LegPrices extends LegComparison {
  /** One per book with a usable link (a book whose scheme is unknown is simply absent). */
  links: DeepLink[];
}

export interface TicketPrices extends Omit<TicketComparison, "legs"> {
  suggestionId: string;
  /** One per ticket leg, null where the leg could not be named. */
  legs: (LegPrices | null)[];
  /**
   * The best link this ticket can have anywhere: the whole ticket in one slip where a book carries
   * it, else the most of it one book carries, else a near line, else nothing. See coverage.ts —
   * coverage, the link's own reach and a near line are three separate numbers there and stay
   * separate all the way to the screen.
   */
  slip: TicketSlip;
}

export interface GamePrices { books: string[]; fetchedAt: string | null; tickets: TicketPrices[]; signals: PropSignal[] }

export interface CompareSuggestionsOptions {
  dispersionPct?: number;
  /** `bookEnvKey(book)` → affiliate tag (see deeplinks.ts). */
  affiliate?: Record<string, string>;
}

const same = (a: number | undefined, b: number | undefined) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < 0.011);

/**
 * The stored row behind one quote: the book's newest row for that selection, line, side and kind
 * with the quoted price — the same row compare.ts turned into the quote, found again so its ids
 * can name it in a link.
 */
function rowBehind(rows: BookPrice[], q: LegQuery, quote: Quote): BookPrice | null {
  let best: BookPrice | null = null;
  for (const p of rows) {
    if (p.book !== quote.book || p.market !== q.market || p.side !== q.side) continue;
    if (q.market === "player_prop" && (!p.player || !q.player || playerKey(p.player) !== playerKey(q.player) || p.stat !== q.stat)) continue;
    if (q.market !== "moneyline" && !same(p.line, q.line)) continue;
    if ((p.kind ?? undefined) !== (quote.kind ?? undefined) || Math.abs(p.decimal - quote.decimal) > 0.0005) continue;
    if (!best || p.fetchedAt > best.fetchedAt) best = p;
  }
  return best;
}

/** Pure form, for tests and for the API: the prices are passed in. */
export function compareSuggestionsWith(prices: BookPrice[], suggestions: BetSuggestion[], game: GameTeams, sportKey: string, opts: CompareSuggestionsOptions = {}): TicketPrices[] {
  const out: TicketPrices[] = [];
  const groups = groupBySelection(prices);
  const linkOpts = { affiliate: opts.affiliate };
  for (const s of suggestions) {
    const queries = s.legs.map((leg) => legQuery(leg, game, sportKey));
    const named = s.legs.map((leg, i) => ({ query: queries[i], decimal: leg.oddsDecimal })).filter((x): x is { query: LegQuery; decimal: number } => !!x.query);
    if (!named.length) continue;
    const cmp = compareTicket(prices, named, opts);
    // Each leg's link per book, best price first (the whole ticket's links come from coverage.ts).
    const withLinks: LegPrices[] = cmp.legs.map((c) => {
      const rows = groups.get(selectionKey({ market: c.query.market, player: c.query.player, stat: c.query.stat })) ?? [];
      const links: DeepLink[] = [];
      for (const quote of c.quotes) {
        const row = rowBehind(rows, c.query, quote);
        if (!row) continue;
        const link = deepLinkFor(row, linkOpts);
        if (link) links.push(link);
      }
      return { ...c, links };
    });
    // Re-expand to the ticket's leg order so the UI can put each verdict under its leg.
    let k = 0;
    const legs = queries.map((q) => (q ? withLinks[k++] : null));
    // A ticket with an unnamed leg cannot be totalled at one book: the ceiling and the per-book totals
    // would describe a shorter ticket than the one shown.
    const complete = queries.every(Boolean);
    const bestSingleBook = complete ? cmp.bestSingleBook : null;
    // Coverage is measured over the ticket's OWN legs, unnamed ones included, so "3 das 4 linhas"
    // counts the four the reader sees.
    const slip = ticketSlip(prices, s.legs.map((leg, i) => ({ query: queries[i], decimal: leg.oddsDecimal })), linkOpts);
    out.push({ suggestionId: s.id, legs, bestSingleBook, perBook: complete ? cmp.perBook : [], theoreticalBest: complete ? cmp.theoreticalBest : null, referenceDecimal: cmp.referenceDecimal, bestSingleVsReferencePct: complete ? cmp.bestSingleVsReferencePct : null, theoreticalVsReferencePct: complete ? cmp.theoreticalVsReferencePct : null, books: cmp.books, slip });
  }
  return out;
}

/**
 * A page view costs one comparison per (game, latest read, ticket set); the next views inside a
 * minute — or until the books job reads again — get the same answer from memory. A thousand prop
 * rows took 1.6 s of CPU per request before this, on a single-core VPS event loop.
 */
const memo = new Map<string, { at: number; value: GamePrices }>();
const MEMO_MS = 60_000;
const MEMO_ENTRIES = 40;

export function gamePrices(gameId: string, suggestions: BetSuggestion[], game: GameTeams, sportKey: string, now = new Date()): GamePrices {
  const { books, fetchedAt } = booksForGame(gameId, now);
  const key = `${gameId}|${fetchedAt ?? "-"}|${suggestions.map((s) => s.id).join(",")}|${game.home.abbreviation}`;
  const hit = memo.get(key);
  if (hit && now.getTime() - hit.at < MEMO_MS) return hit.value;
  const prices = pricesForGame(gameId, now);
  const opts = { dispersionPct: booksConfig().dispersionPct, affiliate: affiliateTagsFromEnv() };
  const value: GamePrices = { books, fetchedAt, tickets: compareSuggestionsWith(prices, suggestions, game, sportKey, opts), signals: propSignals(prices, opts, 8) };
  memo.set(key, { at: now.getTime(), value });
  while (memo.size > MEMO_ENTRIES) { const oldest = memo.keys().next().value; if (oldest === undefined) break; memo.delete(oldest); }
  return value;
}

/** Testing seam. */
export function resetGamePricesMemo(): void { memo.clear(); }
