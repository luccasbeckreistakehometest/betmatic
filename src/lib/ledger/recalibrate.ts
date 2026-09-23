import { calibrate } from "@/lib/ledger/calibrate";
import type { CalibrationReport, CalibrationRow } from "@/lib/types";

/**
 * The stated chance, corrected by what that slice of evidence actually delivered.
 *
 * The track record has been in the prompt for weeks, ending with "where a source is measured
 * OVERCONFIDENT, lower your fairProbability". It does not work: on 23/09/2026 the measured player
 * prop slice was 45% right against 58% claimed, and the live reads promised 93,4% on legs that
 * landed 78,0% — a z of −8,55 over 168 legs, which is not luck. Asking a language model to apply an
 * arithmetic penalty to its own confidence is asking it to do the one thing it is worst at. So the
 * correction moves here, where it is arithmetic and auditable.
 *
 * The method is Platt-style recalibration in log-odds space, shrunk by sample size: the measured
 * gap between what a slice claimed on average and what it delivered becomes a shift, and that shift
 * is applied at only `n / (n + PRIOR)` of its strength. A slice with 20 settled legs moves a third
 * of the way; one with 200 moves most of it. Ordering is preserved — a leg the model liked more
 * still comes out higher — and nothing is ever pushed past the bounds.
 *
 * It is a feedback loop on purpose: calibration is measured on the STORED probability, which is the
 * corrected one, so once a slice is honest the correction it earns is zero. It converges rather
 * than compounding.
 */

/** Below this many settled legs a slice says nothing, and nothing is corrected. */
export const MIN_SAMPLE = 20;
/** How many legs of evidence it takes to earn half of the measured correction. */
export const PRIOR_STRENGTH = 40;
/** No single correction may move a probability by more than this, however bad the slice looks. */
export const MAX_SHIFT = 1.5;

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (p: number) => Math.min(Math.max(p, 0.001), 0.999);

export interface Correction {
  /** Log-odds shift to add. Negative pulls a claim down, which is the usual direction. */
  shift: number;
  settled: number;
  claimed: number;
  delivered: number;
  label: string;
}

/**
 * The correction one measured slice earns. Returns null when the slice has not settled enough legs
 * to say anything — the product's standing rule is that a thin sample concludes nothing.
 */
export function correctionOf(row: CalibrationRow | undefined, minSample = MIN_SAMPLE): Correction | null {
  if (!row || row.settled < minSample) return null;
  const claimed = clamp(row.averagePredicted);
  const delivered = clamp(row.hitRate);
  if (!Number.isFinite(claimed) || !Number.isFinite(delivered)) return null;

  const raw = logit(delivered) - logit(claimed);
  const weight = row.settled / (row.settled + PRIOR_STRENGTH);
  const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, raw * weight));
  return { shift, settled: row.settled, claimed, delivered, label: row.label };
}

const find = (rows: CalibrationRow[], key: string) => rows.find((r) => r.key === key);

/**
 * Every correction the ledger currently supports, read once so a whole slate can be priced without
 * re-reading the record per leg.
 */
export interface Calibrator {
  /** The corrected chance for one leg, and why it moved. */
  apply(stated: number, sourceBasis: string, market: string): { probability: number; correction: Correction | null };
  /** Human-readable, for the generation log and the data note. */
  describe(): string;
}

/**
 * The calibrator for one kind of ticket. A live read is corrected against the live record, never
 * against the pre-game one: the two are measured far apart (−8 points against −22), so borrowing
 * the gentler number would leave most of the overconfidence in place.
 */
export function calibratorFor(scope: "pre" | "live"): Calibrator {
  return buildCalibrator(calibrate(MIN_SAMPLE, scope));
}

export function buildCalibrator(report: CalibrationReport = calibrate(MIN_SAMPLE)): Calibrator {
  const applied: Correction[] = [];
  return {
    apply(stated, sourceBasis, market) {
      const p = clamp(stated);
      // The narrower slice wins: how a source behaves ON THIS MARKET beats how it behaves overall.
      const correction =
        correctionOf(find(report.byMarket, market)) ?? correctionOf(find(report.bySource, sourceBasis));
      if (!correction) return { probability: p, correction: null };
      if (!applied.some((c) => c.label === correction.label)) applied.push(correction);
      return { probability: clamp(sigmoid(logit(p) + correction.shift)), correction };
    },
    describe() {
      if (!applied.length) return "";
      return applied
        .map((c) => `${c.label}: prometeu ${Math.round(c.claimed * 100)}% e entregou ${Math.round(c.delivered * 100)}% em ${c.settled} linhas`)
        .join(" · ");
    },
  };
}
