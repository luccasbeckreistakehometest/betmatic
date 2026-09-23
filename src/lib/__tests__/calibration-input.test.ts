import { describe, expect, it } from "vitest";
import { CARTEIRA_GATE, bestSlice, sigmaFrom, sliceCalibration, wilson } from "@/lib/ledger/calibration-input";
import { SIZING } from "@/lib/bets/sizing";
import type { LedgerEntry, LegOutcome, SettledLeg } from "@/lib/types";

/**
 * Where `c` and `σ_p` come from. Two rules decide everything here: the day being selected is never
 * part of its own calibration, and the three populations never mix.
 */

let n = 0;
const leg = (outcome: LegOutcome, predicted = 0.7, over: Partial<SettledLeg> = {}): SettledLeg => ({
  selection: "x", market: "player_prop", sourceBasis: "measured history", predictedProbability: predicted, oddsDecimal: 1.6, outcome,
  settlement: { type: "player_prop", player: "P", stat: "PRA", line: 24.5, side: "over", sourceBasis: "measured history" }, ...over,
});

function entry(legs: SettledLeg[], over: Partial<LedgerEntry> = {}): LedgerEntry {
  n += 1;
  return {
    id: `t${n}`, gameId: `g${n}`, sportKey: "wnba", matchup: "A @ B", createdAt: "2026-09-22T00:00:00.000Z",
    settledAt: "2026-09-22T23:00:00.000Z", bandKey: "safe", kind: "single", title: "t",
    combinedDecimal: 1.6, modelledProbability: 0.7, legs, outcome: legs[0].outcome, ...over,
  };
}

const run = (count: number, wonCount: number, predicted = 0.7, over: Partial<LedgerEntry> = {}) =>
  Array.from({ length: count }, (_, i) => entry([leg(i < wonCount ? "won" : "lost", predicted)], over));

describe("the measured ratio and the factor", () => {
  it("measures legs won over probability predicted", () => {
    const slice = sliceCalibration({ scope: "pregame-main" }, run(100, 56, 0.7));
    expect(slice.settled).toBe(100);
    expect(slice.measuredRatio).toBeCloseTo(0.8, 3);
    // Pulled towards 1 with the 200-leg prior, never taken at full force off 100 legs.
    expect(slice.measuredFactor).toBeGreaterThan(0.9);
    expect(slice.measuredFactor).toBeLessThan(1);
    // And it is measured, not applied: generation already corrected this mean, so the factor this
    // layer puts on the stake is 1. Correcting it twice is the bug this asserts against.
    expect(slice.factor).toBe(1);
  });

  it("closes the wallet when there is no sample at all", () => {
    const slice = sliceCalibration({ scope: "pregame-main" }, []);
    expect(slice).toMatchObject({ settled: 0, factor: 1, sigmaP: SIZING.sigmaPCeiling, mode: "medicao" });
  });

  it("stays in measurement while σ_p is over the gate", () => {
    const slice = sliceCalibration({ scope: "pregame-main" }, run(400, 200, 0.85));
    expect(slice.sigmaP).toBeGreaterThan(CARTEIRA_GATE.sigmaP);
    expect(slice.mode).toBe("medicao");
  });

  it("opens a slice only when all three conditions hold at once", () => {
    // 400 legs, well calibrated, tight: the one shape that earns real stakes.
    const rows = Array.from({ length: 400 }, (_, i) => entry([leg(i % 10 < 7 ? "won" : "lost", 0.7)]));
    const slice = sliceCalibration({ scope: "pregame-main" }, rows);
    expect(slice.settled).toBeGreaterThanOrEqual(CARTEIRA_GATE.settledLegs);
    expect(slice.sigmaP).toBeLessThanOrEqual(CARTEIRA_GATE.sigmaP);
    expect(Math.abs(slice.gapPoints)).toBeLessThan(CARTEIRA_GATE.biasPoints);
    expect(slice.mode).toBe("carteira");
  });
});

describe("never in-sample", () => {
  it("excludes the day being selected from its own calibration", () => {
    const rows = [
      ...run(40, 32, 0.7),
      ...run(40, 4, 0.7, { settledAt: "2026-09-23T23:00:00.000Z" }),
    ];
    const all = sliceCalibration({ scope: "pregame-main" }, rows);
    const without = sliceCalibration({ scope: "pregame-main", excludeDay: "2026-09-23" }, rows);
    expect(all.settled).toBe(80);
    expect(without.settled).toBe(40);
    expect(without.measuredRatio).toBeGreaterThan(all.measuredRatio);
  });
});

describe("the fallback ladder", () => {
  const rows = run(60, 30, 0.7);

  it("uses the specific slice when it has a sample", () => {
    expect(bestSlice({ scope: "pregame-main", stat: "pra", side: "over" }, rows).key).toBe("pregame-main:pra:over");
  });

  it("falls back to the scope when the specific one is empty", () => {
    expect(bestSlice({ scope: "pregame-main", stat: "threes", side: "under" }, rows).key).toBe("pregame-main:*:*");
  });

  it("returns the closed-wallet answer when nothing above it has a sample either", () => {
    expect(bestSlice({ scope: "live", stat: "threes" }, rows)).toMatchObject({ settled: 0, factor: 1, mode: "medicao" });
  });
});

describe("the statistics themselves", () => {
  it("computes a Wilson interval that contains the point estimate", () => {
    const ci = wilson(56, 100);
    expect(ci.low).toBeLessThan(0.56);
    expect(ci.high).toBeGreaterThan(0.56);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("returns the ceiling for a sample too small to describe a spread", () => {
    expect(sigmaFrom([{ p: 0.7, y: 1 }], 1)).toBe(SIZING.sigmaPCeiling);
  });

  it("clamps σ_p into its band whatever the data says", () => {
    const perfect = Array.from({ length: 200 }, (_, i) => ({ p: 0.7, y: i % 10 < 7 ? 1 : 0 }));
    const sigma = sigmaFrom(perfect, 1);
    expect(sigma).toBeGreaterThanOrEqual(SIZING.sigmaPFloor);
    expect(sigma).toBeLessThanOrEqual(SIZING.sigmaPCeiling);
  });
});
