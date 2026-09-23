import { factorsOf, scopeOf, type FactorInput } from "@/lib/ledger/factors";
import { wilson } from "@/lib/ledger/calibration-input";

/**
 * Which slices of the ledger actually disagree with the model, and which only look like they do.
 *
 * Three rules, each of which exists because breaking it produced a confident wrong answer:
 *   · **clamp first.** 147 legs carry a predicted probability of exactly 1.0; without clamping,
 *     every scoring rule congratulates the model for them.
 *   · **a minimum that is not just n.** 30 decided legs, from at least 3 games and 2 days: thirty
 *     legs off one night are one night, however many legs it had.
 *   · **correct for looking many times.** Testing thirteen dimensions at p < 0.05 finds "signal" in
 *     noise by construction, so a factor lights up only when Benjamini–Hochberg at 10 % keeps it.
 */

export type Scope = "pregame-main" | "pregame-alt" | "live";

export interface FactorStat {
  id: string;
  scope: Scope;
  dim: string;
  value: string;
  legs: number;
  won: number;
  games: number;
  days: number;
  hitRate: number;
  /** Mean predicted probability of the slice, after clamping. */
  predicted: number;
  /** Predicted minus actual: positive means the model was overconfident here. */
  gap: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  qValue: number;
  /** Wilson excludes the prediction AND the discovery correction keeps it. */
  flagged: boolean;
}

export interface FactorOptions {
  minLegs?: number;
  minGames?: number;
  minDays?: number;
  /** Benjamini–Hochberg false-discovery rate. */
  fdr?: number;
}

export const FACTOR_MINIMUM = { minLegs: 30, minGames: 3, minDays: 2, fdr: 0.1 } as const;

/** A probability of exactly 0 or 1 is a claim no model is entitled to; every score reads this first. */
export const clampProbability = (p: number): number => (Number.isFinite(p) ? Math.min(0.99, Math.max(0.01, p)) : 0.5);

/** Two-sided normal approximation of the binomial test. n ≥ 30 is enforced by the minimum above. */
export function binomialP(won: number, n: number, expected: number): number {
  if (n <= 0) return 1;
  const p = clampProbability(expected);
  const sd = Math.sqrt(n * p * (1 - p));
  if (sd <= 0) return 1;
  const z = Math.abs(won - n * p) / sd;
  // Abramowitz & Stegun 7.1.26 for the error function; plenty for a screening statistic.
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-((z / Math.SQRT2) ** 2));
  return Math.min(1, Math.max(0, 1 - erf));
}

/** Benjamini–Hochberg: the q-value of every test in one round, in the order they were ranked. */
export function benjaminiHochberg(pValues: number[], fdr: number = FACTOR_MINIMUM.fdr): number[] {
  const n = pValues.length;
  if (!n) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(n).fill(1);
  let previous = 1;
  for (let rank = n; rank >= 1; rank -= 1) {
    const { p, i } = order[rank - 1];
    previous = Math.min(previous, (p * n) / rank);
    q[i] = previous;
  }
  void fdr;
  return q;
}

interface Bucket { legs: number; won: number; predicted: number; games: Set<string>; days: Set<string> }

/**
 * The calibration of every factor with a real sample, in one pass. `rows` are decided legs only —
 * `attributionRows` produces exactly that shape.
 */
export function factorCalibration(rows: FactorInput[], opts: FactorOptions = {}): FactorStat[] {
  const min = { ...FACTOR_MINIMUM, ...opts };
  const buckets = new Map<string, Bucket & { scope: Scope; dim: string; value: string }>();

  for (const row of rows) {
    const scope = scopeOf(row);
    for (const tag of factorsOf(row)) {
      const key = `${scope}|${tag.dim}|${tag.value}`;
      const b = buckets.get(key) ?? { scope, dim: tag.dim, value: tag.value, legs: 0, won: 0, predicted: 0, games: new Set<string>(), days: new Set<string>() };
      b.legs += 1;
      if (row.outcome === "won") b.won += 1;
      b.predicted += clampProbability(row.predicted);
      b.games.add(row.gameId);
      b.days.add(row.day);
      buckets.set(key, b);
    }
  }

  const eligible = [...buckets.entries()]
    .filter(([, b]) => b.legs >= min.minLegs && b.games.size >= min.minGames && b.days.size >= min.minDays)
    .map(([id, b]) => {
      const predicted = b.predicted / b.legs;
      const hitRate = b.won / b.legs;
      const ci = wilson(b.won, b.legs);
      return {
        id, scope: b.scope, dim: b.dim, value: b.value,
        legs: b.legs, won: b.won, games: b.games.size, days: b.days.size,
        hitRate, predicted, gap: predicted - hitRate,
        ciLow: ci.low, ciHigh: ci.high,
        pValue: binomialP(b.won, b.legs, predicted),
        qValue: 1, flagged: false,
      } satisfies FactorStat;
    });

  const q = benjaminiHochberg(eligible.map((s) => s.pValue), min.fdr);
  return eligible
    .map((s, i) => ({ ...s, qValue: q[i], flagged: (s.predicted < s.ciLow || s.predicted > s.ciHigh) && q[i] <= min.fdr }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/** The lit factors as prompt text. Silent when nothing is lit — a quiet round says nothing. */
export function factorPromptLines(stats: FactorStat[], limit = 6): string {
  const lit = stats.filter((s) => s.flagged && s.scope === "pregame-main").slice(0, limit);
  if (!lit.length) return "";
  return [
    "MEASURED FACTORS (pre-game main tickets only; each survived Benjamini-Hochberg at 10%):",
    ...lit.map((s) => `- [${s.id}] ${s.dim} = ${s.value}: ${s.won}/${s.legs} (${(s.hitRate * 100).toFixed(0)}%) against ${(s.predicted * 100).toFixed(0)}% predicted — ${s.gap > 0 ? `OVERCONFIDENT by ${(s.gap * 100).toFixed(0)}pts` : `underconfident by ${(-s.gap * 100).toFixed(0)}pts`}, CI95 [${(s.ciLow * 100).toFixed(0)}; ${(s.ciHigh * 100).toFixed(0)}], q=${s.qValue.toFixed(3)}`),
  ].join("\n");
}
