import { resolveStatLabels } from "@/lib/props/history";
import { booksForGame, pricesForGame } from "@/lib/server/book-prices";
import { compareTicket, propSignals, type LegComparison, type LegQuery, type PropSignal, type TicketComparison } from "@/lib/sources/br-books/compare";
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

export interface TicketPrices extends Omit<TicketComparison, "legs"> {
  suggestionId: string;
  /** One per ticket leg, null where the leg could not be named. */
  legs: (LegComparison | null)[];
}

export interface GamePrices { books: string[]; fetchedAt: string | null; tickets: TicketPrices[]; signals: PropSignal[] }

/** Pure form, for tests and for the API: the prices are passed in. */
export function compareSuggestionsWith(prices: BookPrice[], suggestions: BetSuggestion[], game: GameTeams, sportKey: string, opts: { dispersionPct?: number } = {}): TicketPrices[] {
  const out: TicketPrices[] = [];
  for (const s of suggestions) {
    const queries = s.legs.map((leg) => legQuery(leg, game, sportKey));
    const named = s.legs.map((leg, i) => ({ query: queries[i], decimal: leg.oddsDecimal })).filter((x): x is { query: LegQuery; decimal: number } => !!x.query);
    if (!named.length) continue;
    const cmp = compareTicket(prices, named, opts);
    // Re-expand to the ticket's leg order so the UI can put each verdict under its leg.
    let k = 0;
    const legs = queries.map((q) => (q ? cmp.legs[k++] : null));
    // A ticket with an unnamed leg cannot be totalled at one book: the ceiling and the per-book totals
    // would describe a shorter ticket than the one shown.
    const complete = queries.every(Boolean);
    out.push({ suggestionId: s.id, legs, bestSingleBook: complete ? cmp.bestSingleBook : null, perBook: complete ? cmp.perBook : [], theoreticalBest: complete ? cmp.theoreticalBest : null, referenceDecimal: cmp.referenceDecimal, bestSingleVsReferencePct: complete ? cmp.bestSingleVsReferencePct : null, theoreticalVsReferencePct: complete ? cmp.theoreticalVsReferencePct : null, books: cmp.books });
  }
  return out;
}

export function gamePrices(gameId: string, suggestions: BetSuggestion[], game: GameTeams, sportKey: string): GamePrices {
  const prices = pricesForGame(gameId);
  const { books, fetchedAt } = booksForGame(gameId);
  const opts = { dispersionPct: booksConfig().dispersionPct };
  return { books, fetchedAt, tickets: compareSuggestionsWith(prices, suggestions, game, sportKey, opts), signals: propSignals(prices, opts, 8) };
}
