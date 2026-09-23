/**
 * The dimensions a decided leg can be sliced by. One row in, a handful of (dimension, value) tags
 * out — nothing is aggregated here, so every bucket boundary is visible, testable and cheap to
 * change. `factor-report.ts` decides which of them has a sample worth reading.
 *
 * Three of these dimensions only exist because the generation payload is now copied onto the leg
 * (`SettledLeg.projectedMinutes`, `measuredRate`, `blowoutProbability`): before that the ledger
 * could only be cut by price and outcome, which is the reason every earlier slice said the same
 * thing.
 */

export interface FactorTag { dim: string; value: string }

export interface FactorInput {
  ledgerId: string;
  legIndex: number;
  gameId: string;
  day: string;
  scope: "pre" | "live";
  alternative: boolean;
  bandKey: string;
  period?: number;
  ticketLegs: number;
  marketKey: string;
  side: string;
  athleteId: string;
  predicted: number;
  computed?: number;
  oddsDecimal: number;
  projectedMinutes?: number;
  blowoutProbability?: number;
  clvPct?: number | null;
  outcome: "won" | "lost";
}

const bucket = (value: number | undefined, edges: number[], labels: string[]): string | null => {
  if (value === undefined || !Number.isFinite(value)) return null;
  for (let i = 0; i < edges.length; i += 1) if (value < edges[i]) return labels[i];
  return labels[edges.length];
};

export const predictedBucket = (p: number): string | null =>
  Number.isFinite(p) ? `${(Math.floor(Math.min(0.99, Math.max(0, p)) * 10) * 10)}-${Math.floor(Math.min(0.99, Math.max(0, p)) * 10) * 10 + 10}%` : null;

export const oddsBucket = (d: number): string | null => bucket(d, [1.5, 2, 3, 5, 10, 20], ["1-1.5x", "1.5-2x", "2-3x", "3-5x", "5-10x", "10-20x", "20x+"]);
export const minutesBucket = (m: number | undefined): string | null => bucket(m, [20, 28, 34], ["<20 min", "20-28 min", "28-34 min", "34+ min"]);
export const blowoutBucket = (b: number | undefined): string | null => bucket(b, [0.2, 0.4], ["<20%", "20-40%", "40%+"]);
export const ticketSizeBucket = (n: number): string | null => bucket(n, [2, 3, 5], ["1 leg", "2 legs", "3-4 legs", "5+ legs"]);
export const clvBucket = (clv: number | null | undefined): string | null =>
  clv === null || clv === undefined || !Number.isFinite(clv) ? null : clv < 0 ? "negative CLV" : clv < 3 ? "0-3% CLV" : "3%+ CLV";

/** Distance between the model's number and the computed one — where the two disagree most. */
export const computedGapBucket = (predicted: number, computed: number | undefined): string | null => {
  if (computed === undefined || !Number.isFinite(computed)) return null;
  return bucket(Math.abs(predicted - computed), [0.05, 0.1], ["<5 pts", "5-10 pts", "10+ pts"]);
};

export function factorsOf(row: FactorInput): FactorTag[] {
  const tags: (FactorTag | null)[] = [
    { dim: "stat", value: row.marketKey },
    row.side ? { dim: "side", value: row.side } : null,
    { dim: "band", value: row.bandKey },
    row.period !== undefined ? { dim: "period", value: `Q${row.period}` } : null,
    row.athleteId ? { dim: "athleteId", value: row.athleteId } : null,
    tag("predictedBucket", predictedBucket(row.predicted)),
    tag("computedGapBucket", computedGapBucket(row.predicted, row.computed)),
    tag("oddsBucket", oddsBucket(row.oddsDecimal)),
    tag("ticketSize", ticketSizeBucket(row.ticketLegs)),
    tag("minutesBucket", minutesBucket(row.projectedMinutes)),
    tag("blowoutBucket", blowoutBucket(row.blowoutProbability)),
    tag("clvBucket", clvBucket(row.clvPct)),
  ];
  return tags.filter((t): t is FactorTag => !!t && !!t.value);
}

const tag = (dim: string, value: string | null): FactorTag | null => (value ? { dim, value } : null);

/** The population a row belongs to. These three never mix — they are different bets. */
export const scopeOf = (row: Pick<FactorInput, "scope" | "alternative">): "pregame-main" | "pregame-alt" | "live" =>
  row.scope === "live" ? "live" : row.alternative ? "pregame-alt" : "pregame-main";
