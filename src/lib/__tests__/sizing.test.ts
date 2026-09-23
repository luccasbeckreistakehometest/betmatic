import { describe, expect, it } from "vitest";
import {
  SIZING,
  applyCaps,
  calibrationFactor,
  calibratedProbability,
  growthScore,
  minAcceptableDecimal,
  roundUnits,
  shrinkFactor,
  stakeUnits,
  unitsToMoney,
} from "@/lib/bets/sizing";

/**
 * The wallet's arithmetic. Every case here is a decision from the policy, not a default: the point
 * of the file is that "how much" is computable, reviewable and impossible for the model to touch.
 */

describe("shrinkage depends on the odds, which is why the odds alone never decide", () => {
  it("keeps a fifth of the edge at 2.0x and almost nothing at 20x", () => {
    expect(shrinkFactor(2, 0.03)).toBeCloseTo(0.2, 10);
    expect(shrinkFactor(20, 0.03)).toBeLessThan(shrinkFactor(2, 0.03) / 50);
  });

  it("falls as the estimate gets blurrier", () => {
    expect(shrinkFactor(2, 0.12)).toBeLessThan(shrinkFactor(2, 0.06));
    expect(shrinkFactor(2, 0.06)).toBeLessThan(shrinkFactor(2, 0.03));
  });

  it("is zero for a price that is not a price", () => {
    expect(shrinkFactor(1, 0.03)).toBe(0);
    expect(shrinkFactor(NaN, 0.03)).toBe(0);
  });
});

describe("the calibration factor is measured, with a prior", () => {
  it("pulls 172 legs at 0.794 to 0.905", () => {
    expect(calibrationFactor(0.794, 172)).toBeCloseTo(0.905, 3);
  });

  it("is exactly 1 with no sample at all", () => {
    expect(calibrationFactor(0.5, 0)).toBe(1);
    expect(calibrationFactor(NaN, 400)).toBe(1);
  });

  it("walks to the measured number as the ledger grows", () => {
    expect(calibrationFactor(0.79, 100_000)).toBeCloseTo(0.79, 3);
    expect(calibrationFactor(0.794, 600)).toBeLessThan(calibrationFactor(0.794, 172));
  });

  it("compounds per leg, so a double shrinks more than a single", () => {
    expect(calibratedProbability(0.8, 1, 0.905)).toBeCloseTo(0.724, 3);
    expect(calibratedProbability(0.8, 2, 0.905)).toBeCloseTo(0.655, 3);
  });
});

describe("stakeUnits", () => {
  it("returns zero and says why when the price already ate the edge", () => {
    const r = stakeUnits({ decimal: 1.2, modelProbability: 0.5 });
    expect(r.units).toBe(0);
    expect(r.reason).toBe("no_edge");
  });

  it("hits the ticket ceiling at 1.38 with a 80 % chance", () => {
    const r = stakeUnits({ decimal: 1.38, modelProbability: 0.8 });
    expect(r.units).toBe(2);
    expect(r.capped).toBe("ticket");
  });

  it("says no at 1.37 with a 73 % chance — one cent of odds, opposite answers", () => {
    const r = stakeUnits({ decimal: 1.37, modelProbability: 0.73 });
    expect(r.units).toBe(0);
    expect(r.reason).toBe("below_floor");
  });

  it("pays the floor and nothing else in the measurement regime", () => {
    const r = stakeUnits({ decimal: 1.38, modelProbability: 0.8, c: 0.905, sigmaP: 0.12, mode: "medicao" });
    expect(r.units).toBe(SIZING.medicaoU);
    expect(r.capped).toBe("none");
  });

  it("never sizes anything while the wallet is closed", () => {
    expect(stakeUnits({ decimal: 1.38, modelProbability: 0.8, mode: "fechado" }).units).toBe(0);
  });

  it("grows with the chance and falls with the price", () => {
    const a = stakeUnits({ decimal: 1.6, modelProbability: 0.66 }).units;
    const b = stakeUnits({ decimal: 1.6, modelProbability: 0.7 }).units;
    expect(b).toBeGreaterThan(a);
    const short = stakeUnits({ decimal: 1.6, modelProbability: 0.7 }).units;
    const long = stakeUnits({ decimal: 3.2, modelProbability: 0.35 }).units;
    expect(long).toBeLessThan(short);
  });

  it("holds the invariants for every plausible input", () => {
    for (let d = 1.05; d <= 8; d += 0.05) {
      for (let p = 0.05; p < 0.99; p += 0.05) {
        const u = stakeUnits({ decimal: d, modelProbability: p }).units;
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(SIZING.maxU);
        expect(Math.abs(u / SIZING.stepU - Math.round(u / SIZING.stepU))).toBeLessThan(1e-9);
      }
    }
  });
});

describe("rounding never goes up", () => {
  it("drops below the floor to zero and truncates to the step", () => {
    expect(roundUnits(0.24)).toBe(0);
    // 0.38 u is 0.25 u, not 0.50 u: rounding a stake up is betting above Kelly.
    expect(roundUnits(0.38)).toBe(0.25);
    expect(roundUnits(1.99)).toBe(1.75);
    expect(roundUnits(2)).toBe(2);
  });

  it("floors money to R$ 0.50 and keeps units scale-free", () => {
    expect(unitsToMoney(1.25, 1000)).toBe(12.5);
    expect(unitsToMoney(1.25, 999)).toBe(12);
    // Doubling the bankroll doubles the money and changes no unit.
    expect(unitsToMoney(1.25, 2000)).toBe(25);
    expect(stakeUnits({ decimal: 1.38, modelProbability: 0.8 }).units).toBe(2);
  });
});

describe("growth score, not EV%", () => {
  it("prefers a short price with a small edge to a long one with a big EV", () => {
    const short = growthScore(1.5, 0.06 * shrinkFactor(1.5, 0.03));
    const long = growthScore(20, 0.6 * shrinkFactor(20, 0.03));
    expect(short).toBeGreaterThan(long);
  });
});

describe("the minimum acceptable price", () => {
  it("is the price below which the edge is gone", () => {
    expect(minAcceptableDecimal(0.8, 0.04)).toBeCloseTo(1.3, 10);
    expect(minAcceptableDecimal(0.5, 0.08)).toBeCloseTo(2.16, 10);
  });
});

describe("caps", () => {
  const row = (gameId: string, units: number, players: string[] = []) => ({ gameId, units, players, capped: "none" as const });

  it("trims four rows worth 9 u down to the day's 5 u, keeping the proportions", () => {
    const rows = [row("g1", 3), row("g2", 2.5), row("g3", 2), row("g4", 1.5)];
    const out = applyCaps(rows, { gameCapU: 3, dayCapU: 5, playerCapU: 2 });
    const total = out.reduce((a, r) => a + r.units, 0);
    expect(total).toBeLessThanOrEqual(5);
    // Proportions survive to within one step.
    expect(Math.abs(out[0].units - 3 * (5 / 9))).toBeLessThanOrEqual(0.25);
    expect(out.every((r) => r.capped === "day")).toBe(true);
  });

  it("binds the game ceiling before the day's", () => {
    const rows = [row("g1", 2), row("g1", 2), row("g2", 0.5)];
    const out = applyCaps(rows, { gameCapU: 3, dayCapU: 5, playerCapU: 5 });
    const g1 = out.filter((r) => r.gameId === "g1").reduce((a, r) => a + r.units, 0);
    expect(g1).toBeLessThanOrEqual(3);
    expect(out[2].units).toBe(0.5);
  });

  it("caps one player's total across the day", () => {
    const rows = [row("g1", 2, ["Arike"]), row("g2", 1.5, ["Arike"])];
    const out = applyCaps(rows, { gameCapU: 3, dayCapU: 5, playerCapU: 2 });
    expect(out.reduce((a, r) => a + r.units, 0)).toBeLessThanOrEqual(2);
  });

  it("leaves a set already under every ceiling untouched", () => {
    const rows = [row("g1", 1), row("g2", 0.5)];
    expect(applyCaps(rows).map((r) => r.units)).toEqual([1, 0.5]);
  });
});
