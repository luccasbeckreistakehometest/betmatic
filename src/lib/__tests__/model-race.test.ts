import { describe, expect, it } from "vitest";
import path from "node:path";
import type { LedgerEntry } from "@/lib/types";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-model-race");
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
const { modelRace, modelRaceLine } = await import("@/lib/ledger/calibrate");

const entry = (legs: { predicted: number; computed?: number; outcome: "won" | "lost" | "void" }[]): LedgerEntry => ({
  id: Math.random().toString(36).slice(2), gameId: "g", sportKey: "wnba", matchup: "A @ B", createdAt: "", bandKey: "mid", kind: "parlay", title: "t", combinedDecimal: 5, modelledProbability: 0.2, outcome: "lost",
  legs: legs.map((l) => ({ selection: "s", market: "player_prop", sourceBasis: "measured history", predictedProbability: l.predicted, computedProbability: l.computed, oddsDecimal: 1.9, outcome: l.outcome })),
});

describe("the computed model against the language model", () => {
  it("scores only the legs where both spoke and were settled", () => {
    const race = modelRace([
      entry([{ predicted: 0.8, computed: 0.5, outcome: "lost" }, { predicted: 0.6, computed: 0.7, outcome: "won" }, { predicted: 0.6, outcome: "won" }, { predicted: 0.5, computed: 0.5, outcome: "void" }]),
      { ...entry([{ predicted: 0.9, computed: 0.9, outcome: "won" }]), outcome: "pending" },
    ]);
    expect(race.settled).toBe(2);
    expect(race.won).toBe(1);
    expect(race.averagePredicted).toBeCloseTo(0.7, 6);
    expect(race.averageComputed).toBeCloseTo(0.6, 6);
    expect(race.brierPredicted).toBeCloseTo(((0.8 - 0) ** 2 + (0.6 - 1) ** 2) / 2, 6);
    expect(race.brierComputed).toBeCloseTo(((0.5 - 0) ** 2 + (0.7 - 1) ** 2) / 2, 6);
  });

  it("stays silent until ten legs have settled, then says which guide has been better", () => {
    expect(modelRaceLine(modelRace([entry([{ predicted: 0.8, computed: 0.5, outcome: "lost" }])]))).toBe("");
    const many = Array.from({ length: 12 }, (_, i) => entry([{ predicted: 0.9, computed: 0.6, outcome: i % 2 ? "won" : "lost" }]));
    const line = modelRaceLine(modelRace(many));
    expect(line).toMatch(/COMPUTED MODEL vs YOUR ESTIMATES \(12 settled legs, 50% won\)/);
    expect(line).toMatch(/the computed number has been the better guide/);
  });
});
