import { describe, expect, it } from "vitest";
import fixture from "./fixtures/selecao-3-noites.json";
import { SIZING, shrinkFactor } from "@/lib/bets/sizing";

/**
 * Is `noise = decimal · σ_p` the right shape for the shrinkage?
 *
 * The question is real, because the two candidate forms encode two different PRIORS:
 *
 *   A  k = σ_true²/(σ_true² + (d·σ_p)²)   "a true edge is worth ~3 points of EV at any price"
 *   B  k = σ_true²/(σ_true² + σ_p²)       "a true probability sits ~3 points off the market at any
 *                                          price" — which makes d cancel, because the edge already
 *                                          contains d, and leaves the price penalty to Kelly's 1/(d−1)
 *
 * B is the textbook posterior mean when the prior is "the market is right" and the estimate is
 * noisy. A is the posterior when the prior is on the EDGE instead. Neither is obviously wrong; they
 * disagree about whether long prices carry proportionally bigger true edges.
 *
 * So it is measured, not argued. Each form weights every decided ticket by the units it would
 * stake, and the portfolio's realised ROI is the score.
 */

type R = { decimal: number; modelProbability: number; legs: number; bandKey: string; evidenceScore: number; confidence: string; outcome: string; alternativeOf?: string };
const decided = (fixture as R[]).filter((r) => r.outcome === "won" || r.outcome === "lost");
const GATE = 20;

const ST = SIZING.sigmaTrue;
const kA = (d: number, sp: number) => ST ** 2 / (ST ** 2 + (d * sp) ** 2);
const kB = (_d: number, sp: number) => ST ** 2 / (ST ** 2 + sp ** 2);
const edgeOf = (r: R) => r.modelProbability * r.decimal - 1;
const sizer = (k: (d: number, s: number) => number, sp: number) => (r: R) =>
  edgeOf(r) <= 0 ? 0 : Math.max(0, 100 * SIZING.kellyFraction * (k(r.decimal, sp) * edgeOf(r)) / (r.decimal - 1));

function roi(rows: R[], w: (r: R) => number) {
  const staked = rows.reduce((a, r) => a + w(r), 0);
  const back = rows.reduce((a, r) => a + (r.outcome === "won" ? w(r) * r.decimal : 0), 0);
  return { n: rows.filter((r) => w(r) > 0).length, roi: staked > 0 ? back / staked - 1 : 0 };
}

const inWindow = (r: R) =>
  r.decimal >= SIZING.minOdds && r.decimal <= SIZING.maxOdds && r.legs <= SIZING.maxLegs
  && r.evidenceScore === 100 && r.confidence !== "low";

describe("which shrinkage the ledger supports", () => {
  const SP = 0.125; // what the pre-game slice actually measures today

  it("A beats B by a wide margin over everything that settled", () => {
    const a = roi(decided, sizer(kA, SP));
    const b = roi(decided, sizer(kB, SP));
    const flat = roi(decided, (r) => (edgeOf(r) > 0 ? 1 : 0));
    expect(a.n).toBeGreaterThanOrEqual(GATE);
    // -0.7 % against -14.2 %, with a flat unit on the same tickets at -44.5 %.
    expect(a.roi).toBeGreaterThan(b.roi + 0.1);
    expect(b.roi).toBeGreaterThan(flat.roi);
  });

  it("but that margin is earned on tickets the policy never bets", () => {
    // A's whole advantage is crushing long prices, and cut 5 already removes them. Inside the
    // window the two forms are close and the two arms DISAGREE about which is ahead — main-only
    // favours B, main-plus-alternative favours A — and neither arm clears the gate on its own.
    const main = decided.filter((r) => inWindow(r) && !r.alternativeOf);
    const both = decided.filter(inWindow);
    expect(roi(main, sizer(kB, SP)).roi).toBeGreaterThan(roi(main, sizer(kA, SP)).roi);
    expect(roi(both, sizer(kA, SP)).roi).toBeGreaterThan(roi(both, sizer(kB, SP)).roi);
    expect(roi(main, sizer(kA, SP)).n).toBeLessThan(GATE);
  });

  it("σ_p is a volume knob, not a selection signal: it moves the size and not the ranking", () => {
    // Within a form, changing σ_p scales every stake by nearly the same factor, so the portfolio's
    // ROI barely moves. This is why a bad σ_p cannot be diagnosed by looking at returns.
    const wide = roi(decided, sizer(kA, 0.15)).roi;
    const tight = roi(decided, sizer(kA, 0.03)).roi;
    expect(Math.abs(wide - tight)).toBeLessThan(0.02);
  });

  /**
   * The verdict, so nobody has to re-derive it: **keep A**, and keep it for stated reasons rather
   * than because it was there first.
   *
   *   · inside the window the wallet actually bets, the evidence does NOT decide — the arms
   *     disagree and neither clears the gate, and the gate binds for good news as well as bad;
   *   · A is the more conservative of the two, staking about a third of what B stakes;
   *   · A's prior — true edges do not grow with price — is the one the only gate-clearing price
   *     finding supports: 0 greens in 33 decided above 20x.
   *
   * What would overturn it: 20 decided tickets inside the window, main-only, with B ahead.
   */
  it("keeps the price penalty monotonic, which is the property either form has to have", () => {
    expect(shrinkFactor(1.5, SP)).toBeGreaterThan(shrinkFactor(5, SP));
    expect(shrinkFactor(5, SP)).toBeGreaterThan(shrinkFactor(20, SP));
  });
});
