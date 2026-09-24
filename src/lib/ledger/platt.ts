/**
 * Platt scaling with a slope, fitted by logistic regression on the legs themselves.
 *
 * The correction that shipped before this was an intercept only: it took a slice's AVERAGE claimed
 * probability, compared it to the slice's overall hit rate, and added the gap as one fixed shift in
 * log-odds. That works when a slice is uniformly optimistic. It cannot work when the optimism grows
 * with the claim — and on 24/09/2026 the ledger said it does, loudly:
 *
 *   pre-game legs claimed 60–70% and delivered 24% over 54 legs
 *   pre-game legs claimed 80–90% and delivered 63% over 191 legs
 *   live legs claimed 90–100% and delivered 81% over 338 legs
 *   live 'over' legs claimed 73% and delivered 86% over 71 legs — the model is UNDER-confident there
 *
 * One shift fitted at the slice mean cannot hit those at once. Worse, it under-corrects exactly
 * where the model is most confident and most wrong, because the mean sits below the extremes.
 *
 * A slope fixes the shape: `p' = σ(a · logit(p) + b)`. With `a < 1` the whole distribution is pulled
 * toward the base rate and the pull is STRONGER at the extremes, which is the measured failure. With
 * `a = 1, b = 0` the map is the identity, so a slice that is already honest earns nothing — the loop
 * still converges instead of compounding, because calibration is measured on the stored (corrected)
 * probability.
 *
 * Ordering is preserved for any `a > 0`: a leg the model liked more still comes out higher. That is
 * a property of the map, not a check, and it is why the slope is bounded below rather than allowed
 * to go negative on a noisy slice.
 */

/** One settled leg: what was claimed, and whether it landed. */
export interface PlattPoint {
  /** The probability the ticket was served with, in (0,1). */
  predicted: number;
  /** 1 for a win, 0 for a loss. */
  won: 0 | 1;
}

export interface PlattFit {
  slope: number;
  intercept: number;
  /** Legs the fit saw. */
  n: number;
  /** Standard deviation of logit(predicted): below MIN_SPREAD the slope is not identifiable. */
  spread: number;
  /** True when the slope was held at 1 and only the intercept moved. */
  interceptOnly: boolean;
}

const clamp = (p: number) => Math.min(Math.max(p, 0.001), 0.999);
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * How much the claimed probabilities inside a slice must vary before a slope means anything.
 *
 * A slice whose legs all claim about the same number carries no information about how the error
 * grows with the claim: any slope fits it equally well, so the fit would be reading noise. Below
 * this the slope is pinned at 1 and the correction falls back to the shift the old code computed.
 * 0.35 in log-odds is roughly the spread between claims of 55% and 70%.
 */
export const MIN_SPREAD = 0.35;

/**
 * A ridge pulling the fit toward the identity map, in units of pseudo-observations.
 *
 * Without it a slice whose legs happen to be perfectly separated by their claimed probability sends
 * the slope to infinity — the textbook failure of unregularised logistic regression, and one a thin
 * betting slice reaches easily. Two pseudo-observations is enough to keep it finite and is
 * negligible beside the samples that clear MIN_SAMPLE.
 */
export const RIDGE = 2;

/** Hard bounds on the fitted map. A slope at or below zero would invert the model's ordering. */
export const MIN_SLOPE = 0.25;
export const MAX_SLOPE = 1.75;

/**
 * Fits `σ(a·logit(p) + b)` to the settled legs by Newton's method on the penalised likelihood.
 *
 * Returns the identity map for an empty slice, and an intercept-only fit where the claims are too
 * alike for a slope to be identifiable.
 */
export function fitPlatt(points: PlattPoint[]): PlattFit {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.predicted)) continue;
    xs.push(logit(clamp(p.predicted)));
    ys.push(p.won);
  }
  const n = xs.length;
  if (!n) return { slope: 1, intercept: 0, n: 0, spread: 0, interceptOnly: true };

  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n);
  const interceptOnly = spread < MIN_SPREAD;

  let a = 1;
  let b = 0;
  for (let step = 0; step < 40; step += 1) {
    // Gradient and Hessian of the negative log-likelihood, plus the ridge toward (a=1, b=0).
    let ga = RIDGE * (a - 1);
    let gb = RIDGE * b;
    let haa = RIDGE;
    let hab = 0;
    let hbb = RIDGE;
    for (let i = 0; i < n; i += 1) {
      const s = sigmoid(a * xs[i] + b);
      const r = s - ys[i];
      const w = Math.max(s * (1 - s), 1e-9);
      ga += r * xs[i];
      gb += r;
      haa += w * xs[i] * xs[i];
      hab += w * xs[i];
      hbb += w;
    }
    // Intercept-only slices solve the same system with the slope frozen, so one code path serves
    // both and the fallback cannot drift away from the fit it is standing in for.
    if (interceptOnly) {
      const db = -gb / hbb;
      b += db;
      if (Math.abs(db) < 1e-9) break;
      continue;
    }
    const det = haa * hbb - hab * hab;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const da = -(hbb * ga - hab * gb) / det;
    const db = -(haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) return { slope: 1, intercept: 0, n, spread, interceptOnly: true };
  return { slope: Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, a)), intercept: b, n, spread, interceptOnly };
}

/**
 * Pulls a fit toward the identity in proportion to how much evidence stands behind it.
 *
 * Same rule the shift already used — `n / (n + prior)` — applied to both parameters, so a slice with
 * 20 legs moves a third of the way and one with 200 moves most of it. `maxShift` bounds the
 * intercept for the same reason it always did: however bad a slice looks, one correction may not
 * move a probability further than that.
 */
export function shrinkFit(fit: PlattFit, prior: number, maxShift: number): PlattFit {
  const weight = fit.n / (fit.n + prior);
  const slope = 1 + weight * (fit.slope - 1);
  const intercept = Math.max(-maxShift, Math.min(maxShift, weight * fit.intercept));
  return { ...fit, slope, intercept };
}

/** Applies a fitted map to one claimed probability. */
export const applyFit = (fit: PlattFit, stated: number): number =>
  clamp(sigmoid(fit.slope * logit(clamp(stated)) + fit.intercept));
