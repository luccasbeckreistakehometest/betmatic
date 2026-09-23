/**
 * How much to put on one ticket, in units of bankroll. Pure arithmetic: no I/O, no React, no clock.
 *
 * The separation this file exists to protect: **code sizes the bet, the model never does**. The
 * generation prompt is forbidden from mentioning stake, unit or bankroll (prompt-defaults.ts, and
 * `prompt-has-no-stake.test.ts` proves it); everything about "how much" lives here.
 *
 * The chain, per ticket:
 *
 *   p_cal = clamp(p_model · c^legs, 0.005, 0.995)   calibration measured on the ledger, per slice
 *   e     = p_cal · d − 1                            edge against the posted price
 *   k(d)  = σ_true² / (σ_true² + (d·σ_p)²)           shrinkage: the longer the price, the more an
 *                                                    error in p costs, so the less we trust it
 *   ê     = k(d) · e
 *   f     = 0.25 · ê / (d − 1)                       quarter Kelly on the shrunk edge
 *   u     = 100 · f                                  1 u = 1 % of bankroll
 *
 * then the ceiling (2 u), the step (0.25 u) and the floor (0.25 u, below which the ticket is not a
 * bet but noise). `kellyFraction` in src/lib/odds.ts keeps its signature and its caller on the game
 * page: this module is the wallet's arithmetic, that one is the ticket's reference number.
 */

/**
 * Stamped on every ticket as it is written, so "did the policy change help?" is answerable later.
 * Bump it whenever a constant below changes: a ticket sized under the old numbers and one sized
 * under the new ones are not the same experiment, and averaging them hides exactly what was learned.
 */
export const POLICY_VERSION = "selecao-1";

/** Every constant of the policy in one object, so a change to any of them is one reviewable diff. */
export const SIZING = {
  /** 1 u = 1 % of the declared bankroll. */
  unitPct: 0.01,
  kellyFraction: 0.25,
  /** The spread of a *well-estimated* probability — the numerator of the shrinkage. */
  sigmaTrue: 0.03,
  /** σ_p is measured per slice and clamped: never sharper than 0.03, never blinder than 0.15. */
  sigmaPFloor: 0.03,
  sigmaPCeiling: 0.15,
  /** Empirical-Bayes prior on the calibration factor, in settled legs. */
  priorLegs: 200,

  stepU: 0.25,
  minU: 0.25,
  maxU: 2,
  dayCapU: 5,
  gameCapU: 3,
  playerCapU: 2,

  /** Measurement regime: one floor-sized bet, a hard weekly budget, nothing else. */
  medicaoU: 0.25,
  medicaoDayCapU: 1,
  medicaoWeekCapU: 3,

  /** Cuts on the raw model edge (p_model · d − 1), before calibration. */
  minEdgeGross: 0.04,
  maxEdgeGross: 0.2,
  /** Cut on the calibrated, shrunk edge — the wallet's gate. */
  minEdgeShrunk: 0.02,
  /** In play the book's margin is wider, so the bar is higher and the card is short-lived. */
  minEdgeGrossLive: 0.08,
  liveValidityMs: 90_000,

  maxOdds: 5,
  minOdds: 1.3,
  maxLegs: 2,
  maxPerDay: 3,
  maxPerGame: 1,
  maxPerPlayer: 2,
  liveMaxPerNight: 2,
} as const;

/**
 * `carteira` sizes with the formula; `medicao` pays the floor to buy the sample that would let it;
 * `fechado` is the honest answer when nothing has a calibrated edge at all.
 */
export type StakeMode = "carteira" | "medicao" | "fechado";

/** Why a ticket got no units. Not a failure — "esse não" is the most valuable answer this has. */
export type StakeReason = null | "invalid" | "no_edge" | "below_floor";

export type CapKind = "none" | "ticket" | "game" | "day";

export interface StakeInput {
  decimal: number;
  /** The generator's probability for the whole ticket, correlation already applied by the builder. */
  modelProbability: number;
  legs?: number;
  /** Calibration factor of this slice (1 = untouched). */
  c?: number;
  sigmaP?: number;
  sigmaTrue?: number;
  mode?: StakeMode;
  /** Ceiling for this one ticket; defaults to SIZING.maxU. */
  maxU?: number;
}

export interface StakeResult {
  units: number;
  calibratedProbability: number;
  /** p_model · d − 1: the edge before calibration, which is what the entry cuts read. */
  grossEdge: number;
  /** k(d) · (p_cal · d − 1): the edge the stake is actually sized on. */
  shrunkEdge: number;
  k: number;
  capped: CapKind;
  reason: StakeReason;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const finite = (x: number) => Number.isFinite(x);

/**
 * The calibration factor of a slice: measured ratio (legs won ÷ probability predicted) pulled
 * towards 1 with a prior of `SIZING.priorLegs` legs. 172 legs at 0.794 give 0.905, not 0.794 —
 * a ratio measured on one week does not deserve full force, and the estimate walks to the measured
 * number on its own as the ledger grows.
 */
export function calibrationFactor(measuredRatio: number, settledLegs: number, priorLegs = SIZING.priorLegs): number {
  if (!finite(measuredRatio) || measuredRatio <= 0 || !finite(settledLegs) || settledLegs <= 0) return 1;
  return (settledLegs * measuredRatio + priorLegs) / (settledLegs + priorLegs);
}

/**
 * How much of the measured edge survives the uncertainty in the estimate. The odds sit inside the
 * square: at σ_p = 0.03 a 2.0x keeps 20 % of its edge and a 20x keeps 0.3 %. This, not a hand-written
 * ladder, is why long prices get nothing.
 */
export function shrinkFactor(decimal: number, sigmaP: number, sigmaTrue: number = SIZING.sigmaTrue): number {
  if (!finite(decimal) || decimal <= 1 || !finite(sigmaP) || sigmaP <= 0) return 0;
  const noise = decimal * sigmaP;
  return sigmaTrue ** 2 / (sigmaTrue ** 2 + noise ** 2);
}

/** The model's number after the slice's calibration; `c^legs` because the error compounds per leg. */
export function calibratedProbability(modelProb: number, legs: number, c: number): number {
  if (!finite(modelProb) || modelProb <= 0) return NaN;
  const n = finite(legs) && legs >= 1 ? Math.floor(legs) : 1;
  const factor = finite(c) && c > 0 ? c : 1;
  return clamp(modelProb * factor ** n, 0.005, 0.995);
}

/** Edge against the posted price, per unit staked. Negative means the price is better than us. */
export function grossEdge(decimal: number, prob: number): number {
  if (!finite(decimal) || decimal <= 1 || !finite(prob) || prob <= 0) return NaN;
  return prob * decimal - 1;
}

export function shrunkEdge(decimal: number, prob: number, sigmaP: number, sigmaTrue: number = SIZING.sigmaTrue): number {
  const e = grossEdge(decimal, prob);
  if (!finite(e)) return NaN;
  return shrinkFactor(decimal, sigmaP, sigmaTrue) * e;
}

/**
 * The ranking number: expected log growth, which is exactly what Kelly maximises. Penalises a long
 * price by construction (the `d − 1` denominator) and a weak estimate twice (the square).
 *
 * Never rank by EV%: on the real ledger "top 3 a day by EV" went 0 for 6, the worst of every policy
 * tried, because EV% ranks by estimation error multiplied by the odds.
 */
export function growthScore(decimal: number, shrunk: number): number {
  if (!finite(decimal) || decimal <= 1 || !finite(shrunk) || shrunk <= 0) return 0;
  return (shrunk * shrunk) / (decimal - 1);
}

/**
 * Quantises to the 0.25 u step **downwards**, and drops anything under the floor to zero.
 *
 * Downwards on purpose: rounding a stake up is betting above Kelly, which is the one side of the
 * error that is asymmetrically bad — above full Kelly the expected growth turns negative, below it
 * you only grow slower. 0.38 u becomes 0.25 u, never 0.50 u.
 */
export function roundUnits(u: number, step: number = SIZING.stepU, floor: number = SIZING.minU): number {
  if (!finite(u) || u <= 0) return 0;
  const stepped = Math.floor(u / step + 1e-9) * step;
  const rounded = Math.round(stepped / step) * step;
  return rounded >= floor - 1e-9 ? Number(rounded.toFixed(2)) : 0;
}

/** The worst price this ticket is still worth taking: `(1 + minimum edge) / chance`. */
export function minAcceptableDecimal(prob: number, minEdge: number): number {
  if (!finite(prob) || prob <= 0 || prob > 1 || !finite(minEdge)) return NaN;
  return (1 + minEdge) / prob;
}

/** The whole chain for one ticket. `mode: "medicao"` pays the floor and ignores the formula's size. */
export function stakeUnits(input: StakeInput): StakeResult {
  const { decimal, modelProbability } = input;
  const legs = input.legs ?? 1;
  const c = input.c ?? 1;
  const sigmaP = clamp(input.sigmaP ?? SIZING.sigmaPFloor, SIZING.sigmaPFloor, SIZING.sigmaPCeiling);
  const sigmaTrue = input.sigmaTrue ?? SIZING.sigmaTrue;
  const maxU = input.maxU ?? SIZING.maxU;
  const mode = input.mode ?? "carteira";

  const blank: StakeResult = { units: 0, calibratedProbability: NaN, grossEdge: NaN, shrunkEdge: NaN, k: 0, capped: "none", reason: "invalid" };
  if (!finite(decimal) || decimal <= 1 || !finite(modelProbability) || modelProbability <= 0 || modelProbability >= 1) return blank;

  const pCal = calibratedProbability(modelProbability, legs, c);
  const raw = grossEdge(decimal, modelProbability);
  const calEdge = grossEdge(decimal, pCal);
  const k = shrinkFactor(decimal, sigmaP, sigmaTrue);
  const shrunk = k * calEdge;
  const base = { calibratedProbability: pCal, grossEdge: raw, shrunkEdge: shrunk, k };

  if (mode === "fechado") return { ...base, units: 0, capped: "none", reason: "no_edge" };
  /*
   * The measurement regime does not size — it pays the floor to buy the ~400 settled legs per slice
   * that would let it. It reads the RAW edge, not the calibrated one: with the calibration the
   * ledger measures today (c = 0.905) the calibrated edge is negative on almost every ticket, which
   * is exactly the thing being measured. Gating the measurement on its own unmeasured conclusion
   * would mean never buying the sample. Cost of being wrong: 0.25 u a bet, 1 u a day, 3 u a week.
   */
  if (mode === "medicao") return raw > 0
    ? { ...base, units: SIZING.medicaoU, capped: "none", reason: null }
    : { ...base, units: 0, capped: "none", reason: "no_edge" };
  if (!(calEdge > 0)) return { ...base, units: 0, capped: "none", reason: "no_edge" };

  const fraction = SIZING.kellyFraction * (shrunk / (decimal - 1));
  const uncapped = fraction / SIZING.unitPct;
  const ceilinged = Math.min(uncapped, maxU);
  const units = roundUnits(ceilinged);
  if (units <= 0) return { ...base, units: 0, capped: "none", reason: "below_floor" };
  return { ...base, units, capped: uncapped > maxU + 1e-9 ? "ticket" : "none", reason: null };
}

export interface Caps {
  dayCapU?: number;
  gameCapU?: number;
  /** Per-player ceiling across the day; a row with no player is never capped by it. */
  playerCapU?: number;
}

/** What `applyCaps` needs to know about a row. Anything else on the object is carried through. */
export interface CapRow {
  gameId: string;
  players?: string[];
  units: number;
  capped: CapKind;
}

/** Proportional trim of a set of indices down to its ceiling; the floor still applies after it. */
function trim(units: number[], idx: number[], cap: number): { units: number[]; hit: boolean } {
  const total = idx.reduce((a, i) => a + units[i], 0);
  if (!(total > cap + 1e-9)) return { units, hit: false };
  const factor = cap / total;
  const next = [...units];
  for (const i of idx) next[i] = roundUnits(next[i] * factor);
  return { units: next, hit: true };
}

/**
 * Game ceiling first, then each player's, then the day's. Two tickets on the same game are one bet
 * with two faces, so that ceiling has to bind before the day's is even measured.
 *
 * This is not multivariate Kelly and does not pretend to be: proportional trimming errs low, and low
 * is the right side to err on. The joint optimiser scales as 2^N and is not the bottleneck here.
 */
export function applyCaps<T extends CapRow>(rows: T[], caps: Caps = {}): T[] {
  const gameCap = caps.gameCapU ?? SIZING.gameCapU;
  const dayCap = caps.dayCapU ?? SIZING.dayCapU;
  const playerCap = caps.playerCapU ?? SIZING.playerCapU;

  let units = rows.map((r) => r.units);
  const capped = rows.map((r) => r.capped);

  const group = (keyOf: (r: T) => string[]) => {
    const m = new Map<string, number[]>();
    rows.forEach((r, i) => { for (const k of keyOf(r)) m.set(k, [...(m.get(k) ?? []), i]); });
    return [...m.values()];
  };

  for (const idx of group((r) => [r.gameId])) {
    const out = trim(units, idx, gameCap);
    units = out.units;
    if (out.hit) for (const i of idx) if (capped[i] !== "ticket") capped[i] = "game";
  }
  for (const idx of group((r) => r.players ?? [])) {
    const out = trim(units, idx, playerCap);
    units = out.units;
    if (out.hit) for (const i of idx) if (capped[i] !== "ticket") capped[i] = "game";
  }
  const day = trim(units, rows.map((_, i) => i), dayCap);
  units = day.units;
  if (day.hit) rows.forEach((_, i) => { if (capped[i] !== "ticket") capped[i] = "day"; });

  return rows.map((r, i) => ({ ...r, units: units[i], capped: capped[i] }));
}

/** The measurement regime's own ceilings: a floor-sized bet, at most 1 u a day and 3 u a week. */
export function medicaoCaps(alreadyThisWeek = 0): Caps {
  return { dayCapU: Math.max(0, Math.min(SIZING.medicaoDayCapU, SIZING.medicaoWeekCapU - alreadyThisWeek)), gameCapU: SIZING.medicaoDayCapU, playerCapU: SIZING.medicaoDayCapU };
}

/** Units → money, floored to R$ 0.50: the same reason `roundUnits` floors. */
export function unitsToMoney(units: number, bankroll: number): number {
  if (!finite(units) || !finite(bankroll) || bankroll <= 0) return NaN;
  return Math.floor((units * SIZING.unitPct * bankroll) / 0.5) * 0.5;
}
