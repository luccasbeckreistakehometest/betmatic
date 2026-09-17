/**
 * Closing line value. A leg beats the close when the price taken is better than the fair price the
 * market settled on at kickoff. The fair price removes the margin from every side the book posted
 * (Unabated's method); with only one side posted the raw close is used and flagged as such.
 * Pure: the close job and /prova both read it.
 */
export type ClvBasis = "novig" | "raw";

/** The no-vig chance of outcome `index` among all the prices of one market. */
export function noVigShare(prices: number[], index: number): number | null {
  if (prices.length < 2 || prices.some((p) => !Number.isFinite(p) || p <= 1)) return null;
  const inv = prices.map((p) => 1 / p);
  const total = inv.reduce((a, b) => a + b, 0);
  return inv[index] / total;
}

export function clvOf(taken: number, close: number, closeFair: number | null): { pct: number; basis: ClvBasis } | null {
  if (!Number.isFinite(taken) || taken <= 1 || !Number.isFinite(close) || close <= 1) return null;
  if (closeFair !== null && closeFair > 0 && closeFair < 1) return { pct: taken * closeFair - 1, basis: "novig" };
  return { pct: taken / close - 1, basis: "raw" };
}

/**
 * When the line itself moved there is no like-for-like price to compare. The direction is still
 * informative: an over taken at 2.5 when the close is 3.5 got the better number.
 */
export function lineMove(side: string | undefined, taken: number, close: number): "favor" | "against" | null {
  if (!Number.isFinite(taken) || !Number.isFinite(close) || taken === close) return null;
  if (side === "over") return close > taken ? "favor" : "against";
  if (side === "under") return close < taken ? "favor" : "against";
  return null;
}

export interface ClvRow { market: string; clvPct: number | null; status: string; basis: ClvBasis | null }

export interface ClvSummary {
  /** Legs with a comparable close. */
  n: number;
  mean: number;
  /** Share of those legs that beat the close. */
  beat: number;
  /** Legs whose line moved (no number, direction only). */
  moved: number;
  movedFavor: number;
  byMarket: { market: string; n: number; mean: number; beat: number }[];
  publishable: boolean;
}

export const CLV_MIN_SAMPLE = 30;

export function clvSummary(rows: (ClvRow & { direction?: string | null })[], minSample = CLV_MIN_SAMPLE): ClvSummary {
  const closed = rows.filter((r) => r.status === "closed" && r.clvPct !== null && Number.isFinite(r.clvPct)) as (ClvRow & { clvPct: number })[];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const markets = new Map<string, number[]>();
  for (const r of closed) markets.set(r.market, [...(markets.get(r.market) ?? []), r.clvPct]);
  const moved = rows.filter((r) => r.status === "line_moved");
  return {
    n: closed.length,
    mean: mean(closed.map((r) => r.clvPct)),
    beat: closed.length ? closed.filter((r) => r.clvPct > 0).length / closed.length : 0,
    moved: moved.length,
    movedFavor: moved.filter((r) => r.direction === "favor").length,
    byMarket: [...markets.entries()]
      .map(([market, xs]) => ({ market, n: xs.length, mean: mean(xs), beat: xs.filter((x) => x > 0).length / xs.length }))
      .sort((a, b) => b.n - a.n),
    publishable: closed.length >= minSample,
  };
}
