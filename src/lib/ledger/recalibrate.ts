import { calibrate } from "@/lib/ledger/calibrate";
import { applyFit, shrinkFit, type PlattFit } from "@/lib/ledger/platt";
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
 * The method is Platt recalibration in log-odds space, shrunk by sample size: a slice's own settled
 * legs are fitted with `σ(a·logit(p) + b)` (ledger/platt.ts), and that map is applied at only
 * `n / (n + PRIOR)` of its strength. A slice with 20 settled legs moves a third of the way; one with
 * 200 moves most of it. Ordering is preserved — a leg the model liked more still comes out higher —
 * and nothing is ever pushed past the bounds.
 *
 * The SLOPE is the part that arrived on 24/09/2026, and it arrived because the loop asked for it.
 * Until then the correction was one shift fitted at the slice's mean, which assumes the model is
 * uniformly optimistic. Seven post-mortems that night said it is not: the legs claiming 60–70%
 * delivered 24%, the ones claiming 80–90% delivered 63%, and live 'over' legs were UNDER-confident
 * at 86% against 73% claimed. One shift cannot fit a gap that grows with the claim, and it
 * under-corrects worst exactly where the model is most confident and most wrong. A slope below 1
 * pulls hardest at the extremes, which is the measured shape.
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
const clamp = (p: number) => Math.min(Math.max(p, 0.001), 0.999);

export interface Correction {
  /**
   * Log-odds shift at the slice's own average claim. It is what the correction does to a TYPICAL leg
   * of the slice, kept because it is the one number a person can read — but it is no longer the
   * whole correction, and a leg far from the average moves by more or less than this.
   */
  shift: number;
  /** The fitted map actually applied, already shrunk by sample size. */
  fit: PlattFit;
  settled: number;
  claimed: number;
  delivered: number;
  label: string;
}

/**
 * The correction one measured slice earns. Returns null when the slice has not settled enough legs
 * to say anything — the product's standing rule is that a thin sample concludes nothing.
 *
 * The map comes from the slice's own legs and is shrunk here, so `calibrate()` reports what the legs
 * said and this reports what the product dares act on.
 */
export function correctionOf(row: CalibrationRow | undefined, minSample = MIN_SAMPLE): Correction | null {
  if (!row || row.settled < minSample) return null;
  const claimed = clamp(row.averagePredicted);
  const delivered = clamp(row.hitRate);
  if (!Number.isFinite(claimed) || !Number.isFinite(delivered)) return null;

  const raw: PlattFit = row.fit
    ? { ...row.fit, n: row.settled }
    // A row from before the fit existed (a stored report, a hand-built fixture) still gets the
    // correction it always got: the average gap, as an intercept with the slope held at 1.
    : { slope: 1, intercept: logit(delivered) - logit(claimed), n: row.settled, spread: 0, interceptOnly: true };
  const fit = shrinkFit(raw, PRIOR_STRENGTH, MAX_SHIFT);
  const shift = logit(applyFit(fit, claimed)) - logit(claimed);
  return { shift, fit, settled: row.settled, claimed, delivered, label: row.label };
}

const find = (rows: CalibrationRow[], key: string) => rows.find((r) => r.key === key);

/**
 * Every correction the ledger currently supports, read once so a whole slate can be priced without
 * re-reading the record per leg.
 */
export interface Calibrator {
  /** The corrected chance for one leg, and why it moved. */
  /**
   * `stat` is the canonical market key (stat-key.ts) — PTS, REB+AST, PTS+REB. Pass it whenever the
   * caller can compute it: 1076 of the ledger's 1099 linhas carry `market: "player_prop"`, so
   * `byMarket` is very nearly one bucket and the slice it offers is rarely the sharp one.
   */
  apply(stated: number, sourceBasis: string, market: string, stat?: string | null): { probability: number; correction: Correction | null };
  /** Human-readable, for the generation log and the data note. */
  describe(): string;
}

/**
 * The calibrator for one kind of ticket. A live read is corrected against the live record, never
 * against the pre-game one: the two are measured far apart (−8 points against −22), so borrowing
 * the gentler number would leave most of the overconfidence in place.
 *
 * The two scopes do not use the same ladder, and that is a measured decision, not a preference.
 * `scripts/medir-calibracao.mts` grades every option against the real ledger held out in TIME, at
 * three split points. On the live record the per-stat rung is actively harmful — it lets a 75-leg
 * slice overrule a 456-leg one and then carries that slice's noise into the next night — so live
 * corrects on the widest slice it has. On the pre-game record the per-stat ladder is the least bad
 * of the correcting options, so it stays.
 */
export function calibratorFor(scope: "pre" | "live"): Calibrator {
  return buildCalibrator(calibrate(MIN_SAMPLE, scope), { widestOnly: scope === "live" });
}

export interface CalibratorOptions {
  /**
   * Skip the per-stat rung and correct on the widest slice available.
   *
   * Measured on the live ledger (654 settled legs, held out in time, Brier against no correction at
   * all): the shipped narrow-first ladder scored −6.7%, +3.0% and +9.9% across three splits — worse
   * than doing nothing on average. Widest-slice-plus-slope scored −7.8%, −9.5% and +0.7%: better in
   * all three, and its worst case is a rounding error where the ladder's worst case is +9.9%.
   *
   * The reason is visible in the slices. Live `rebounds` trained at 75 legs promising 83% and
   * delivering 93%, which fits a slope of 1.57 — a correction that pushes confidence UP — while
   * `player_prop` at 456 legs promised 86% and delivered 73%. The ladder handed the 75-leg slice the
   * decision. That 93% was one good week and it did not repeat.
   */
  widestOnly?: boolean;
}

export function buildCalibrator(report: CalibrationReport = calibrate(MIN_SAMPLE), opts: CalibratorOptions = {}): Calibrator {
  const applied: Correction[] = [];
  return {
    apply(stated, sourceBasis, market, stat) {
      const p = clamp(stated);
      // The ladder walks from narrow to wide: the canonical stat first, because PTS and REB+AST are
      // populations that behave differently and `player_prop` holds 1076 of the ledger's 1099
      // linhas; then the raw market; then the source. Each rung is gated at MIN_SAMPLE inside
      // `correctionOf`, so a thin stat slice falls through on its own.
      //
      // `widestOnly` drops the first rung entirely. MIN_SAMPLE was never a high enough bar for a
      // narrow slice to overrule a wide one — 20 legs against 456 — and on the live record that is
      // measured as the difference between helping and hurting.
      const correction =
        (stat && !opts.widestOnly ? correctionOf(find(report.byStat, stat)) : null) ??
        correctionOf(find(report.byMarket, market)) ??
        correctionOf(find(report.bySource, sourceBasis));
      if (!correction) return { probability: p, correction: null };
      if (!applied.some((c) => c.label === correction.label)) applied.push(correction);
      return { probability: applyFit(correction.fit, p), correction };
    },
    describe() {
      if (!applied.length) return "";
      return applied
        .map((c) => {
          const shape = c.fit.interceptOnly || Math.abs(c.fit.slope - 1) < 0.02
            ? ""
            : c.fit.slope < 1
              ? `, e errou mais quanto mais alto o número (inclinação ${c.fit.slope.toFixed(2)})`
              : `, e errou mais quanto mais baixo o número (inclinação ${c.fit.slope.toFixed(2)})`;
          return `${c.label}: prometeu ${Math.round(c.claimed * 100)}% e entregou ${Math.round(c.delivered * 100)}% em ${c.settled} linhas${shape}`;
        })
        .join(" · ");
    },
  };
}
