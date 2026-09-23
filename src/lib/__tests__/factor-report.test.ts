import { describe, expect, it } from "vitest";
import { benjaminiHochberg, binomialP, clampProbability, factorCalibration } from "@/lib/ledger/factor-report";
import { blowoutBucket, clvBucket, computedGapBucket, factorsOf, minutesBucket, oddsBucket, scopeOf } from "@/lib/ledger/factors";
import type { FactorInput } from "@/lib/ledger/factors";

/**
 * A factor lights up only when the sample is real AND the discovery survives the correction for
 * having looked at thirteen dimensions at once. Everything here is a case that, without one of
 * those two rules, produced a confident wrong answer.
 */

let n = 0;
function row(over: Partial<FactorInput> = {}): FactorInput {
  n += 1;
  return {
    ledgerId: `t${n}`, legIndex: 0, gameId: `g${n % 7}`, day: `2026-09-${10 + (n % 6)}`,
    scope: "pre", alternative: false, bandKey: "safe", ticketLegs: 1,
    marketKey: "pra", side: "over", athleteId: "1", predicted: 0.8, oddsDecimal: 1.6,
    outcome: "lost", ...over,
  };
}

const many = (count: number, over: Partial<FactorInput>, wonCount: number) =>
  Array.from({ length: count }, (_, i) => row({ ...over, outcome: i < wonCount ? "won" : "lost" }));

describe("the minimum sample", () => {
  it("never lights up four legs with a 40-point gap", () => {
    const stats = factorCalibration(many(4, { marketKey: "threes" }, 0));
    expect(stats).toEqual([]);
  });

  it("lights up 40 legs that landed 40 % against 80 % predicted", () => {
    const stats = factorCalibration(many(40, { marketKey: "threes", predicted: 0.8 }, 16));
    const stat = stats.find((s) => s.dim === "stat" && s.value === "threes");
    expect(stat?.legs).toBe(40);
    expect(stat?.flagged).toBe(true);
    expect(stat!.gap).toBeGreaterThan(0.3);
  });

  it("refuses a slice that lives in two games, however many legs it has", () => {
    const rows = many(60, { marketKey: "pa" }, 10).map((r, i) => ({ ...r, gameId: i % 2 ? "gA" : "gB" }));
    expect(factorCalibration(rows).find((s) => s.value === "pa")).toBeUndefined();
  });

  it("refuses a slice that lives on one day", () => {
    const rows = many(60, { marketKey: "ra" }, 10).map((r) => ({ ...r, day: "2026-09-22" }));
    expect(factorCalibration(rows).find((s) => s.value === "ra")).toBeUndefined();
  });
});

describe("looking many times", () => {
  it("throws away twenty tests that are only noise", () => {
    // Twenty p-values spread like pure chance: one lands under 0.05 by luck alone, BH keeps none.
    const noise = Array.from({ length: 20 }, (_, i) => (i + 1) / 21);
    expect(noise.filter((x) => x < 0.05)).toHaveLength(1);
    expect(benjaminiHochberg(noise, 0.1).filter((x) => x <= 0.1)).toEqual([]);

    // One real effect buried in nineteen coin flips survives — that is the point of the correction.
    const mixed = [0.0001, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20)];
    expect(benjaminiHochberg(mixed, 0.1).filter((x) => x <= 0.1)).toHaveLength(1);
  });

  it("keeps twenty genuinely strong results, because that is what the arithmetic says", () => {
    const strong = Array.from({ length: 20 }, (_, i) => 0.001 + i * 0.0025); // 0.001 … 0.0485
    const q = benjaminiHochberg(strong, 0.1);
    expect(q.filter((x) => x <= 0.1)).toHaveLength(20);
    // Every q-value is at least its own p-value: the correction only ever costs confidence.
    expect(q.every((x, i) => x >= strong[i] - 1e-9)).toBe(true);
  });

  it("keeps the q-values monotone in the p-order", () => {
    const q = benjaminiHochberg([0.5, 0.01, 0.2, 0.001]);
    expect(q[3]).toBeLessThanOrEqual(q[1]);
    expect(q[1]).toBeLessThanOrEqual(q[2]);
  });

  it("reports p≈1 when the result is exactly what was predicted", () => {
    expect(binomialP(80, 100, 0.8)).toBeGreaterThan(0.9);
    expect(binomialP(40, 100, 0.8)).toBeLessThan(0.001);
  });
});

describe("clamping", () => {
  it("moves the score of a series that claimed certainty", () => {
    expect(clampProbability(1)).toBe(0.99);
    expect(clampProbability(0)).toBe(0.01);
    const stats = factorCalibration(many(40, { marketKey: "points", predicted: 1 }, 30));
    expect(stats.find((s) => s.value === "points")!.predicted).toBeCloseTo(0.99, 5);
  });
});

describe("scopes never mix", () => {
  it("keeps an alternative out of the main pre-game population", () => {
    const rows = [...many(40, { marketKey: "pra" }, 32), ...many(40, { marketKey: "pra", alternative: true }, 4)];
    const stats = factorCalibration(rows);
    const main = stats.find((s) => s.scope === "pregame-main" && s.value === "pra")!;
    const alt = stats.find((s) => s.scope === "pregame-alt" && s.value === "pra")!;
    expect(main.legs).toBe(40);
    expect(alt.legs).toBe(40);
    expect(main.hitRate).not.toBeCloseTo(alt.hitRate, 2);
  });

  it("names the three populations by the two flags on the row", () => {
    expect(scopeOf({ scope: "live", alternative: false })).toBe("live");
    expect(scopeOf({ scope: "pre", alternative: true })).toBe("pregame-alt");
    expect(scopeOf({ scope: "pre", alternative: false })).toBe("pregame-main");
  });
});

describe("the dimensions", () => {
  it("tags a leg with everything that can slice it, and nothing it does not carry", () => {
    const tags = factorsOf(row({ period: 3, projectedMinutes: 31, blowoutProbability: 0.12, computed: 0.62, clvPct: 4.1 }));
    const dims = tags.map((t) => t.dim);
    expect(dims).toContain("minutesBucket");
    expect(dims).toContain("blowoutBucket");
    expect(dims).toContain("clvBucket");
    expect(dims).toContain("computedGapBucket");
    expect(factorsOf(row()).map((t) => t.dim)).not.toContain("minutesBucket");
  });

  it("puts the buckets where the reader expects them", () => {
    expect(oddsBucket(1.38)).toBe("1-1.5x");
    expect(oddsBucket(45)).toBe("20x+");
    expect(minutesBucket(31)).toBe("28-34 min");
    expect(blowoutBucket(0.5)).toBe("40%+");
    expect(clvBucket(-1)).toBe("negative CLV");
    expect(clvBucket(null)).toBeNull();
    expect(computedGapBucket(0.8, 0.62)).toBe("10+ pts");
    expect(computedGapBucket(0.8, undefined)).toBeNull();
  });
});
