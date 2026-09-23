import { resolveStatLabels, statTotal } from "@/lib/props/history";
import type { PlayerHistory } from "@/lib/types";

/**
 * The per-leg probability model for basketball counting stats (points, rebounds, assists, threes,
 * steals, blocks, turnovers and every sum of them the vocabulary allows).
 *
 * A counting stat is production per minute times minutes on the floor, and the two fail in
 * different ways: the rate is the player's own night, the minutes are the game's script. So the
 * model is built in those two parts. From the game log it fits a per-minute rate and how much that
 * rate wanders from game to game; the minutes come from props/minutes.ts, with their own spread.
 * Tonight's total is then a negative binomial with the projected minutes as exposure — a Poisson
 * count whose rate is drawn from a gamma with the fitted dispersion — mixed over the minutes
 * distribution. P(over line) and P(under line) come from its tail, for the posted line and for the
 * ladder rungs beside it; props/candidates.ts blends every rung with the season hit rate at that
 * rung, so the number printed as COMPUTED and the ladder beside it are one scale.
 *
 * In play the same distribution prices the REMAINDER: what is on the board plus the pre-game rate
 * over the minutes left (props/minutes.ts projects them from the clock, the fouls and the
 * scoreboard), with the minutes mixture capped at the clock. Tonight's rate is printed for the
 * record and not used — see `liveRate` for the measurement behind that.
 *
 * Why parametric rather than a bootstrap of the game log — one run, scripts/research/walkforward-props.mts
 * on the 51 WNBA 2026 game logs fetched 22/09/2026 (43 players with 15+ games, 1,043 player-games,
 * 50,064 line predictions at six rungs around each player's median over eight markets), log loss:
 * season hit rate 0.5104, this model with PROJECTED minutes 0.4972, the same model with the game's
 * ACTUAL minutes 0.4255, a minutes-adjusted empirical rate 0.5290, and the production number — 70%
 * model + 30% season hit rate — 0.4956, the best of the variants and calibrated within three points
 * in every decile, so that blend is what COMPUTED carries. The rest of the argument:
 *  - a game in the log is one draw of the whole night, so re-scaling those draws to tonight's
 *    minutes and adding fresh count noise double-counts the noise, while using them unchanged
 *    ignores the minutes projection entirely — the one input this product has learned matters most;
 *  - the same fitted rate and dispersion price the remainder of a game in play, which a bootstrap
 *    of whole games cannot do;
 *  - a ladder rung the player has cleared twice in forty games is 5% by hit rate whether the misses
 *    were by one or by ten; the fitted distribution knows the difference.
 * The measured hit rates stay beside the computed number in every prompt line, so a reader can see
 * when the two disagree — that disagreement is itself information.
 */
export interface RateSample {
  eventId?: string;
  value: number;
  minutes: number;
}

export interface RateFit {
  /** Production per minute, recency- and minutes-weighted. */
  rate: number;
  /** Between-game spread of the rate as a squared coefficient of variation; 0 is Poisson. */
  dispersion: number;
  /** Gamma shape of the rate, 1/dispersion: how much a night's evidence moves the estimate. */
  shape: number;
  /** Games that carried the stat and enough minutes to inform a rate. */
  games: number;
  /** Per-minute rate over the last five qualifying games, for the recency line in the prompt. */
  recentRate: number;
  /** Unweighted per-minute rate across the whole sample. */
  seasonRate: number;
  /** Mean and standard deviation of the raw per-game values (as logged, whatever the minutes). */
  meanValue: number;
  sdValue: number;
}

export interface MinutesEstimate {
  expected: number;
  sd: number;
  /** The clock in play: no node of the minutes mixture may exceed it. Set by props/minutes.ts projectRemainingMinutes. */
  max?: number;
}

export interface LadderRung { line: number; pOver: number; pUnder: number }

export interface LegProjection {
  line: number;
  side: "over" | "under";
  /** Probability of the chosen side, pushes excluded from both sides. */
  computed: number;
  pOver: number;
  pUnder: number;
  pPush: number;
  /** Mean and standard deviation of tonight's final total. */
  mean: number;
  sd: number;
  /** The rungs beside the posted line, so "why this line and not the one beside it" has numbers. */
  ladder: LadderRung[];
  minutes: MinutesEstimate;
  rate: number;
  dispersion: number;
  /** In play: what is already on the board and what the projection adds to it. */
  current: number;
  /** One line of arithmetic for the prompt: "0.62/min × 30 min → 18.7 ± 6.4". */
  note: string;
}

/** Games shorter than this say little about a rate: a two-minute cameo is noise, not production. */
export const MIN_RATE_MINUTES = 6;
/**
 * Recency half-life in games for the rate fit. The same walk-forward run preferred a long memory for
 * the RATE (half-lives 5 / 10 / 20 / 40 games scored 0.5020 / 0.4984 / 0.4972 / 0.4969): production
 * per minute is stable, it is the minutes that move.
 */
export const RATE_HALFLIFE = 20;
/** Weight of the dispersion prior, in games; a short log leans on the market's typical spread. */
const DISPERSION_PRIOR_GAMES = 6;
/**
 * Fallback dispersion by stat, weighed against a short log. The same walk-forward run measured the
 * median fitted value across the 38 players with 20+ games at 0.096 points, 0.008 rebounds, 0.013
 * assists, 0.013 threes; the rebound, assist and three priors sit above their medians on purpose,
 * because the failure mode of a short log is a tail that is too thin.
 */
const DISPERSION_PRIOR: Record<string, number> = { PTS: 0.09, REB: 0.03, AST: 0.04, "3PT": 0.05, STL: 0.06, BLK: 0.08, TO: 0.06 };
const DEFAULT_PRIOR = 0.06;
/** Share of the computed probability that comes from the fitted distribution; the rest is the season hit rate. */
export const MODEL_WEIGHT = 0.7;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const recencyWeight = (index: number, halflife = RATE_HALFLIFE): number => Math.pow(0.5, index / halflife);

/** Per-game (value, minutes) pairs for a market, newest first. Games without the stat are skipped. */
export function seriesFor(history: PlayerHistory, market: string, sportKey?: string): RateSample[] {
  const labels = resolveStatLabels(market, sportKey);
  if (!labels) return [];
  const out: RateSample[] = [];
  for (const g of history.games) {
    const value = statTotal(g, labels);
    const raw = g.stats.MIN;
    const minutes = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(value) || !Number.isFinite(minutes)) continue;
    out.push({ eventId: g.eventId, value, minutes });
  }
  return out;
}

function priorFor(labels: string[] | null): number {
  if (!labels?.length) return DEFAULT_PRIOR;
  // A sum of stats is at least as dispersed as its most dispersed part.
  return Math.max(...labels.map((l) => DISPERSION_PRIOR[l] ?? DEFAULT_PRIOR));
}

/**
 * Fits the per-minute rate and its between-game dispersion. The rate is the minutes-weighted mean
 * (the maximum-likelihood estimate for a Poisson process), with games decaying by recency so a
 * role that just changed shows up. Dispersion is estimated by moments — the excess of the observed
 * variance over what Poisson noise alone would give — and shrunk toward the market's prior when the
 * log is short.
 */
export function fitRate(samples: RateSample[], opts: { halflife?: number; minMinutes?: number; statLabels?: string[] | null } = {}): RateFit | null {
  const halflife = opts.halflife ?? RATE_HALFLIFE;
  const minMinutes = opts.minMinutes ?? MIN_RATE_MINUTES;
  const usable = samples.filter((s) => s.minutes >= minMinutes && Number.isFinite(s.value) && s.value >= 0);
  if (usable.length < 3) return null;

  let wv = 0, wm = 0;
  usable.forEach((s, i) => { const w = recencyWeight(i, halflife); wv += w * s.value; wm += w * s.minutes; });
  const rate = wm > 0 ? wv / wm : 0;

  // Moments: Var(v) = e + phi·e² per game, with e = rate × minutes. Weighted by recency.
  let num = 0, den = 0, weightSum = 0;
  usable.forEach((s, i) => {
    const w = recencyWeight(i, halflife);
    const e = rate * s.minutes;
    num += w * ((s.value - e) ** 2 - e);
    den += w * e * e;
    weightSum += w;
  });
  // The recency weights sum to the effective sample size, which is what the prior is weighed against.
  const raw = den > 0 ? num / den : 0;
  const prior = priorFor(opts.statLabels ?? null);
  const dispersion = clamp((weightSum * Math.max(raw, 0) + DISPERSION_PRIOR_GAMES * prior) / (weightSum + DISPERSION_PRIOR_GAMES), 0.005, 2);

  const recent = usable.slice(0, 5);
  const recentRate = recent.reduce((a, s) => a + s.value, 0) / Math.max(1, recent.reduce((a, s) => a + s.minutes, 0));
  const seasonRate = usable.reduce((a, s) => a + s.value, 0) / Math.max(1, usable.reduce((a, s) => a + s.minutes, 0));
  const values = usable.map((s) => s.value);
  const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
  const sdValue = Math.sqrt(values.reduce((a, v) => a + (v - meanValue) ** 2, 0) / Math.max(1, values.length - 1));

  return { rate, dispersion, shape: 1 / dispersion, games: usable.length, recentRate, seasonRate, meanValue, sdValue };
}

/**
 * Negative binomial tail P(X >= needed) for a count with the given mean and dispersion (CV² of the
 * gamma-distributed rate). Dispersion near zero is the Poisson limit; the pmf recurrence is stable
 * for both.
 */
export function nbAtLeast(needed: number, mean: number, dispersion: number): number {
  if (needed <= 0) return 1;
  if (mean <= 0) return 0;
  const k = 1 / Math.max(dispersion, 1e-6);
  const q = mean / (k + mean); // success probability of each extra count
  let term = Math.exp(k * (Math.log(k) - Math.log(k + mean))); // P(X = 0)
  let cumulative = term;
  for (let t = 0; t < needed - 1; t += 1) {
    term *= ((t + k) / (t + 1)) * q;
    cumulative += term;
    if (term < 1e-15 && t > mean) break;
  }
  return clamp(1 - cumulative, 0, 1);
}

/** P(X = value) for the same distribution. */
export function nbExactly(value: number, mean: number, dispersion: number): number {
  if (value < 0 || !Number.isInteger(value)) return 0;
  if (mean <= 0) return value === 0 ? 1 : 0;
  return clamp(nbAtLeast(value, mean, dispersion) - nbAtLeast(value + 1, mean, dispersion), 0, 1);
}

/** Five-point rule over a normal: enough to carry the minutes uncertainty into the tail without a Monte Carlo. */
const MINUTES_NODES: { z: number; w: number }[] = [
  { z: -1.645, w: 0.1 }, { z: -0.675, w: 0.2 }, { z: 0, w: 0.4 }, { z: 0.675, w: 0.2 }, { z: 1.645, w: 0.1 },
];

interface TailModel { atLeast: (needed: number) => number; exactly: (value: number) => number; mean: number; sd: number }

/**
 * The distribution of what the player still adds tonight: a negative binomial with the rate as
 * intensity and the (uncertain) minutes as exposure, mixed over the minutes nodes. `maxMinutes`
 * is the clock: in play no node may exceed the minutes left, however wide the estimate.
 */
function remainderModel(rate: number, dispersion: number, minutes: MinutesEstimate, maxMinutes?: number): TailModel {
  const cap = maxMinutes !== undefined && Number.isFinite(maxMinutes) ? Math.max(0, maxMinutes) : Infinity;
  const nodes = MINUTES_NODES.map((n) => ({ w: n.w, m: Math.min(cap, Math.max(0, minutes.expected + n.z * minutes.sd)) }));
  const atLeast = (needed: number) => clamp(nodes.reduce((acc, n) => acc + n.w * nbAtLeast(needed, rate * n.m, dispersion), 0), 0, 1);
  const exactly = (value: number) => clamp(nodes.reduce((acc, n) => acc + n.w * nbExactly(value, rate * n.m, dispersion), 0), 0, 1);
  // Moments of the mixture itself, so a capped node is counted as it is priced.
  const mean = nodes.reduce((acc, n) => acc + n.w * rate * n.m, 0);
  const variance = nodes.reduce((acc, n) => {
    const mu = rate * n.m;
    return acc + n.w * (mu + dispersion * mu * mu) + n.w * (mu - mean) ** 2;
  }, 0);
  return { atLeast, exactly, mean, sd: Math.sqrt(Math.max(variance, 0)) };
}

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "?");

/**
 * P(over) and P(under) of a line for a player whose rate and minutes are known, with the ladder
 * rungs beside it. `current` is what is already on the board in play (0 before tip-off): the
 * projection covers the remainder and the line is judged against current + remainder. Every rung,
 * the posted one included, is normalised the same way: a push on a whole line is excluded from both
 * sides, so pOver + pUnder = 1 on every rung and the ladder is monotone in the line.
 */
export function projectLeg(
  fit: Pick<RateFit, "rate" | "dispersion">,
  minutes: MinutesEstimate,
  line: number,
  side: "over" | "under",
  opts: { current?: number; ladderStep?: number; ladderRungs?: number; maxMinutes?: number } = {},
): LegProjection {
  const current = opts.current ?? 0;
  const model = remainderModel(fit.rate, fit.dispersion, minutes, opts.maxMinutes ?? minutes.max);
  const at = (l: number): LadderRung & { pPush: number } => {
    // Over needs the total strictly above the line: floor(line)+1. A whole line can push.
    const over = model.atLeast(Math.floor(l) + 1 - current);
    const push = Number.isInteger(l) && l - current >= 0 ? model.exactly(l - current) : 0;
    const decided = 1 - push;
    const pOver = decided > 1e-12 ? clamp(over / decided, 0, 1) : 0;
    return { line: l, pOver, pUnder: clamp(1 - pOver, 0, 1), pPush: clamp(push, 0, 1) };
  };
  const posted = at(line);
  const step = opts.ladderStep ?? 1;
  const rungs = opts.ladderRungs ?? 2;
  const ladder: LadderRung[] = [];
  for (let i = -rungs; i <= rungs; i += 1) {
    const l = line + i * step;
    if (l < 0.5) continue;
    const r = i === 0 ? posted : at(l);
    ladder.push({ line: r.line, pOver: r.pOver, pUnder: r.pUnder });
  }
  const mean = current + model.mean;
  const note = current > 0
    ? `${current} + ${fmt(fit.rate, 2)}/min × ${fmt(minutes.expected, 0)} min → ${fmt(mean)} ± ${fmt(model.sd)}`
    : `${fmt(fit.rate, 2)}/min × ${fmt(minutes.expected, 0)} ± ${fmt(minutes.sd, 0)} min → ${fmt(mean)} ± ${fmt(model.sd)}`;
  return {
    line, side, computed: side === "over" ? posted.pOver : posted.pUnder, pOver: posted.pOver, pUnder: posted.pUnder, pPush: posted.pPush,
    mean, sd: model.sd, ladder, minutes, rate: fit.rate, dispersion: fit.dispersion, current, note,
  };
}

/**
 * The number the prompt shows as computed and fairProbability anchors to: the fitted distribution
 * blended with the Laplace-smoothed season hit rate at the same line. The hit rate carries the
 * nights the distribution is too thin for — the ejection, the hot 35 — and the blend was the
 * best-calibrated variant in the walk-forward run cited above. Falls back to the model alone
 * without a sample. props/candidates.ts applies it to every rung of the ladder.
 */
export function blendedProbability(model: number, hits: number, of: number, weight = MODEL_WEIGHT): number {
  if (!(of > 0)) return clamp(model, 0.005, 0.995);
  const empirical = (hits + 1) / (of + 2);
  return clamp(weight * model + (1 - weight) * empirical, 0.005, 0.995);
}

/**
 * The floor and ceiling every published chance passes through, blended or not. A counting stat in
 * play has no certainties — an under is one whistle from a push and a made three from a loss — and
 * the ledger of 22/09/2026 carries 59 live legs stamped at exactly 1.000, of which 11 lost. A
 * chance of 1.000 in the ledger is always a bug, so the in-play path clamps like the pre-game one.
 */
export const PROBABILITY_FLOOR = 0.005;
export const PROBABILITY_CEILING = 0.995;
export const clampProbability = (p: number): number => clamp(p, PROBABILITY_FLOOR, PROBABILITY_CEILING);

/**
 * The rate for the rest of a game in play: the PRE-GAME rate, unchanged by tonight's count. That is
 * a measurement, not an assumption — one run, scripts/research/walkforward-live.mts at half-time of
 * the 194 WNBA 2026 games with play-by-play fetched 22/09/2026 (19,465 line predictions), with the
 * minutes mixture capped at the clock and the production width, log loss: the pre-game rate over the
 * remaining minutes 0.4522, a gamma-Poisson posterior moved toward tonight's production 0.4644, a
 * 70/30 pre-game/tonight blend 0.4638, tonight's rate alone 0.6831. A cold half does not forecast a
 * cold second half and a hot half does not forecast a hot one; what the first half does carry is the
 * count on the board and the minutes and fouls that shape what is left, and those enter through
 * `current` and the remaining-minutes projection. The same run measured second-half production
 * against the pre-game rate over the second-half minutes actually played at 1.04 for points, 0.98
 * rebounds, 0.98 assists — no uniform uplift, so none is applied. `tonightRate` is returned so it
 * can be printed beside the requirement; `priorWeight` stays at 1 so the reader can see nothing moved.
 */
export function liveRate(fit: Pick<RateFit, "rate" | "dispersion">, tonight: { value: number; minutes: number }): { rate: number; dispersion: number; priorWeight: number; tonightRate: number } {
  const played = Math.max(0, tonight.minutes);
  return { rate: fit.rate, dispersion: fit.dispersion, priorWeight: 1, tonightRate: played > 0 ? Math.max(0, tonight.value) / played : 0 };
}

/**
 * The empirical hit rate at a line with each logged game shifted to tonight's minutes at the fitted
 * rate. Printed beside the computed number, never used on its own: the shift is linear and the
 * games keep their own noise, which is the honest way to say "what the log would have done in
 * tonight's minutes" without inventing a second draw.
 */
export function minutesAdjustedHitRate(samples: RateSample[], fit: Pick<RateFit, "rate">, minutes: number, line: number, side: "over" | "under", halflife = RATE_HALFLIFE): number {
  const usable = samples.filter((s) => s.minutes >= MIN_RATE_MINUTES);
  if (!usable.length) return NaN;
  let hits = 0, total = 0;
  usable.forEach((s, i) => {
    const w = recencyWeight(i, halflife);
    const shifted = s.value + fit.rate * (minutes - s.minutes);
    if (Math.abs(shifted - line) < 1e-9) return;
    total += w;
    if (side === "over" ? shifted > line : shifted < line) hits += w;
  });
  return total > 0 ? hits / total : NaN;
}
