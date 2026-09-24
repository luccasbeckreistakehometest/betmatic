import { playerKey } from "@/lib/sources/br-books/normalise";
import type { BookPrice } from "@/lib/sources/br-books/types";
import type { PropRow, Settlement } from "@/lib/types";

/**
 * The IN-PLAY board, reduced to the one question a live ticket asks: what is the best price a
 * Brazilian book posts on this exact selection RIGHT NOW.
 *
 * This is the piece the live read never had. Until now every in-play ticket carried a pre-game
 * number — ESPN's prop feed does not move after the tip — so its printed return was a price nobody
 * could have taken, and the product had to say so on every read and keep the whole scope out of its
 * public numbers. What arrives here is different in kind: it was read from the book's own live feed
 * seconds ago, by the collector, and it is only handed over while it is fresh (book-prices.ts
 * withholds anything past the freshness window rather than let it pass as current).
 *
 * Best, not median: taking the best of several prices for the identical bet is the same free edge
 * the pre-game read already shops for, and a live ticket is placed at one book like any other.
 */
export interface LiveQuote {
  book: string;
  decimal: number;
  /** When the collector read this price — the only honest answer to "as of when". */
  fetchedAt: string;
}

export interface LiveBoard {
  /** `<playerKey>|<stat>|<side>|<line>` → the best live price on that exact line. */
  props: Map<string, LiveQuote>;
  /** `ml|home`, `total|over|220.5`, `spread|home|-7.5` → the same, for the game lines. */
  game: Map<string, LiveQuote>;
  books: string[];
  /** The freshest read in the board, and the oldest: a live price's age is part of what it is. */
  newestAt: string | null;
  oldestAt: string | null;
}

export const EMPTY_LIVE_BOARD: LiveBoard = { props: new Map(), game: new Map(), books: [], newestAt: null, oldestAt: null };

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const livePropKey = (player: string, stat: string, side: string, line: number) => `${playerKey(player)}|${stat}|${side}|${num(line)}`;
export const liveGameKey = (market: string, side: string, line?: number) => (line === undefined ? `${market}|${side}` : `${market}|${side}|${num(line)}`);

/**
 * One board from the collector's rows. Only rows the collector stamped in play are used: a pre-game
 * row that reached this function would be the exact confusion the whole round exists to prevent, so
 * it is dropped here too rather than trusted to the caller.
 *
 * The exchange is left out for the reason the pre-game comparison leaves it out: it is the
 * reference the margins are measured against, not a shop window a reader can take a price at.
 * "N+" milestone rungs are left out too — they are a different bet from the over/under pair the
 * ticket settles on, and pricing one off the other is how a ladder becomes a wrong number.
 */
export function liveBoard(prices: BookPrice[]): LiveBoard {
  const props = new Map<string, LiveQuote>();
  const game = new Map<string, LiveQuote>();
  const books = new Set<string>();
  let newestAt: string | null = null;
  let oldestAt: string | null = null;
  const better = (map: Map<string, LiveQuote>, key: string, quote: LiveQuote) => {
    const cur = map.get(key);
    if (!cur || quote.decimal > cur.decimal) map.set(key, quote);
    books.add(quote.book);
    if (!newestAt || quote.fetchedAt > newestAt) newestAt = quote.fetchedAt;
    if (!oldestAt || quote.fetchedAt < oldestAt) oldestAt = quote.fetchedAt;
  };
  for (const p of prices) {
    if (!p.inPlay || p.platform === "betfair-exchange" || !(p.decimal > 1)) continue;
    const quote: LiveQuote = { book: p.book, decimal: p.decimal, fetchedAt: p.fetchedAt };
    if (p.market === "player_prop") {
      if (p.kind === "milestone" || !p.player || !p.stat || p.line === undefined || (p.side !== "over" && p.side !== "under")) continue;
      better(props, livePropKey(p.player, p.stat, p.side, p.line), quote);
    } else if (p.market === "moneyline" && (p.side === "home" || p.side === "away")) {
      better(game, liveGameKey("ml", p.side), quote);
    } else if (p.market === "total" && (p.side === "over" || p.side === "under") && p.line !== undefined) {
      better(game, liveGameKey("total", p.side, p.line), quote);
    } else if (p.market === "spread" && (p.side === "home" || p.side === "away") && p.line !== undefined) {
      better(game, liveGameKey("spread", p.side, p.line), quote);
    }
  }
  return { props, game, books: [...books].sort(), newestAt, oldestAt };
}

export const liveBoardSize = (board: LiveBoard): number => board.props.size + board.game.size;

/** The live price for one settled selection, or null when no book posts that exact line in play. */
export function liveQuoteFor(settlement: Settlement | undefined, homeAbbr: string | null, board: LiveBoard): LiveQuote | null {
  if (!settlement) return null;
  const s = settlement;
  if (s.type === "player_prop" && s.player && s.stat && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    return board.props.get(livePropKey(s.player, s.stat, s.side, s.line)) ?? null;
  }
  if (s.type === "moneyline" && s.teamAbbreviation) {
    const side = s.side === "home" || s.side === "away" ? s.side : homeAbbr ? (s.teamAbbreviation === homeAbbr ? "home" : "away") : null;
    return side ? board.game.get(liveGameKey("ml", side)) ?? null : null;
  }
  if (s.type === "total" && !s.teamAbbreviation && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    return board.game.get(liveGameKey("total", s.side, s.line)) ?? null;
  }
  if (s.type === "spread" && s.line !== undefined && s.teamAbbreviation && homeAbbr) {
    const side = s.teamAbbreviation === homeAbbr ? "home" : "away";
    return board.game.get(liveGameKey("spread", side, s.line)) ?? null;
  }
  return null;
}

export interface LivePricedProps {
  props: PropRow[];
  /** How many candidate rows now carry a price a reader could take right now. */
  priced: number;
}

/**
 * The candidate rows with their price replaced by the live one wherever a book posts that exact
 * line in play. A row with no live price is returned untouched and stays what it was: a pre-game
 * reference, marked as one, which the prompt then says out loud. Nothing here invents a price for
 * a line no book is posting — a missing live price is a fact about the board, not a gap to fill.
 */
export function applyLivePrices(props: PropRow[], board: LiveBoard): LivePricedProps {
  if (!board.props.size) return { props, priced: 0 };
  let priced = 0;
  const out = props.map((p) => {
    if (!p.marketKey || p.line === undefined || (p.side !== "over" && p.side !== "under")) return p;
    const quote = board.props.get(livePropKey(p.player, p.marketKey, p.side, p.line));
    if (!quote) return p;
    priced += 1;
    return {
      ...p,
      odds: quote.decimal.toFixed(2),
      decimal: quote.decimal,
      book: quote.book,
      priced: true,
      // The pre-game fair has no meaning against a live price: it was computed from the pre-game
      // pair, and the other side of this line is not that pair any more. Dropped rather than reused.
      noVigFair: null,
      openDecimal: null,
      livePrice: { book: quote.book, decimal: quote.decimal, fetchedAt: quote.fetchedAt },
    } satisfies PropRow;
  });
  return { props: out, priced };
}
