import { impliedProbability, parseOdds } from "@/lib/odds";
import type { PropRow } from "@/lib/types";

/** A prop row tagged with where it came from, so disagreement can be attributed. */
export interface SourcedProp extends PropRow {
  source: string;
}

export interface PriceQuote {
  source: string;
  odds: string;
  decimal: number;
  book?: string;
}

export interface ConsensusProp {
  player: string;
  market: string;
  side: "over" | "under" | "unknown";
  /** Every distinct line the sources posted for this prop. */
  lines: { line: number; quotes: PriceQuote[] }[];
  /** The line most sources agree on. */
  consensusLine: number;
  /** Sources disagree on the number itself, not just the price. */
  lineDisagreement: boolean;
  /** Best available price at the consensus line. */
  best: PriceQuote | null;
  worst: PriceQuote | null;
  /** How much the best price beats the median, in percentage points of implied probability. */
  shoppingGainPct: number;
  /** Median implied probability across quotes at the consensus line, before removing vig. */
  medianImplied: number;
  /** Measured hit rate carried over from whichever source supplied it. */
  measuredFair: number | null;
  sources: string[];
  note: string;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function key(row: SourcedProp): string {
  const player = row.player.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();
  return `${player}|${row.market.toLowerCase().trim()}|${row.side ?? "unknown"}`;
}

/**
 * Cross-references the same prop across every source that posted it.
 *
 * Two things fall out that no single source can give. First, line shopping: taking the best of
 * several prices for the identical bet is the least contested edge in betting, and it is free.
 * Second, line disagreement — when one book posts 22.5 and the rest post 24.5, that book is either
 * stale or holds information, and either way it is the most interesting row on the page.
 */
export function buildConsensus(rows: SourcedProp[]): ConsensusProp[] {
  const groups = new Map<string, SourcedProp[]>();
  for (const row of rows) {
    if (!row.player || !row.market) continue;
    const k = key(row);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }

  const out: ConsensusProp[] = [];

  for (const group of groups.values()) {
    const byLine = new Map<number, PriceQuote[]>();
    for (const row of group) {
      if (row.line === undefined || !Number.isFinite(row.line)) continue;
      const decimal = parseOdds(row.odds);
      const quote: PriceQuote = {
        source: row.source,
        odds: row.odds ?? "—",
        decimal,
        book: row.book,
      };
      byLine.set(row.line, [...(byLine.get(row.line) ?? []), quote]);
    }
    if (!byLine.size) continue;

    const lines = [...byLine.entries()]
      .map(([line, quotes]) => ({ line, quotes }))
      .sort((a, b) => b.quotes.length - a.quotes.length);

    // The line the most sources posted wins; ties go to the lower line, which is the safer read
    // for an over and the more conservative claim either way.
    const top = lines[0];
    const tied = lines.filter((l) => l.quotes.length === top.quotes.length);
    const consensusLine = Math.min(...tied.map((l) => l.line));
    const atConsensus = byLine.get(consensusLine) ?? [];

    const priced = atConsensus.filter((q) => Number.isFinite(q.decimal) && q.decimal > 1);
    const best = priced.length ? priced.reduce((a, b) => (b.decimal > a.decimal ? b : a)) : null;
    const worst = priced.length ? priced.reduce((a, b) => (b.decimal < a.decimal ? b : a)) : null;
    const medianImplied = median(priced.map((q) => impliedProbability(q.decimal)));
    const bestImplied = best ? impliedProbability(best.decimal) : NaN;

    // Expressed in points of implied probability: how much cheaper the best price makes the bet.
    const shoppingGainPct =
      Number.isFinite(bestImplied) && Number.isFinite(medianImplied)
        ? Number(((medianImplied - bestImplied) * 100).toFixed(2))
        : 0;

    const measured = group.find((r) => r.measured)?.measured ?? null;
    const sources = [...new Set(group.map((r) => r.source))];
    const lineDisagreement = byLine.size > 1;

    out.push({
      player: group[0].player,
      market: group[0].market,
      side: group[0].side === "under" ? "under" : group[0].side === "over" ? "over" : "unknown",
      lines,
      consensusLine,
      lineDisagreement,
      best,
      worst,
      shoppingGainPct,
      medianImplied,
      measuredFair: measured ? measured.impliedFair : null,
      sources,
      note: [
        `${sources.length} fonte${sources.length === 1 ? "" : "s"}`,
        lineDisagreement
          ? `linhas divergentes: ${lines.map((l) => l.line).join(" / ")}`
          : `linha única ${consensusLine}`,
        shoppingGainPct > 0.5 ? `melhor preço economiza ${shoppingGainPct}pp` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  // Disagreement first, then the biggest shopping gain: both are reasons to look.
  return out.sort((a, b) => {
    if (a.lineDisagreement !== b.lineDisagreement) return a.lineDisagreement ? -1 : 1;
    return b.shoppingGainPct - a.shoppingGainPct;
  });
}

/**
 * Where a measured hit rate and the market's median disagree by enough to matter.
 * This is the only place the product claims an edge, and it is stated as a gap, never a promise.
 */
export function edgeCandidates(consensus: ConsensusProp[], minGapPct = 6): ConsensusProp[] {
  return consensus.filter((c) => {
    if (c.measuredFair === null || !Number.isFinite(c.medianImplied)) return false;
    return (c.measuredFair - c.medianImplied) * 100 >= minGapPct;
  });
}

export function consensusPrompt(consensus: ConsensusProp[]): string {
  if (!consensus.length) return "CROSS-SOURCE LINES: only one source returned props, so nothing could be cross-referenced.";
  const edges = edgeCandidates(consensus);
  return [
    "CROSS-SOURCE LINES — the same prop as posted by every source that carried it:",
    ...consensus.slice(0, 14).map((c) => {
      const priceInfo = c.best
        ? `best ${c.best.odds} at ${c.best.book ?? c.best.source}${c.worst && c.worst.decimal !== c.best.decimal ? ` (worst ${c.worst.odds})` : ""}`
        : "no usable price";
      const measured = c.measuredFair !== null ? `, measured ${(c.measuredFair * 100).toFixed(0)}%` : "";
      const marketProb = Number.isFinite(c.medianImplied) ? `, market ${(c.medianImplied * 100).toFixed(0)}%` : "";
      return `- ${c.player} ${c.market} ${c.side} ${c.consensusLine}: ${priceInfo}${marketProb}${measured} | ${c.note}`;
    }),
    "",
    edges.length
      ? `Measured history disagrees with the market by 6+ points on: ${edges.map((e) => `${e.player} ${e.market} ${e.consensusLine}`).join("; ")}. These are the strongest candidates, but the gap is evidence of a difference, not proof the market is wrong.`
      : "No prop shows a 6-point gap between measured history and the market. Say so rather than manufacturing one.",
    "Always cite the best available price and where it is, since taking a worse number for the identical bet is a guaranteed loss of value.",
    "When sources disagree on the line itself, treat the outlier as either stale or informed — flag it, do not silently average it away.",
  ].join("\n");
}

/**
 * Consensus rows from the feeds the app actually has: DraftKings' posted props, plus every provider's
 * current moneyline (Bet 365 appears next to DraftKings on many soccer games).
 */
export function consensusFromFeeds(
  props: PropRow[],
  lines: { provider: string; current: { homeMl: number | null; awayMl: number | null; draw: number | null } | null }[],
  teams: { home: string; away: string },
): ConsensusProp[] {
  const rows: SourcedProp[] = props
    .filter((p) => p.priced)
    .map((p) => ({ ...p, source: p.book ?? "book" }));
  for (const l of lines) {
    if (!l.current) continue;
    const add = (who: string, price: number | null) => {
      if (price && price > 1) rows.push({ player: who, market: "moneyline", line: 0, side: "unknown", odds: price.toFixed(2), book: l.provider, source: l.provider });
    };
    add(teams.home, l.current.homeMl);
    add(teams.away, l.current.awayMl);
    add("Draw", l.current.draw);
  }
  return buildConsensus(rows);
}
