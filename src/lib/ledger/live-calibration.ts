import { brasiliaDay } from "@/lib/ledger/day";
import type { LedgerEntry } from "@/lib/types";

/**
 * How well a read kept its own promise, and nothing else.
 *
 * A live read is priced off the pre-game board, which by the third quarter no book is still
 * offering, so any return computed from it is a number nobody could have collected — the ledger of
 * 22/09/2026 pays the average live leg 1.87 for a chance of 93.4%, whose fair price is 1.08, and
 * the day's whole "profit" is that gap. This module replaces that number with the one question the
 * data can actually answer: the read said X% would land, how much landed.
 *
 * The measure is expected wins against observed wins, on the LEG, with an exact Poisson-binomial
 * band. It beats a plain hit rate because it carries the ruler beside the result; it beats the
 * fair-price return because it is additive and has no tail (one leg at 3% pays 33 units and moves
 * everything); and it beats a bucket table because it fits in one line. It is a defect detector,
 * not a score: the first number it produced on the real ledger is z = -8.55.
 *
 * Its own blind spot — a model marking its homework — is covered by the Brier skill score against
 * the sample's base rate, published beside it. A model that stamps 93% on everything scores well in
 * the buckets and zero here; today the live reads score BELOW zero, which is to say the computed
 * chances are worse than stamping the average.
 *
 * Nothing here is money, and none of it should ever be printed as such.
 */

export interface CalibrationBucket {
  /** Half-open [from, to) in probability, except the last bucket, which includes 1. */
  from: number;
  to: number;
  n: number;
  /** The average chance we gave inside the bucket. */
  predicted: number;
  /** The share that actually landed. */
  observed: number;
  /** Wilson 95% bounds on `observed`. */
  lo: number;
  hi: number;
  /** observed − predicted, as a share (multiply by 100 for points). */
  gap: number;
}

export interface CalibrationSlice {
  key: string;
  label: string;
  n: number;
  won: number;
  hitRate: number;
  /** The average chance we gave in this slice. */
  predictedAverage: number;
  expectedWins: number;
  /** observed − expected, in percentage points. Negative: we promised more than we delivered. */
  gapPoints: number;
  /**
   * (observed − expected) over the model's own standard deviation. Not finite when the model left
   * itself no variance at all — it called every leg in the slice a certainty, and some lost.
   */
  z: number;
  /** 95% band on the number of wins under the model's own chances (exact Poisson-binomial). */
  lo: number;
  hi: number;
  brier: number;
  /** The Brier score of stamping this slice's own base rate on every row. */
  brierBaseline: number;
  /** 1 − brier/baseline. Zero means the chances are worth exactly as much as the average. */
  skill: number;
  /** Diagnostic, never money: (1/p − 1) on a win and −1 on a loss, averaged per unit. */
  fairUnits: number;
  verdict: "abaixo" | "dentro" | "acima";
}

export interface LiveCalibration {
  /** The headline unit: one selection of one read. */
  legs: CalibrationSlice;
  /** Main tickets only — the alternatives share legs with them and are not a second sample. */
  tickets: CalibrationSlice;
  buckets: CalibrationBucket[];
  byPeriod: CalibrationSlice[];
  byOddsBand: CalibrationSlice[];
  coverage: { legsDecided: number; withComputed: number; voided: number; games: number };
  publishable: boolean;
}

/**
 * Below this many decided legs the page explains the method and shows counts, no percentages —
 * the same bar `proofMinDecided` sets for the money. LIVE_CALIBRATION_MIN_LEGS overrides it.
 */
export const LIVE_CALIBRATION_MIN_LEGS = 100;
/** A quarter needs its own sample before it gets its own line. LIVE_PERIOD_MIN_LEGS overrides it. */
export const PERIOD_MIN_LEGS = 20;

const gate = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};
export const liveCalibrationMinLegs = (env: Record<string, string | undefined> = process.env): number =>
  gate(env.LIVE_CALIBRATION_MIN_LEGS, LIVE_CALIBRATION_MIN_LEGS);
export const periodMinLegs = (env: Record<string, string | undefined> = process.env): number =>
  gate(env.LIVE_PERIOD_MIN_LEGS, PERIOD_MIN_LEGS);

export interface CalibrationRowInput { p: number; won: boolean }

/**
 * The exact distribution of the number of wins under independent chances `ps` — the
 * Poisson-binomial, by the O(n²) convolution. Exact and deterministic on purpose: a simulated band
 * would move between runs and could not be pinned by a test.
 */
export function poissonBinomial(ps: number[]): number[] {
  let dist = [1];
  for (const p of ps) {
    const q = Math.min(1, Math.max(0, p));
    const next = new Array<number>(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k += 1) {
      next[k] += dist[k] * (1 - q);
      next[k + 1] += dist[k] * q;
    }
    dist = next;
  }
  return dist;
}

/** Expected wins and the equal-tailed `conf` band on them, both exact. */
export function expectedWinsInterval(ps: number[], conf = 0.95): { expected: number; lo: number; hi: number } {
  const expected = ps.reduce((a, p) => a + p, 0);
  if (!ps.length) return { expected: 0, lo: 0, hi: 0 };
  const dist = poissonBinomial(ps);
  const tail = (1 - conf) / 2;
  let lo = 0;
  for (let k = 0, c = 0; k < dist.length; k += 1) {
    c += dist[k];
    if (c >= tail) { lo = k; break; }
  }
  let hi = dist.length - 1;
  for (let k = dist.length - 1, c = 0; k >= 0; k -= 1) {
    c += dist[k];
    if (c >= tail) { hi = k; break; }
  }
  return { expected, lo, hi };
}

/** Wilson score bounds on k of n — the interval that behaves at 0, at 1 and at small n. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * Brier score, the Brier score of stamping the sample's own base rate on everything, and the skill
 * of the first over the second. Without this line a model that says 93% to everything looks
 * competent in a bucket table; with it, it scores zero.
 */
export function brierSkill(rows: CalibrationRowInput[]): { brier: number; baseline: number; skill: number } {
  if (!rows.length) return { brier: 0, baseline: 0, skill: 0 };
  const y = (r: CalibrationRowInput) => (r.won ? 1 : 0);
  const base = rows.reduce((a, r) => a + y(r), 0) / rows.length;
  const brier = rows.reduce((a, r) => a + (r.p - y(r)) ** 2, 0) / rows.length;
  const baseline = rows.reduce((a, r) => a + (base - y(r)) ** 2, 0) / rows.length;
  return { brier, baseline, skill: baseline > 0 ? 1 - brier / baseline : 0 };
}

export const DEFAULT_BUCKET_EDGES = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1];

/** "When we said X%, Y% happened" — the table that shows where the overstatement lives. */
export function calibrationBuckets(rows: CalibrationRowInput[], edges: number[] = DEFAULT_BUCKET_EDGES): CalibrationBucket[] {
  const out: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const from = edges[i];
    const to = edges[i + 1];
    const last = i === edges.length - 2;
    const inside = rows.filter((r) => r.p >= from && (last ? r.p <= to : r.p < to));
    if (!inside.length) continue;
    const won = inside.filter((r) => r.won).length;
    const predicted = inside.reduce((a, r) => a + r.p, 0) / inside.length;
    const observed = won / inside.length;
    const { lo, hi } = wilson(won, inside.length);
    out.push({ from, to, n: inside.length, predicted, observed, lo, hi, gap: observed - predicted });
  }
  return out;
}

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * The published band on the gap, by resampling WHOLE GAMES. The Poisson-binomial band assumes the
 * rows are independent, and they are not: 226 of the 353 tickets in the ledger are alternatives
 * that share legs, and every ticket of one game shares the game. Four games is the real sample of a
 * four-game night, not forty-eight tickets, and a band that forgets that is far too narrow.
 */
export function bootstrapGap(
  rows: { gameId: string; p: number; won: boolean }[],
  draws = 2000,
  seed = 1,
): { lo: number; hi: number } {
  if (!rows.length) return { lo: 0, hi: 0 };
  const byGame = new Map<string, CalibrationRowInput[]>();
  for (const r of rows) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), { p: r.p, won: r.won }]);
  const games = [...byGame.values()];
  const rand = mulberry32(seed);
  const gaps: number[] = [];
  for (let d = 0; d < draws; d += 1) {
    let n = 0;
    let sum = 0;
    for (let g = 0; g < games.length; g += 1) {
      for (const r of games[Math.floor(rand() * games.length)]) {
        n += 1;
        sum += (r.won ? 1 : 0) - r.p;
      }
    }
    gaps.push(n ? (sum / n) * 100 : 0);
  }
  gaps.sort((a, b) => a - b);
  const at = (q: number) => gaps[Math.min(gaps.length - 1, Math.max(0, Math.floor(q * gaps.length)))];
  return { lo: at(0.025), hi: at(0.975) };
}

const EMPTY_SLICE = (key: string, label: string): CalibrationSlice => ({
  key, label, n: 0, won: 0, hitRate: 0, predictedAverage: 0, expectedWins: 0, gapPoints: 0, z: 0,
  lo: 0, hi: 0, brier: 0, brierBaseline: 0, skill: 0, fairUnits: 0, verdict: "dentro",
});

export function calibrationSlice(key: string, label: string, rows: CalibrationRowInput[]): CalibrationSlice {
  if (!rows.length) return EMPTY_SLICE(key, label);
  const n = rows.length;
  const won = rows.filter((r) => r.won).length;
  const ps = rows.map((r) => r.p);
  const { expected, lo, hi } = expectedWinsInterval(ps);
  const variance = ps.reduce((a, p) => a + p * (1 - p), 0);
  // A model that left itself no variance and still lost has no z: it called the impossible.
  const z = variance > 0 ? (won - expected) / Math.sqrt(variance) : won === expected ? 0 : (won > expected ? Infinity : -Infinity);
  const { brier, baseline, skill } = brierSkill(rows);
  const fairUnits = rows.reduce((a, r) => a + (r.won ? 1 / Math.max(r.p, 1e-9) - 1 : -1), 0) / n;
  return {
    key, label, n, won, hitRate: won / n,
    predictedAverage: expected / n,
    expectedWins: expected,
    gapPoints: ((won - expected) / n) * 100,
    z, lo, hi,
    brier, brierBaseline: baseline, skill, fairUnits,
    verdict: won < lo ? "abaixo" : won > hi ? "acima" : "dentro",
  };
}

const decided = (o: string) => o === "won" || o === "lost";

/**
 * A ticket re-priced over the legs that were actually graded. A voided leg never had a chance of
 * anything, so leaving its probability inside the ticket's price inflates what we said we expected
 * and makes the model look worse than it was — 25 tickets in the ledger lost with a voided leg
 * still priced in. Dividing it back out is exact because `modelledProbability` is the product of
 * the leg probabilities times `correlationFactor`. Null when nothing survived.
 */
export function ticketProbabilityExVoid(e: LedgerEntry): number | null {
  const alive = e.legs.filter((l) => l.outcome !== "void");
  if (!e.legs.length) return Number.isFinite(e.modelledProbability) ? e.modelledProbability : null;
  if (!alive.length) return null;
  let p = e.modelledProbability;
  for (const l of e.legs) {
    if (l.outcome !== "void") continue;
    const q = l.predictedProbability;
    if (!Number.isFinite(q) || q <= 0) return null;
    p /= q;
  }
  if (!Number.isFinite(p) || p <= 0) return null;
  return Math.min(1, p);
}

/** The band a ticket's combined price falls in, the way /prova already slices the record. */
export function oddsBand(decimal: number): { key: string; label: string } {
  if (decimal < 2) return { key: "1.00-1.99", label: "1,00–1,99" };
  if (decimal < 3) return { key: "2.00-2.99", label: "2,00–2,99" };
  if (decimal < 5) return { key: "3.00-4.99", label: "3,00–4,99" };
  if (decimal < 10) return { key: "5.00-9.99", label: "5,00–9,99" };
  if (decimal < 25) return { key: "10.0-24.9", label: "10,0–24,9" };
  return { key: "25+", label: "25+" };
}

export const periodLabel = (p: number): string => (p <= 0 ? "sem quarto" : p <= 4 ? `${p}º quarto` : "prorrogação");

/**
 * The legs of a set of reads, deduplicated. The same selection appears in several tickets of one
 * read — the alternatives are built from the same shortlist — and counting it once per ticket would
 * multiply one call into five. The key is the game, the selection and the minute of the read: the
 * same line at minute 20 and at minute 35 is two different calls on two different remainders.
 */
export function uniqueLegs(entries: LedgerEntry[]): {
  rows: { gameId: string; p: number; won: boolean; period: number }[];
  legsDecided: number;
  voided: number;
} {
  const seen = new Set<string>();
  const rows: { gameId: string; p: number; won: boolean; period: number }[] = [];
  const voided = new Set<string>();
  for (const e of entries) {
    for (const l of e.legs) {
      const key = `${e.gameId}|${l.selection}|${e.minute ?? ""}`;
      if (l.outcome === "void") { voided.add(key); continue; }
      if (!decided(l.outcome) || seen.has(key)) continue;
      seen.add(key);
      // A leg with no computed chance still counts as decided; it is reported in `coverage` and
      // left out of the arithmetic. Never substituted by predictedProbability: that is the language
      // model's number, and mixing the two rulers destroys the reading.
      if (l.computedProbability === undefined || !Number.isFinite(l.computedProbability)) continue;
      rows.push({ gameId: e.gameId, p: l.computedProbability, won: l.outcome === "won", period: e.period ?? 0 });
    }
  }
  return { rows, legsDecided: seen.size, voided: voided.size };
}

/** The decided main tickets of a set of entries, re-priced over their surviving legs. */
export function ticketRows(entries: LedgerEntry[]): { gameId: string; p: number; won: boolean; decimal: number; period: number }[] {
  const out: { gameId: string; p: number; won: boolean; decimal: number; period: number }[] = [];
  for (const e of entries) {
    if (e.alternativeOf || !decided(e.outcome)) continue;
    const p = ticketProbabilityExVoid(e);
    if (p === null || !(p > 0)) continue;
    out.push({ gameId: e.gameId, p, won: e.outcome === "won", decimal: e.combinedDecimal, period: e.period ?? 0 });
  }
  return out;
}

/**
 * The whole reading for one scope, optionally for one Brasília day. Legs carry the headline;
 * tickets are main tickets only and re-priced over their surviving legs.
 */
export function liveCalibration(
  entries: LedgerEntry[],
  opts: { day?: string; scope?: "live" | "pregame"; minLegs?: number } = {},
): LiveCalibration {
  const scope = opts.scope ?? "live";
  const inScope = entries.filter((e) => (scope === "live" ? e.scope === "live" : e.scope !== "live"));
  const rows = opts.day ? inScope.filter((e) => brasiliaDay(e.startsAt ?? e.createdAt) === opts.day) : inScope;
  const { rows: legRows, legsDecided, voided } = uniqueLegs(rows);

  const tickets = ticketRows(rows);

  const byPeriod = [...new Set(legRows.map((r) => r.period))].sort((a, b) => a - b)
    .map((p) => ({ period: p, rows: legRows.filter((r) => r.period === p) }))
    .filter((g) => g.rows.length >= periodMinLegs())
    .map((g) => calibrationSlice(`q${g.period}`, periodLabel(g.period), g.rows));

  const bands = ["1.00-1.99", "2.00-2.99", "3.00-4.99", "5.00-9.99", "10.0-24.9", "25+"];
  const byOddsBand = bands
    .map((key) => ({ key, rows: tickets.filter((r) => oddsBand(r.decimal).key === key) }))
    .filter((g) => g.rows.length > 0)
    .map((g) => calibrationSlice(g.key, oddsBand(g.rows[0].decimal).label, g.rows));

  return {
    legs: calibrationSlice("legs", "linhas", legRows),
    tickets: calibrationSlice("tickets", "leituras", tickets),
    buckets: calibrationBuckets(legRows),
    byPeriod,
    byOddsBand,
    // The real sample of a four-game night is four games, not forty-eight tickets: only the games
    // that actually put a measured leg in the count are named.
    coverage: { legsDecided, withComputed: legRows.length, voided, games: new Set((legRows.length ? legRows : tickets).map((r) => r.gameId)).size },
    publishable: legRows.length >= (opts.minLegs ?? liveCalibrationMinLegs()),
  };
}
