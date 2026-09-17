import { describe, expect, it } from "vitest";
import { filterPool, shrinkMeasured, solveCustomParlay, TOLERANCE, type CustomConstraints, type PoolLeg } from "@/lib/bets/custom-parlay";

const leg = (key: string, gameId: string, decimal: number, fair: number, measured = false, rate: number | null = null, market = "moneyline"): PoolLeg => ({
  key, gameId, matchup: gameId, selection: key, market, decimal, fairProbability: fair, measured, measuredRate: rate, evidence: "",
  settlement: { type: "moneyline", sourceBasis: "book line" },
});

// Eight games, two legs each: a short favourite and a longer price.
const pool: PoolLeg[] = Array.from({ length: 8 }, (_, g) => [
  leg(`g${g}-fav`, `g${g}`, 1.5 + g * 0.05, 0.62 - g * 0.01, true, 0.62 - g * 0.01, "points"),
  leg(`g${g}-dog`, `g${g}`, 2.6 + g * 0.1, 0.36 - g * 0.005),
]).flat();
const base: CustomConstraints = { target: 20, maxLegs: 8, measuredOnly: false, minRate: 0 };

describe("custom parlay solver", () => {
  it("hits a 20x target inside the tolerance, one leg per game, best chance first", () => {
    const out = solveCustomParlay(pool, base);
    expect(out.reachable).toBe(true);
    expect(out.tickets.length).toBe(3);
    for (const t of out.tickets) {
      expect(t.decimal).toBeGreaterThanOrEqual(20 * TOLERANCE.low);
      expect(t.decimal).toBeLessThanOrEqual(20 * TOLERANCE.high);
      expect(new Set(t.legs.map((l) => l.gameId)).size).toBe(t.legs.length);
      expect(t.fairProbability).toBeCloseTo(t.legs.reduce((a, l) => a * l.fairProbability, 1), 10);
    }
    expect(out.tickets[0].fairProbability).toBeGreaterThanOrEqual(out.tickets[1].fairProbability);
  });

  it("respects the measured-only filter and the minimum rate", () => {
    const measured = solveCustomParlay(pool, { ...base, target: 5, measuredOnly: true });
    expect(measured.tickets.every((t) => t.legs.every((l) => l.measured))).toBe(true);
    expect(filterPool(pool, { ...base, measuredOnly: true, minRate: 0.6 }).map((l) => l.key)).toEqual(["g0-fav", "g1-fav", "g2-fav"]);
  });

  it("says a 400x target is out of reach and names the nearest payout", () => {
    const small = pool.slice(0, 6); // three games
    const out = solveCustomParlay(small, { ...base, target: 400 });
    expect(out.reachable).toBe(false);
    expect(out.tickets).toEqual([]);
    expect(out.nearest).toBeCloseTo(2.6 * 2.7 * 2.8, 5);
    expect(out.reason).toBe("too_high");
  });

  it("is deterministic for the same input in any order", () => {
    const a = solveCustomParlay(pool, base).tickets.map((t) => t.legs.map((l) => l.key).join("+"));
    const b = solveCustomParlay([...pool].reverse(), base).tickets.map((t) => t.legs.map((l) => l.key).join("+"));
    expect(a).toEqual(b);
  });

  it("filters markets and games, and reports an empty pool", () => {
    expect(solveCustomParlay(pool, { ...base, markets: ["corners"] }).reason).toBe("empty_pool");
    const onlyTwo = solveCustomParlay(pool, { ...base, target: 3, gameIds: ["g0", "g1"] });
    expect(onlyTwo.tickets.every((t) => t.legs.every((l) => ["g0", "g1"].includes(l.gameId)))).toBe(true);
  });

  it("never reads a perfect sample as certain", () => {
    expect(shrinkMeasured(5, 5, 0.5)).toBeCloseTo(6 / 7, 6);
    expect(shrinkMeasured(0, 20, 0.5)).toBeCloseTo(1 / 22, 6);
  });
});
