import { impliedProbability, noVigPair } from "@/lib/odds";
import { playerKey } from "@/lib/sources/br-books/normalise";
import type { BookMarket, BookPrice, BookSide } from "@/lib/sources/br-books/types";

/**
 * What the books say about one leg and one ticket. Pure: rows in, verdicts out, no I/O.
 *
 * Three questions, in the order the owner asked them: which book pays most for this exact leg;
 * which book pays most for the whole ticket (a parlay is placed at one book, so the best single
 * book matters more than the sum of the best legs); and where one book is out of step with the
 * others on a player line — either a price far from the consensus at the same line, or the same
 * stat posted at a friendlier line. The exchange is never a competing book: it is the reference
 * the margins are measured against, because its price is what the crowd actually traded.
 */
export interface LegQuery {
  market: BookMarket;
  side?: BookSide;
  line?: number;
  player?: string;
  /** MarketDef.key. */
  stat?: string;
}

export interface Quote {
  book: string;
  platform: string;
  decimal: number;
  line?: number;
  lay?: number;
  kind?: BookPrice["kind"];
  url?: string;
  fetchedAt: string;
}

export interface FairPrice {
  /** "exchange" = Betfair back/lay midpoint; "novig" = mean no-vig chance from books posting both sides. */
  source: "exchange" | "novig";
  probability: number;
  decimal: number;
  books: number;
}

export interface Dispersion {
  book: string;
  decimal: number;
  /** Median of the other books at the same line. */
  othersMedian: number;
  others: number;
  /** (decimal / othersMedian − 1) × 100: positive means this book pays more than the rest. */
  pct: number;
}

export interface LineAlternative {
  book: string;
  line: number;
  decimal: number;
  /** A friendlier line (lower for an over, higher for an under) at a price not meaningfully worse. */
  better: boolean;
  url?: string;
}

export interface LegComparison {
  query: LegQuery;
  /** Book quotes at the leg's exact line and side (exchange excluded). */
  quotes: Quote[];
  exchange: Quote | null;
  best: Quote | null;
  worst: Quote | null;
  medianDecimal: number | null;
  /** How much more the best price pays than the worst, in %. */
  bestVsWorstPct: number | null;
  fair: FairPrice | null;
  /** Per book: expected value of taking that price at the fair chance, in % of stake. Null without a fair. */
  edgeVsFairPct: { book: string; pct: number }[];
  dispersion: Dispersion[];
  lineAlternatives: LineAlternative[];
}

export interface BookTotal {
  book: string;
  /** Product of this book's prices on the legs it prices. */
  decimal: number;
  priced: number;
  of: number;
}

export interface TicketComparison {
  legs: LegComparison[];
  /** The book that prices every leg and pays the most for the whole ticket. */
  bestSingleBook: BookTotal | null;
  perBook: BookTotal[];
  /** Each leg at its own best book — not placeable as one ticket, shown as the ceiling. */
  theoreticalBest: number | null;
  /** The ticket's own price, for the % lines. */
  referenceDecimal: number | null;
  /** bestSingleBook vs the ticket's own price, in %. */
  bestSingleVsReferencePct: number | null;
  theoreticalVsReferencePct: number | null;
  books: string[];
}

export interface CompareOptions {
  /** Player-line dispersion threshold in %. Default 7: see registry.booksConfig for the reasoning. */
  dispersionPct?: number;
  now?: number;
}

const EXCHANGE = "betfair-exchange";
const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 0.011;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pctOver = (a: number, b: number) => Number(((a / b - 1) * 100).toFixed(2));

/** Rows that describe the same selection as the query, regardless of line. */
function sameSelection(p: BookPrice, q: LegQuery): boolean {
  if (p.market !== q.market) return false;
  if (q.market === "player_prop") return !!q.player && !!p.player && playerKey(p.player) === playerKey(q.player) && p.stat === q.stat && p.side === q.side;
  if (q.market === "moneyline") return p.side === q.side;
  return p.side === q.side;
}

const toQuote = (p: BookPrice): Quote => ({ book: p.book, platform: p.platform, decimal: p.decimal, line: p.line, lay: p.lay, kind: p.kind, url: p.url, fetchedAt: p.fetchedAt });

/** The newest row per book for one selection and line: the store keeps history, the reader wants now. */
function latestPerBook(rows: BookPrice[]): BookPrice[] {
  const byBook = new Map<string, BookPrice>();
  for (const r of rows) {
    const cur = byBook.get(r.book);
    if (!cur || r.fetchedAt > cur.fetchedAt) byBook.set(r.book, r);
  }
  return [...byBook.values()];
}

/** The opposite side of a two-way selection, for no-vig fair prices. */
function otherSide(q: LegQuery): LegQuery | null {
  if (q.side === "over") return { ...q, side: "under" };
  if (q.side === "under") return { ...q, side: "over" };
  if (q.market === "spread" && (q.side === "home" || q.side === "away") && q.line !== undefined) return { ...q, side: q.side === "home" ? "away" : "home", line: -q.line };
  if (q.market === "moneyline" && (q.side === "home" || q.side === "away")) return { ...q, side: q.side === "home" ? "away" : "home" };
  return null;
}

/**
 * Fair chance of the selection. The exchange midpoint wins when it exists (the crowd's price,
 * commission aside); otherwise the mean of every book's no-vig chance where the book posts both
 * sides of the same line — a three-way moneyline (soccer) is left without a fair price.
 */
export function fairPrice(prices: BookPrice[], q: LegQuery): FairPrice | null {
  const ex = latestPerBook(prices.filter((p) => p.platform === EXCHANGE && sameSelection(p, q) && (q.market === "moneyline" || same(p.line, q.line))))[0];
  if (ex && ex.decimal > 1) {
    const mid = ex.lay && ex.lay > ex.decimal ? (ex.decimal + ex.lay) / 2 : ex.decimal;
    return { source: "exchange", probability: 1 / mid, decimal: Number(mid.toFixed(3)), books: 1 };
  }
  const opposite = otherSide(q);
  if (!opposite || q.market === "moneyline" && prices.some((p) => p.market === "moneyline" && p.side === "draw")) return null;
  const mine = latestPerBook(prices.filter((p) => p.platform !== EXCHANGE && sameSelection(p, q) && (q.market === "moneyline" || same(p.line, q.line))));
  const theirs = latestPerBook(prices.filter((p) => p.platform !== EXCHANGE && sameSelection(p, opposite) && (q.market === "moneyline" || same(p.line, opposite.line))));
  const chances: number[] = [];
  for (const a of mine) {
    const b = theirs.find((x) => x.book === a.book);
    if (!b) continue;
    const fair = noVigPair(a.decimal, b.decimal).a;
    if (Number.isFinite(fair)) chances.push(fair);
  }
  if (!chances.length) return null;
  const probability = chances.reduce((s, c) => s + c, 0) / chances.length;
  return { source: "novig", probability: Number(probability.toFixed(4)), decimal: Number((1 / probability).toFixed(3)), books: chances.length };
}

export function compareLeg(prices: BookPrice[], q: LegQuery, opts: CompareOptions = {}): LegComparison {
  const threshold = opts.dispersionPct ?? 7;
  const atLine = latestPerBook(prices.filter((p) => sameSelection(p, q) && (q.market === "moneyline" || same(p.line, q.line))));
  const books = atLine.filter((p) => p.platform !== EXCHANGE).map(toQuote).sort((a, b) => b.decimal - a.decimal);
  const exchange = atLine.filter((p) => p.platform === EXCHANGE).map(toQuote)[0] ?? null;
  const best = books[0] ?? null;
  const worst = books.length ? books[books.length - 1] : null;
  const medianDecimal = median(books.map((b) => b.decimal));
  const fair = fairPrice(prices, q);

  const dispersion: Dispersion[] = [];
  if (books.length >= 2) {
    for (const b of books) {
      const others = books.filter((x) => x.book !== b.book).map((x) => x.decimal);
      const m = median(others)!;
      const pct = pctOver(b.decimal, m);
      if (Math.abs(pct) >= threshold) dispersion.push({ book: b.book, decimal: b.decimal, othersMedian: Number(m.toFixed(3)), others: others.length, pct });
    }
    dispersion.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }

  // The same stat and side at another line: the owner's "odds desbalanceadas em linha específica".
  const lineAlternatives: LineAlternative[] = [];
  if ((q.market === "player_prop" || q.market === "total" || q.market === "spread") && q.line !== undefined) {
    const others = latestPerBook(prices.filter((p) => p.platform !== EXCHANGE && sameSelection(p, q) && p.line !== undefined && !same(p.line, q.line)));
    // Measured against the consensus at the leg's own line, not against an outlier best price.
    const reference = medianDecimal ?? best?.decimal ?? null;
    for (const p of others) {
      const friendlier = q.side === "under" || (q.market === "spread" ? true : false) ? p.line! > q.line! : p.line! < q.line!;
      // A spread is friendlier when the side receives more points (home −6.5 vs −7.5; away +8.5 vs +7.5).
      const spreadFriendlier = q.market === "spread" ? p.line! > q.line! : friendlier;
      const priceOk = reference === null || p.decimal >= reference * (1 - threshold / 100);
      lineAlternatives.push({ book: p.book, line: p.line!, decimal: p.decimal, better: spreadFriendlier && priceOk, url: p.url });
    }
    lineAlternatives.sort((a, b) => Number(b.better) - Number(a.better) || b.decimal - a.decimal);
  }

  return {
    query: q,
    quotes: books,
    exchange,
    best,
    worst,
    medianDecimal: medianDecimal === null ? null : Number(medianDecimal.toFixed(3)),
    bestVsWorstPct: best && worst && worst.decimal > 1 && best.book !== worst.book ? pctOver(best.decimal, worst.decimal) : null,
    fair,
    edgeVsFairPct: fair ? books.map((b) => ({ book: b.book, pct: Number(((b.decimal * fair.probability - 1) * 100).toFixed(2)) })) : [],
    dispersion,
    lineAlternatives,
  };
}

export function compareTicket(prices: BookPrice[], legs: { query: LegQuery; decimal: number | null }[], opts: CompareOptions = {}): TicketComparison {
  const compared = legs.map((l) => compareLeg(prices, l.query, opts));
  const books = [...new Set(compared.flatMap((c) => c.quotes.map((q) => q.book)))].sort();
  const perBook: BookTotal[] = books.map((book) => {
    let decimal = 1, priced = 0;
    for (const c of compared) {
      const q = c.quotes.find((x) => x.book === book);
      if (q) { decimal *= q.decimal; priced += 1; }
    }
    return { book, decimal: Number(decimal.toFixed(2)), priced, of: compared.length };
  }).sort((a, b) => b.priced - a.priced || b.decimal - a.decimal);
  const complete = perBook.filter((b) => b.priced === compared.length && compared.length > 0);
  const bestSingleBook = complete[0] ?? null;
  const theoreticalBest = compared.length && compared.every((c) => c.best) ? Number(compared.reduce((p, c) => p * c.best!.decimal, 1).toFixed(2)) : null;
  const reference = legs.every((l) => l.decimal && l.decimal > 1) && legs.length ? Number(legs.reduce((p, l) => p * l.decimal!, 1).toFixed(2)) : null;
  return {
    legs: compared,
    bestSingleBook,
    perBook,
    theoreticalBest,
    referenceDecimal: reference,
    bestSingleVsReferencePct: bestSingleBook && reference ? pctOver(bestSingleBook.decimal, reference) : null,
    theoreticalVsReferencePct: theoreticalBest && reference ? pctOver(theoreticalBest, reference) : null,
    books,
  };
}

/**
 * The event's most interesting player lines, for the model and the admin: every prop where a book
 * sits ≥ threshold off the others, or posts a friendlier line, ranked by how far off it is.
 */
export interface PropSignal { player: string; stat: string; side: "over" | "under"; line: number; comparison: LegComparison; score: number }

export function propSignals(prices: BookPrice[], opts: CompareOptions = {}, limit = 12): PropSignal[] {
  const keys = new Map<string, LegQuery>();
  for (const p of prices) {
    if (p.market !== "player_prop" || !p.player || !p.stat || p.line === undefined || (p.side !== "over" && p.side !== "under")) continue;
    keys.set(`${playerKey(p.player)}|${p.stat}|${p.side}|${p.line}`, { market: "player_prop", player: p.player, stat: p.stat, side: p.side, line: p.line });
  }
  const out: PropSignal[] = [];
  for (const q of keys.values()) {
    const c = compareLeg(prices, q, opts);
    if (c.quotes.length < 2) continue;
    const betterLine = c.lineAlternatives.some((a) => a.better);
    if (!c.dispersion.length && !betterLine) continue;
    // Deep ladder rungs (30+ points at 20.0) disagree wildly and matter little: the weight falls off
    // past 2.5, so a main line at 1.9 outranks a 15.0 rung with twice the spread, and anything
    // priced beyond 10.0 — a lottery rung, not a line a ticket is built on — is left out.
    const anchor = c.medianDecimal ?? c.best!.decimal;
    if (anchor > 10) continue;
    const weight = Math.min(1, (2.5 / anchor) ** 2);
    const disp = c.dispersion[0]?.pct ?? 0;
    const score = Number((Math.max(Math.abs(disp), betterLine ? (opts.dispersionPct ?? 7) : 0) * weight).toFixed(2));
    out.push({ player: q.player!, stat: q.stat!, side: q.side as "over" | "under", line: q.line!, comparison: c, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const impliedOf = impliedProbability;
