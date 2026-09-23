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
  /** The empirical-Bayes calibration factor the stake is computed with. */
  factor: number;
  mode: StakeMode;
  /** Predicted minus actual, in points — positive means overconfident. */
  gapPoints: number;
  /** True when the 95 % Wilson interval of the hit rate excludes the average prediction. */
  biased: boolean;
}

/** The gate that opens a slice for real stakes. All three, or the slice stays in measurement. */
export const CARTEIRA_GATE = { sigmaP: 0.08, settledLegs: 300, biasPoints: 0.03 } as const;

const decided = (l: SettledLeg) => l.outcome === "won" || l.outcome === "lost";
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export interface SliceQuery {
  scope: Scope;
  /** Canonical market key (stat-key.ts). */
  stat?: string;
  side?: string;
  /** The day being selected — excluded from its own calibration. */
  excludeDay?: string;
}

interface Row { p: number; y: number }

function rowsFor(query: SliceQuery, entries: LedgerEntry[]): Row[] {
  const out: Row[] = [];
  for (const entry of entries) {
    const scope: Scope = entry.scope === "live" ? "live" : entry.alternativeOf ? "pregame-alt" : "pregame-main";
    if (scope !== query.scope) continue;
    if (query.excludeDay && brasiliaDay(entry.settledAt ?? entry.startsAt ?? entry.createdAt) === query.excludeDay) continue;
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
  const key = [query.scope, query.stat ?? "*", query.side ?? "*"].join(":");
  const rows = rowsFor(query, entries);
  if (!rows.length) return { key, settled: 0, measuredRatio: 1, sigmaP: SIZING.sigmaPCeiling, factor: 1, mode: "medicao", gapPoints: 0, biased: false };

  const predicted = rows.reduce((a, r) => a + r.p, 0);
  const won = rows.reduce((a, r) => a + r.y, 0);
  const measuredRatio = predicted > 0 ? won / predicted : 1;
  const factor = calibrationFactor(measuredRatio, rows.length);
  const sigmaP = sigmaFrom(rows, factor);
  const average = predicted / rows.length;
  const ci = wilson(won, rows.length);
  const biased = average < ci.low || average > ci.high;
  const gapPoints = average - won / rows.length;
  const open = sigmaP <= CARTEIRA_GATE.sigmaP && rows.length >= CARTEIRA_GATE.settledLegs && Math.abs(gapPoints) < CARTEIRA_GATE.biasPoints;
  return { key, settled: rows.length, measuredRatio, sigmaP, factor, mode: open ? "carteira" : "medicao", gapPoints, biased };
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
  return { pre, live, slices: slices.filter((s) => s.settled > 0).sort((a, b) => b.settled - a.settled) };
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
