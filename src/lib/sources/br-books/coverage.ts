import { impliedProbability } from "@/lib/odds";
import { EXCHANGE_PLATFORM, fairPrice, groupBySelection, latestPerBook, sameLine, sameSelection, selectionKey, type LegQuery } from "@/lib/sources/br-books/compare";
import { deepLinkFor, linkForSelections, type DeepLink, type DeepLinkOptions } from "@/lib/sources/br-books/deeplinks";
import type { BookPrice, BookSide } from "@/lib/sources/br-books/types";

/**
 * "Um link que abra a casa com o máximo do bilhete que ela consegue carregar."
 *
 * The old rule for a whole-ticket link was all or nothing: ONE book had to price EVERY leg at the
 * exact line, and its URL scheme had to take a whole slip. On a real slate that is almost never
 * true — on 22/09/2026, game 401857208, thirty of fifty-six legs had a link of their own and not a
 * single ticket had one for the ticket. This module answers the weaker, useful question instead:
 * for each book, how much of this ticket can it actually carry, and what is the best link it can
 * give for that much?
 *
 * Three things are kept apart on purpose, because folding any two of them together is how a reader
 * ends up believing they placed a bet they did not place:
 *
 *   1. COVERAGE — the legs a book prices at the exact market, player, line and side. This is the
 *      truth about the book, and it is what "3 das 4 linhas" counts.
 *   2. THE LINK — what the book's own URL scheme can pre-fill (`DeepLink.selections`). A book can
 *      cover three legs and still only be linkable to its event page, because its site has no
 *      betslip URL. Then the reader is told both: three of four lines, and a game page.
 *   3. A NEAR LINE — the same player and stat (or the same market) on another rung. It is a
 *      DIFFERENT BET. It never enters the coverage count and never enters the price; it is offered
 *      as its own row, named as a different bet, with the two prices side by side, and only when
 *      the computed chance says the two lines are still close (see `NEAR_MAX_PROBABILITY_GAP`).
 *
 * Pure: rows in, verdicts out, no I/O.
 */

export type CoverageKind = "full" | "partial" | "near" | "none";

/** Why a book does not carry a leg: it posts the selection at another line, or not at all. */
export type MissingReason = "line" | "market";

export interface MissingLeg {
  /** Index into the ticket's own leg list, so the reader can be told which bet is missing by name. */
  index: number;
  reason: MissingReason;
}

export interface BookCandidate {
  book: string;
  platform: string;
  /** Ticket leg indices this book prices at the exact line and side. */
  covered: number[];
  missing: MissingLeg[];
  /** Product of this book's prices on the COVERED legs — what the link actually pays, not the ticket's price. */
  decimal: number;
  /** Every leg of the ticket, this book, this line. */
  full: boolean;
  /** The betslip with the covered legs, or the book's event / market page where its scheme takes one selection. */
  link: DeepLink;
}

export interface NearLine {
  /** The ticket leg this stands in for. */
  index: number;
  book: string;
  /** The player, on a prop: the shortest honest way to name the leg on screen. */
  player?: string;
  side: BookSide;
  /** The ticket's own line, its price on the ticket, and the computed chance there. */
  from: { line: number; decimal: number | null; probability: number };
  /** The rung the book actually posts, its price, and the computed chance there. */
  to: { line: number; decimal: number; probability: number };
  /** |chance there − chance here|: the measure the tolerance is written in. */
  gap: number;
  /** How BOTH chances were measured. Never one basis against the other. */
  basis: "fair" | "implied";
  link: DeepLink | null;
}

export interface TicketSlip {
  kind: CoverageKind;
  /** The book to send the reader to: full coverage first, then the most legs, then the best price. */
  best: BookCandidate | null;
  /** The runners-up, same order, for "outras casas". */
  others: BookCandidate[];
  /** Offered separately, opt-in, never folded into `best`. */
  nearLines: NearLine[];
  /** The ticket's leg count: the denominator of "3 das 4 linhas". */
  legs: number;
}

export interface SlipLeg {
  /** Null when the ticket's own settlement descriptor could not name the leg: it can never be covered. */
  query: LegQuery | null;
  /** The price printed on the ticket, the one a near line is compared against. */
  decimal: number | null;
}

export interface SlipOptions extends DeepLinkOptions {
  /** Override of NEAR_MAX_PROBABILITY_GAP, for tests and for a future admin control. */
  nearMaxGap?: number;
  /** How many near lines to offer at most (the UI shows fewer still). */
  nearLimit?: number;
}

/**
 * How far a rung may sit from the ticket's line and still be called "parecida", measured in CHANCE,
 * not in points — ten points of line on a total is a shrug, one point of line on rebounds is a
 * different bet, and only the probability knows the difference.
 *
 * Ten percentage points is the number, and it is the width of roughly one rung of a main player
 * line: a 55% over at 19.5 points is about a 50% over at 20.5, and about a 45% over at 21.5. One
 * rung is still recognisably the reader's bet at a different price — that is what "o mais perto
 * possível" was asked for. Two rungs is not: a 55% bet offered as a 43% bet is a different opinion
 * wearing the same player's name, and offering it as "close" would be the exact lie this module
 * exists to avoid. The gate is symmetric: an easier line (shorter price) and a harder line (longer
 * price) both qualify, and the copy always says which, and at what price.
 */
export const NEAR_MAX_PROBABILITY_GAP = 0.1;

/**
 * The cap on the raw move, on top of the chance rule. A thin market can be priced flat — the same
 * 1.90 two rungs apart, because nobody has traded it — and a flat price would let the chance rule
 * through on a bet that is plainly not the reader's. So a player prop or a spread may move at most
 * two points and a game total at most four, which is one to two rungs of each ladder. Whichever
 * rule is stricter wins.
 */
export const NEAR_MAX_LINE_MOVE: Partial<Record<LegQuery["market"], number>> = { player_prop: 2, spread: 2, total: 4 };

const round2 = (n: number) => Number(n.toFixed(2));
const round4 = (n: number) => Number(n.toFixed(4));

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The two ways this layer can put a number on a line's chance, both returned so the caller can pick
 * ONE and use it on both sides of a comparison:
 *
 *   `fair`    the repo's own computed chance (compare.ts `fairPrice`): the exchange's back/lay
 *             midpoint where the exchange has a real market, else the mean no-vig chance of the
 *             books that post both sides. This is the number the leg's "justo" row already shows.
 *   `implied` the raw chance of the books' median price at that line, margin and all.
 *
 * A fair number carries no margin and an implied one carries about four points of it, so comparing
 * one against the other would invent a gap that is not there. `nearLinesFor` therefore uses fair on
 * both sides or implied on both sides, never a mix.
 */
function chanceAt(rows: BookPrice[], q: LegQuery, line: number): { fair: number | null; implied: number | null } {
  const at: LegQuery = { ...q, line };
  const fair = fairPrice(rows, at);
  const books = latestPerBook(rows.filter((p) => p.platform !== EXCHANGE_PLATFORM && sameSelection(p, at) && sameLine(p.line, line)));
  const med = median(books.map((b) => b.decimal));
  return { fair: fair ? fair.probability : null, implied: med === null ? null : impliedProbability(med) };
}

/**
 * Full coverage first — a reader who wants to place the ticket wants one click, and a whole ticket
 * beats a better price on part of it. Then the most legs. Then a real betslip ahead of a page at
 * the same coverage, because the page still asks the reader to find and tap every selection. Then
 * the price of what the link carries, then a link we have actually opened ahead of one built from a
 * published scheme, then the name, so the order never wobbles between two equal books.
 */
function rank(a: BookCandidate, b: BookCandidate): number {
  return Number(b.full) - Number(a.full)
    || b.covered.length - a.covered.length
    || Number(b.link.selections > 0) - Number(a.link.selections > 0)
    || b.decimal - a.decimal
    || Number(b.link.verified) - Number(a.link.verified)
    || a.book.localeCompare(b.book);
}

/**
 * The near lines standing in for the legs a book could not carry. One offer per leg — the closest
 * one, at the book the reader is being sent to where that book has one, so the whole thing can be
 * placed in one place. Null legs (a leg the ticket's settlement could not name) are skipped: there
 * is nothing to be near to.
 */
function nearLinesFor(
  legs: SlipLeg[],
  indices: number[],
  rowsFor: (q: LegQuery) => BookPrice[],
  preferBook: string | null,
  opts: SlipOptions,
): NearLine[] {
  const maxGap = opts.nearMaxGap ?? NEAR_MAX_PROBABILITY_GAP;
  const out: NearLine[] = [];
  for (const index of indices) {
    const leg = legs[index];
    const q = leg?.query;
    if (!q || q.line === undefined || q.side === undefined) continue;
    const cap = NEAR_MAX_LINE_MOVE[q.market];
    if (cap === undefined) continue;
    const rows = rowsFor(q);
    const rungs = latestPerBook(rows.filter((p) =>
      p.platform !== EXCHANGE_PLATFORM && sameSelection(p, q) && p.line !== undefined && !sameLine(p.line, q.line) && Math.abs(p.line - q.line!) <= cap));
    if (!rungs.length) continue;
    const here = chanceAt(rows, q, q.line);
    const offers = rungs.flatMap((row) => {
      const there = chanceAt(rows, q, row.line!);
      // Fair against fair, else implied against implied — and the ticket's own printed price is an
      // implied number, so it only ever stands in on the implied side.
      const bothFair = here.fair !== null && there.fair !== null;
      const from = bothFair ? here.fair! : here.implied ?? (leg.decimal && leg.decimal > 1 ? impliedProbability(leg.decimal) : null);
      const to = bothFair ? there.fair! : there.implied;
      if (from === null || to === null) return [];
      const gap = Math.abs(from - to);
      if (gap > maxGap) return [];
      return [{ row, gap, from, to, basis: (bothFair ? "fair" : "implied") as NearLine["basis"] }];
    });
    if (!offers.length) continue;
    offers.sort((a, b) => Number(b.row.book === preferBook) - Number(a.row.book === preferBook) || a.gap - b.gap || b.row.decimal - a.row.decimal);
    const pick = offers[0];
    out.push({
      index,
      book: pick.row.book,
      player: q.player,
      side: q.side,
      from: { line: q.line, decimal: leg.decimal && leg.decimal > 1 ? leg.decimal : null, probability: round4(pick.from) },
      to: { line: pick.row.line!, decimal: pick.row.decimal, probability: round4(pick.to) },
      gap: round4(pick.gap),
      basis: pick.basis,
      link: deepLinkFor(pick.row, opts),
    });
    if (out.length >= (opts.nearLimit ?? 3)) break;
  }
  return out;
}

/**
 * Every book ranked by how much of this ticket it can carry, with the link that carries it.
 *
 * `legs` is the ticket's OWN leg list, in order and complete: a leg whose settlement descriptor
 * could not be named is passed with a null query and counts as missing everywhere, because a link
 * that quietly left it out would be a link to a shorter ticket than the one on screen.
 */
export function ticketSlip(prices: BookPrice[], legs: SlipLeg[], opts: SlipOptions = {}): TicketSlip {
  const empty: TicketSlip = { kind: "none", best: null, others: [], nearLines: [], legs: legs.length };
  if (!legs.length) return empty;
  const groups = groupBySelection(prices);
  const rowsFor = (q: LegQuery) => groups.get(selectionKey({ market: q.market, player: q.player, stat: q.stat })) ?? [];

  // Per leg: the newest row per book AT THE TICKET'S LINE (coverage), and every book that prices the
  // selection at any line (so a miss can say whether the book skips the line or the whole market).
  const atLine = legs.map((l) => {
    const m = new Map<string, BookPrice>();
    const q = l.query;
    if (!q) return m;
    const rows = rowsFor(q).filter((p) => p.platform !== EXCHANGE_PLATFORM && sameSelection(p, q) && (q.market === "moneyline" || sameLine(p.line, q.line)));
    for (const r of latestPerBook(rows)) m.set(r.book, r);
    return m;
  });
  const anyLine = legs.map((l) => {
    const s = new Set<string>();
    const q = l.query;
    if (!q) return s;
    for (const p of rowsFor(q)) if (p.platform !== EXCHANGE_PLATFORM && sameSelection(p, q)) s.add(p.book);
    return s;
  });

  const candidates: BookCandidate[] = [];
  for (const book of new Set(atLine.flatMap((m) => [...m.keys()]))) {
    const covered: number[] = [];
    const missing: MissingLeg[] = [];
    const rows: BookPrice[] = [];
    legs.forEach((_, i) => {
      const row = atLine[i].get(book);
      if (row) { covered.push(i); rows.push(row); } else missing.push({ index: i, reason: anyLine[i].has(book) ? "line" : "market" });
    });
    if (!covered.length) continue;
    // A book with no URL scheme at all (the Altenar tenants) is not a candidate: there is nowhere
    // to send the reader, and a made-up URL would be worse than none.
    const link = linkForSelections(rows, opts);
    if (!link) continue;
    candidates.push({ book, platform: rows[0].platform, covered, missing, decimal: round2(rows.reduce((p, r) => p * r.decimal, 1)), full: missing.length === 0, link });
  }
  candidates.sort(rank);

  const [best = null, ...others] = candidates;
  const nearLines = nearLinesFor(legs, best ? best.missing.map((m) => m.index) : legs.map((_, i) => i), rowsFor, best?.book ?? null, opts);
  const kind: CoverageKind = best ? (best.full ? "full" : "partial") : nearLines.length ? "near" : "none";
  return { kind, best, others, nearLines, legs: legs.length };
}
