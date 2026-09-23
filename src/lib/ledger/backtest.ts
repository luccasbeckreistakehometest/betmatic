import { ODDS_BANDS } from "@/lib/odds";
import type { LedgerEntry, LegOutcome } from "@/lib/types";

/**
 * The equity curve and the strategy backtest, as pure functions over a compact row shape.
 *
 * Rows carry no titles, selections or evidence text: the browser renders the chart from them, and
 * anything with a source name in it must never reach a non-admin. Flat one unit on every ticket —
 * the same honest stake the public proof page uses — so "what if I had only followed band X" is a
 * filter, not a model.
 *
 * PRE-GAME ONLY. A live read carries the pre-game board as its price, which no book is still
 * offering once the ball is up, so a unit "staked" on one is a unit at a price that did not exist:
 * a curve with them in it climbs on money nobody could have collected. `toRows` drops them.
 */
export interface BacktestRow {
  id: string;
  /** Settlement time, or creation time while pending. */
  at: string;
  outcome: LegOutcome;
  odds: number;
  band: string;
  sport: string;
  kind: "single" | "parlay";
  /** 0–100 from the generator; null for tickets logged before the score was recorded. */
  evidence: number | null;
}

export interface BacktestFilter {
  band?: string | null;
  sport?: string | null;
  kind?: "single" | "parlay" | null;
  /** Keeps only rows whose evidence score is at least this; rows without a score are dropped. */
  minEvidence?: number | null;
}

export interface CurvePoint { id: string; at: string; units: number; delta: number; outcome: "won" | "lost" }

export interface CurveSummary {
  decided: number; won: number; lost: number;
  /** Final cumulative units at flat 1u. */
  units: number;
  roi: number;
  peak: number;
  /** Largest peak-to-trough fall of the cumulative line, in units (>= 0). */
  maxDrawdown: number;
  longestLosingStreak: number;
  points: CurvePoint[];
}

/** `idOf` lets the server hand the browser public slugs instead of raw ids (which embed selection text). */
export function toRows(entries: LedgerEntry[], idOf: (e: LedgerEntry) => string = (e) => e.id): BacktestRow[] {
  return entries.filter((e) => e.scope !== "live").map((e) => ({
    id: idOf(e), at: e.settledAt ?? e.createdAt, outcome: e.outcome, odds: e.combinedDecimal, band: e.bandKey, sport: e.sportKey, kind: e.kind,
    evidence: typeof e.evidenceScore === "number" ? e.evidenceScore : null,
  }));
}

export const unitDelta = (r: Pick<BacktestRow, "outcome" | "odds">): number => (r.outcome === "won" ? r.odds - 1 : r.outcome === "lost" ? -1 : 0);

export function applyFilter(rows: BacktestRow[], f: BacktestFilter = {}): BacktestRow[] {
  return rows.filter((r) =>
    (!f.band || r.band === f.band) &&
    (!f.sport || r.sport === f.sport) &&
    (!f.kind || r.kind === f.kind) &&
    (!(f.minEvidence && f.minEvidence > 0) || (r.evidence !== null && r.evidence >= f.minEvidence)),
  );
}

/** Won/lost only, in settlement order. Ties break on id so the curve is the same on every render. */
export function decidedInOrder(rows: BacktestRow[]): BacktestRow[] {
  return rows.filter((r) => r.outcome === "won" || r.outcome === "lost").sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function equityCurve(rows: BacktestRow[], filter: BacktestFilter = {}): CurveSummary {
  const decided = decidedInOrder(applyFilter(rows, filter));
  const points: CurvePoint[] = [];
  let units = 0, peak = 0, maxDrawdown = 0, streak = 0, longest = 0, won = 0;
  for (const r of decided) {
    const delta = unitDelta(r);
    units += delta;
    if (r.outcome === "won") { won += 1; streak = 0; } else { streak += 1; longest = Math.max(longest, streak); }
    peak = Math.max(peak, units);
    maxDrawdown = Math.max(maxDrawdown, peak - units);
    points.push({ id: r.id, at: r.at, units: round(units), delta: round(delta), outcome: r.outcome as "won" | "lost" });
  }
  return {
    decided: decided.length, won, lost: decided.length - won, units: round(units), roi: decided.length ? round(units / decided.length, 4) : 0,
    peak: round(peak), maxDrawdown: round(maxDrawdown), longestLosingStreak: longest, points,
  };
}

/** "If you had followed only band X": one curve per band present, in ladder order. */
export function bandComparison(rows: BacktestRow[], filter: Omit<BacktestFilter, "band"> = {}): { band: string; summary: CurveSummary }[] {
  const present = new Set(applyFilter(rows, filter).filter((r) => r.outcome === "won" || r.outcome === "lost").map((r) => r.band));
  const order = ODDS_BANDS.map((b) => b.key);
  return [...present]
    .sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map((band) => ({ band, summary: equityCurve(rows, { ...filter, band }) }));
}

export interface CurvePath { d: string; zeroY: number; min: number; max: number; xOf: (i: number) => number; yOf: (units: number) => number }

/**
 * SVG path for the cumulative line. The origin (0 units, before the first ticket) is the first
 * vertex; the y-domain always includes zero so the line never floats away from its baseline.
 */
export function curvePath(points: { units: number }[], width: number, height: number, pad = 4): CurvePath {
  const values = [0, ...points.map((p) => p.units)];
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const innerW = Math.max(1, width - pad * 2), innerH = Math.max(1, height - pad * 2);
  const xOf = (i: number) => round(pad + (points.length ? (i / points.length) * innerW : 0), 2);
  const yOf = (units: number) => round(pad + (1 - (units - min) / span) * innerH, 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");
  return { d, zeroY: yOf(0), min, max, xOf, yOf };
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
