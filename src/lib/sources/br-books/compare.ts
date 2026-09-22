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
  /** Median of the other FEEDS at the same line (one value per platform, so five Altenar tenants count once). */
  othersMedian: number;
  /** Other feeds (platforms) behind the median. */
  others: number;
  /** Other books behind those feeds, for the copy ("1 feed, 4 casas"). */
  otherBooks: number;
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
/** The exchange counts as a reference only while a lay sits within this ratio of the back… */
export const EXCHANGE_MAX_SPREAD = 1.1;
/** …or, at long odds where the price ladder's own ticks are wide, within this much implied probability. */
export const EXCHANGE_MAX_GAP = 0.015;

/**
 * Whether the exchange has a market here rather than a stray order: a lay exists, at or above the
 * back, and the two sit close — 10% in price (1.20/1.32 is not a market), or 1.5 points of chance
 * (9.6/11.0 on an underdog is: the ladder moves in half-points up there).
 */
export function exchangeIsMarket(back: number, lay: number | undefined): boolean {
  if (!lay || lay < back || back <= 1) return false;
  return lay / back <= EXCHANGE_MAX_SPREAD || 1 / back - 1 / lay <= EXCHANGE_MAX_GAP;
}
const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 0.011;

// playerKey normalises Unicode on every call; a game carries a thousand prop rows and each query
// scans them, so the key is remembered per spelling (bounded, cleared when it grows).
const keyMemo = new Map<string, string>();
function pkey(name: string): string {
  let k = keyMemo.get(name);
  if (k === undefined) {
    if (keyMemo.size > 5000) keyMemo.clear();
    k = playerKey(name);
    keyMemo.set(name, k);
  }
  return k;
}

/** Rows of one selection (player + stat, both sides, every line): the only rows a leg query can touch. */
export function selectionKey(p: Pick<BookPrice, "market" | "player" | "stat">): string {
  return p.market === "player_prop" ? `prop|${pkey(p.player ?? "")}|${p.stat ?? ""}` : p.market;
}

/** Groups a game's rows once so each query scans its own selection instead of the whole game. */
export function groupBySelection(prices: BookPrice[]): Map<string, BookPrice[]> {
  const out = new Map<string, BookPrice[]>();
  for (const p of prices) {
    const k = selectionKey(p);
    const list = out.get(k);
    if (list) list.push(p); else out.set(k, [p]);
  }
  return out;
}

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
  if (q.market === "player_prop") return !!q.player && !!p.player && pkey(p.player) === pkey(q.player) && p.stat === q.stat && p.side === q.side;
  if (q.market === "moneyline") return p.side === q.side;
  return p.side === q.side;
}

const toQuote = (p: BookPrice): Quote => ({ book: p.book, platform: p.platform, decimal: p.decimal, line: p.line, lay: p.lay, kind: p.kind, url: p.url, fetchedAt: p.fetchedAt });

/**
 * One row per book for one selection and line. The store keeps history, the reader wants now, so
 * the newest row per (book, kind) wins; and where a book posts the same line twice — an over/under
 * pair at 17.5 and an "18+" rung — the two settle identically, so the better price is the book's.
 */
function latestPerBook(rows: BookPrice[]): BookPrice[] {
  const byBookKind = new Map<string, BookPrice>();
  for (const r of rows) {
    const k = `${r.book}|${r.kind ?? ""}`;
    const cur = byBookKind.get(k);
    if (!cur || r.fetchedAt > cur.fetchedAt) byBookKind.set(k, r);
  }
  const byBook = new Map<string, BookPrice>();
  for (const r of byBookKind.values()) {
    const cur = byBook.get(r.book);
    if (!cur || r.decimal > cur.decimal) byBook.set(r.book, r);
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
 * Fair chance of the selection. The exchange midpoint wins when the exchange has a real market —
 * a lay within 10% of the back (commission aside); a lone back order, or a book-wide gap, is not
 * the crowd's price and falls through to the mean of every book's no-vig chance where the book
 * posts both sides of the same line. A three-way moneyline (soccer) is left without a fair price.
 */
export function fairPrice(prices: BookPrice[], q: LegQuery): FairPrice | null {
  const ex = latestPerBook(prices.filter((p) => p.platform === EXCHANGE && sameSelection(p, q) && (q.market === "moneyline" || same(p.line, q.line))))[0];
  if (ex && exchangeIsMarket(ex.decimal, ex.lay)) {
    const mid = (ex.decimal + ex.lay!) / 2;
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

  // The five Altenar tenants are one feed with five names: a book is measured against the median of
  // the other FEEDS (one value per platform, the platform's own median), never against its clones.
  const dispersion: Dispersion[] = [];
  if (books.length >= 2) {
    for (const b of books) {
      const byPlatform = new Map<string, number[]>();
      for (const x of books) {
        if (x.book === b.book || x.platform === b.platform && x.decimal === b.decimal) continue;
        const list = byPlatform.get(x.platform);
        if (list) list.push(x.decimal); else byPlatform.set(x.platform, [x.decimal]);
      }
      if (!byPlatform.size) continue;
      const feeds = [...byPlatform.values()].map((v) => median(v)!);
      const m = median(feeds)!;
      const pct = pctOver(b.decimal, m);
      if (Math.abs(pct) >= threshold) dispersion.push({ book: b.book, decimal: b.decimal, othersMedian: Number(m.toFixed(3)), others: feeds.length, otherBooks: [...byPlatform.values()].reduce((n, v) => n + v.length, 0), pct });
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
  // Every query only ever needs its own selection's rows (both sides, every line, for the no-vig
  // pair and the friendlier lines), so the game is grouped once instead of scanned per query.
  const groups = groupBySelection(prices);
  const keys = new Map<string, { q: LegQuery; rows: BookPrice[] }>();
  for (const [sel, rows] of groups) {
    if (!sel.startsWith("prop|")) continue;
    for (const p of rows) {
      if (!p.player || !p.stat || p.line === undefined || (p.side !== "over" && p.side !== "under")) continue;
      const k = `${sel}|${p.side}|${p.line}`;
      if (!keys.has(k)) keys.set(k, { q: { market: "player_prop", player: p.player, stat: p.stat, side: p.side, line: p.line }, rows });
    }
  }
  const out: PropSignal[] = [];
  for (const { q, rows } of keys.values()) {
    const c = compareLeg(rows, q, opts);
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
