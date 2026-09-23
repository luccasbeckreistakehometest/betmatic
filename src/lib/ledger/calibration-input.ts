import { readLedger } from "@/lib/ledger/store";
import { brasiliaDay, mainTickets } from "@/lib/ledger/proof";
import { canonicalMarket } from "@/lib/ledger/stat-key";
import { calibrationFactor, SIZING, type StakeMode } from "@/lib/bets/sizing";
import type { LedgerEntry, SettledLeg } from "@/lib/types";

/**
 * Where `c` and `σ_p` come from. This is the join between the ledger and the wallet: the policy
 * stops being a pair of constants the moment this file has a sample, and the first slice whose
 * measurement closes opens for real stakes on its own, with nothing in the UI changing.
 *
 * Two rules the numbers depend on:
 *   · **never in-sample** — the day being selected is excluded from its own calibration
 *     (leave-one-day-out), or the policy would be grading itself on its own answers;
 *   · **scopes never mix** — a pre-game main ticket, a pre-game alternative and a live read are
 *     three different populations, and 95 of the 172 settled pre-game legs are alternatives.
 */

export type Scope = "pregame-main" | "pregame-alt" | "live";

export interface SliceCalibration {
  key: string;
  /** Settled legs behind the number. */
  settled: number;
  /** Legs won ÷ probability predicted. Below 1 means the model was optimistic. */
  measuredRatio: number;
  /** The de-biased spread of the estimate, clamped to [0.03, 0.15]. */
  sigmaP: number;
  /**
   * The factor this layer APPLIES to the stake. For a scope or market slice it is 1: generation
   * already corrected that mean (see the note on `MEAN_IS_CORRECTED_AT_GENERATION`). For a quarter
   * slice it is the quarter's deviation from its scope, which generation cannot see.
   */
  factor: number;
  /**
   * What the ledger measures the factor to be, applied or not. This is the audit number: the admin
   * panel reads it, the `carteira` gate reads its gap, and nothing sizes a bet with it.
   */
  measuredFactor: number;
  mode: StakeMode;
  /** Predicted minus actual, in points — positive means overconfident. */
  gapPoints: number;
  /** True when the 95 % Wilson interval of the hit rate excludes the average prediction. */
  biased: boolean;
}

/** The gate that opens a slice for real stakes. All three, or the slice stays in measurement. */
export const CARTEIRA_GATE = { sigmaP: 0.08, settledLegs: 300, biasPoints: 0.03 } as const;

/**
 * Why this layer stopped correcting the mean.
 *
 * The generation layer now corrects it in code (`ledger/recalibrate.ts`): a leg's stated chance is
 * shifted in log-odds by the measured gap of its market or source slice, shrunk by n/(n+40), gated
 * at 20 settled legs and measured per scope — and the ticket's `modelledProbability` is rebuilt
 * from the corrected legs with a correlation factor on top. By the time a candidate reaches this
 * file, its probability has already been pulled down once.
 *
 * Applying the measured gap again here would correct it twice. In steady state both loops converge
 * to zero and it would not matter, but the transition is the problem: today's history is entirely
 * pre-correction, so both layers measure the same large gap and both act on it. Conservative, and
 * still wrong — the card would show a chance pulled down twice and a minimum price raised twice.
 *
 * Three ways out were on the table and two do not survive contact with the code:
 *
 *   · **Measure on `rawProbability`.** It is not a pre-correction snapshot. `enrichLeg` sets it to
 *     the model's estimate before ANCHORING, and `calibrated()` only sets it when it is absent, so
 *     the field means "pre-anchor" for an enriched leg and "pre-Platt" for one that was not.
 *     Measuring across it would mix two quantities and un-do an anchoring this layer never applied.
 *   · **Split the history by a date.** The correction is per-leg and conditional — a slice under
 *     20 settled legs earns none — so within one slate some legs are corrected and others are not.
 *     No cutoff separates the populations.
 *
 * So the layers split by what each can see, which is the honest line:
 *
 *   · generation owns the MEAN, per leg and per scope, plus the ticket's correlation factor;
 *   · this layer owns the SPREAD (σ_p, which drives the Kelly shrinkage and the gate) and the
 *     QUARTER of a live read, which generation's scope-level correction cannot see at all;
 *   · and this layer AUDITS the mean instead of re-applying it — `measuredFactor` and `gapPoints`
 *     are still measured on every slice, and the `carteira` gate still refuses to open a slice
 *     whose bias is over three points. If generation's correction stops working, the wallet stays
 *     shut. That is the check a second corrector was never able to be.
 */
export const MEAN_IS_CORRECTED_AT_GENERATION = true;

const decided = (l: SettledLeg) => l.outcome === "won" || l.outcome === "lost";
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export interface SliceQuery {
  scope: Scope;
  /** Canonical market key (stat-key.ts). */
  stat?: string;
  side?: string;
  /** The day being selected — excluded from its own calibration. */
  excludeDay?: string;
  /** Live reads only: the quarter the read was taken in. A quarter is its own population. */
  period?: number;
}

interface Row { p: number; y: number }

function rowsFor(query: SliceQuery, entries: LedgerEntry[]): Row[] {
  const out: Row[] = [];
  for (const entry of entries) {
    const scope: Scope = entry.scope === "live" ? "live" : entry.alternativeOf ? "pregame-alt" : "pregame-main";
    if (scope !== query.scope) continue;
    if (query.excludeDay && brasiliaDay(entry.settledAt ?? entry.startsAt ?? entry.createdAt) === query.excludeDay) continue;
    if (query.period !== undefined && (entry.period ?? 0) !== query.period) continue;
    for (const leg of entry.legs) {
      if (!decided(leg)) continue;
      if (query.stat && canonicalMarket(leg, entry.sportKey) !== query.stat) continue;
      if (query.side && leg.settlement?.side !== query.side) continue;
      // A probability of exactly 1 makes every scoring rule congratulate itself: clamp first.
      out.push({ p: clamp(leg.predictedProbability, 0.01, 0.99), y: leg.outcome === "won" ? 1 : 0 });
    }
  }
  return out;
}

/** Lower and upper bounds of the 95 % Wilson interval for a hit rate. */
export function wilson(won: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = won / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * The spread of the estimate: the RMSE of the calibration curve by decile, with the binomial noise
 * of each bucket removed, so a slice is not called blurry because its buckets are small. Measured
 * *after* the calibration factor is applied, because `c` already removes the average optimism and
 * what is left is the part `σ_p` is supposed to describe.
 */
export function sigmaFrom(rows: Row[], factor: number): number {
  if (rows.length < 20) return SIZING.sigmaPCeiling;
  const buckets = new Map<number, Row[]>();
  for (const r of rows) {
    const key = Math.min(9, Math.floor(clamp(r.p * factor, 0, 0.999) * 10));
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  let weighted = 0, noise = 0, n = 0;
  for (const [, group] of buckets) {
    const predicted = group.reduce((a, r) => a + clamp(r.p * factor, 0.01, 0.99), 0) / group.length;
    const actual = group.reduce((a, r) => a + r.y, 0) / group.length;
    weighted += group.length * (predicted - actual) ** 2;
    noise += actual * (1 - actual);
    n += group.length;
  }
  const debiased = Math.sqrt(Math.max(0, weighted / n - noise / n));
  return clamp(debiased, SIZING.sigmaPFloor, SIZING.sigmaPCeiling);
}

/** One slice's calibration. With no sample at all: factor 1, σ_p at the ceiling, wallet closed. */
export function sliceCalibration(query: SliceQuery, entries: LedgerEntry[] = readLedger()): SliceCalibration {
  // The period segment is only appended when there is one, so a market slice keeps the key it has
  // always had and nothing downstream has to learn a new shape to ask the same question.
  const key = [query.scope, query.stat ?? "*", query.side ?? "*", ...(query.period === undefined ? [] : [`q${query.period}`])].join(":");
  const rows = rowsFor(query, entries);
  if (!rows.length) return { key, settled: 0, measuredRatio: 1, sigmaP: SIZING.sigmaPCeiling, factor: 1, measuredFactor: 1, mode: "medicao", gapPoints: 0, biased: false };

  const predicted = rows.reduce((a, r) => a + r.p, 0);
  const won = rows.reduce((a, r) => a + r.y, 0);
  const measuredRatio = predicted > 0 ? won / predicted : 1;
  const measuredFactor = calibrationFactor(measuredRatio, rows.length);
  // σ_p is de-biased with the MEASURED factor on purpose: removing the average optimism first is
  // what leaves a spread rather than a mean error. That is a measurement, not a correction, and it
  // reaches the stake only through the shrinkage — never as a second haircut on the probability.
  const sigmaP = sigmaFrom(rows, measuredFactor);
  const average = predicted / rows.length;
  const ci = wilson(won, rows.length);
  const biased = average < ci.low || average > ci.high;
  const gapPoints = average - won / rows.length;
  const open = sigmaP <= CARTEIRA_GATE.sigmaP && rows.length >= CARTEIRA_GATE.settledLegs && Math.abs(gapPoints) < CARTEIRA_GATE.biasPoints;
  // The applied factor is 1: generation corrected this mean already. A quarter slice overrides it
  // in `livePeriodCalibration`, which is the one dimension generation has no view of.
  return { key, settled: rows.length, measuredRatio, sigmaP, factor: 1, measuredFactor, mode: open ? "carteira" : "medicao", gapPoints, biased };
}

/**
 * The most specific slice with a usable sample wins; otherwise it falls back to the one above, and
 * the last resort is the whole scope. Nothing here invents a number: the fallback of the fallback
 * is "no sample", which closes the wallet by construction.
 */
export function bestSlice(query: SliceQuery, entries: LedgerEntry[] = readLedger()): SliceCalibration {
  const ladder: SliceQuery[] = [
    query.stat && query.side ? query : null,
    query.stat ? { scope: query.scope, stat: query.stat, excludeDay: query.excludeDay } : null,
    { scope: query.scope, excludeDay: query.excludeDay },
  ].filter((q): q is SliceQuery => !!q);
  for (const step of ladder) {
    const slice = sliceCalibration(step, entries);
    if (slice.settled >= 30) return slice;
  }
  return sliceCalibration({ scope: query.scope, excludeDay: query.excludeDay }, entries);
}

export interface CalibrationSnapshot {
  pre: SliceCalibration;
  live: SliceCalibration;
  slices: SliceCalibration[];
  /** The live scope one quarter at a time, keyed by period. */
  livePeriods: Record<number, SliceCalibration>;
}

/**
 * Below this many decided legs a quarter has no verdict. Same gate the public page uses
 * (`PERIOD_MIN_LEGS` in ledger/live-calibration.ts) and the same gate the rest of the product uses:
 * nothing concludes under 20 decided.
 */
export const PERIOD_MIN_LEGS = 20;

/**
 * Why a quarter is its own population rather than a detail of the live scope.
 *
 * Measured at fair price on 22/09 (168 unique decided legs) the live scope promised 93.4 % and
 * delivered 78.0 %. Split by the quarter the read was taken in, that single number is Q2 -19.5,
 * Q3 -4.0, Q4 -21.6, and Q1 no verdict at all on 17 legs. Correcting a third-quarter read by the
 * scope average punishes the one quarter that keeps its promise, and correcting a fourth-quarter
 * read by it lets through 17 points of optimism. So the wallet asks the quarter, not the scope.
 *
 * The ruler here is `predictedProbability` — the chance the ticket was actually served with, which
 * is what `modelledProbability` is built from and therefore what the stake is computed from. The
 * public honesty page deliberately measures the other one (`computedProbability`, the props model's
 * own arithmetic) and reads 5-6 points harsher across the board. Both rulers put the quarters in
 * the same order and both leave Q1 under the gate, which is the part the policy depends on.
 */
export function livePeriodCalibration(opts: { excludeDay?: string } = {}, entries?: LedgerEntry[]): Record<number, SliceCalibration> {
  const rows = entries ?? mainTickets(readLedger(), true);
  const out: Record<number, SliceCalibration> = {};
  // The scope's own measured factor is the part generation has already taken out of every live
  // leg. What is left for a quarter is its DEVIATION from that scope — so the applied factor is the
  // ratio of the two, and a quarter that behaves exactly like its scope applies nothing (1.0).
  // Q3 lands above 1: generation pulls the whole live scope down, and Q3 did not deserve it.
  const scope = sliceCalibration({ scope: "live", excludeDay: opts.excludeDay }, rows);
  for (const period of new Set(rows.filter((e) => e.scope === "live").map((e) => e.period ?? 0))) {
    const slice = sliceCalibration({ scope: "live", period, excludeDay: opts.excludeDay }, rows);
    const relative = scope.measuredFactor > 0 ? slice.measuredFactor / scope.measuredFactor : 1;
    out[period] = { ...slice, factor: Number.isFinite(relative) && relative > 0 ? relative : 1 };
  }
  return out;
}

/** Both headline slices plus every market × side slice with a sample — what the admin panel reads. */
export function calibrationSnapshot(opts: { excludeDay?: string } = {}): CalibrationSnapshot {
  const entries = mainTickets(readLedger(), true);
  const pre = sliceCalibration({ scope: "pregame-main", excludeDay: opts.excludeDay }, entries);
  const live = sliceCalibration({ scope: "live", excludeDay: opts.excludeDay }, entries);

  const seen = new Set<string>();
  const slices: SliceCalibration[] = [];
  for (const entry of entries) {
    const scope: Scope = entry.scope === "live" ? "live" : entry.alternativeOf ? "pregame-alt" : "pregame-main";
    for (const leg of entry.legs) {
      if (!decided(leg)) continue;
      const stat = canonicalMarket(leg, entry.sportKey) ?? "unmapped";
      const side = leg.settlement?.side ?? "";
      const key = `${scope}:${stat}:${side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slices.push(sliceCalibration({ scope, stat, side: side || undefined, excludeDay: opts.excludeDay }, entries));
    }
  }
  return {
    pre, live,
    slices: slices.filter((s) => s.settled > 0).sort((a, b) => b.settled - a.settled),
    livePeriods: livePeriodCalibration({ excludeDay: opts.excludeDay }, entries),
  };
}

/** The two numbers the measurement notice on /app/hoje prints. */
export function calibrationHeadline(): { settledLegs: number; gapPoints: number } {
  try {
    const pre = sliceCalibration({ scope: "pregame-main" });
    return { settledLegs: pre.settled, gapPoints: Number((pre.gapPoints * 100).toFixed(1)) };
  } catch {
    return { settledLegs: 0, gapPoints: 0 };
  }
}
