import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry, SettledLeg } from "@/lib/types";

/**
 * Measured on 23/09/2026, the two records are nowhere near each other: pre-game player props
 * promised 57,8% and delivered 49,6% over 234 settled legs, while the live reads promised 86,3%
 * and delivered 71,7% over 593. Correcting a live leg with the pre-game gap would fix about a
 * quarter of what is wrong with it, so a read taken with the game under way has to answer to the
 * live record and nothing else.
 */

const DIR = path.join(process.cwd(), "data", "unit-calibration-scope");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
fs.rmSync(DIR, { recursive: true, force: true });

const { calibrate } = await import("@/lib/ledger/calibrate");
const { buildCalibrator, calibratorFor } = await import("@/lib/ledger/recalibrate");

const leg = (predicted: number, won: boolean): SettledLeg => ({
  selection: "Alguém menos de 10,5 pontos",
  market: "player_prop",
  sourceBasis: "measured history",
  predictedProbability: predicted,
  oddsDecimal: 1.6,
  outcome: won ? "won" : "lost",
});

/** `n` settled legs on one scope: `won` of them landed, each having claimed `predicted`. */
function entries(scope: "pre" | "live", n: number, won: number, predicted: number): LedgerEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${scope}-${i}`,
    gameId: `g${i}`,
    sportKey: "wnba",
    matchup: "A @ B",
    createdAt: "2026-09-22T20:00:00.000Z",
    startsAt: "2026-09-22T23:00:00.000Z",
    bandKey: "value",
    kind: "single" as const,
    title: "teste",
    combinedDecimal: 1.6,
    modelledProbability: predicted,
    outcome: (i < won ? "won" : "lost") as LedgerEntry["outcome"],
    legs: [leg(predicted, i < won)],
    ...(scope === "live" ? { scope: "live" as const } : {}),
  }));
}

// Pre-game claims 60% and lands 50%. Live claims 90% and lands 70% — far worse, as measured.
fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
fs.writeFileSync(
  path.join(DIR, "ledger", "predictions.jsonl"),
  [...entries("pre", 100, 50, 0.6), ...entries("live", 100, 70, 0.9)].map((e) => JSON.stringify(e)).join("\n") + "\n",
  "utf8",
);

describe("the record that answers for a ticket", () => {
  it("reads only its own scope's legs", () => {
    const pre = calibrate(20, "pre").byMarket.find((r) => r.key === "player_prop")!;
    const live = calibrate(20, "live").byMarket.find((r) => r.key === "player_prop")!;

    expect(pre.settled).toBe(100);
    expect(pre.hitRate).toBeCloseTo(0.5, 2);
    expect(pre.averagePredicted).toBeCloseTo(0.6, 2);

    expect(live.settled).toBe(100);
    expect(live.hitRate).toBeCloseTo(0.7, 2);
    expect(live.averagePredicted).toBeCloseTo(0.9, 2);
  });

  it("corrects a live claim much harder than the same claim made before tip-off", () => {
    const beforeTipoff = calibratorFor("pre").apply(0.9, "measured history", "player_prop");
    const underWay = calibratorFor("live").apply(0.9, "measured history", "player_prop");

    expect(beforeTipoff.probability).toBeLessThan(0.9);
    expect(underWay.probability).toBeLessThan(beforeTipoff.probability);
    // The live record is the harsher one, and borrowing the pre-game gap would leave most of the
    // overconfidence standing.
    expect(beforeTipoff.probability - underWay.probability).toBeGreaterThan(0.05);
  });

  it("still says nothing on a scope with no sample", () => {
    const empty = buildCalibrator({ totalSettled: 0, bySource: [], byMarket: [], bySport: [], generatedAt: "" });
    expect(empty.apply(0.9, "measured history", "player_prop").correction).toBeNull();
    expect(empty.apply(0.9, "measured history", "player_prop").probability).toBe(0.9);
  });
});
