import { describe, expect, it } from "vitest";
import path from "node:path";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-builder");
const { priceSuggestion } = await import("@/lib/bets/builder");
type Raw = import("@/lib/bets/builder").RawSuggestion;

const leg = (selection: string, odds: string): Raw["legs"][number] => ({
  selection, market: "total", odds, book: null, explanation: "", evidence: "measured", fairProbability: 0.6,
  settlementType: "total", settlementTeam: null, settlementPlayer: null, settlementStat: null, settlementLine: 2.5, settlementSide: "over",
  sourceBasis: "book line", gameId: null,
});
const raw = (legs: Raw["legs"]): Raw => ({ kind: legs.length > 1 ? "parlay" : "single", isAlternative: false, title: "t", background: "b", legs, riskNote: "r", confidence: "medium" });

describe("priceSuggestion", () => {
  it("prices a ticket whose every leg has a published price", () => {
    const s = priceSuggestion(raw([leg("Over 2.5", "1.90"), leg("Home win", "2.10")]), "value", 0);
    expect(s?.combinedDecimal).toBeCloseTo(3.99, 2);
    expect(Number.isFinite(s?.edgePct)).toBe(true);
  });
  it("drops a ticket with any unpriced leg instead of showing a smaller payout", () => {
    expect(priceSuggestion(raw([leg("Over 2.5", "1.90"), leg("Agoumé 1+ foul", "")]), "value", 0)).toBeNull();
    expect(priceSuggestion(raw([leg("Agoumé 1+ foul", "—")]), "safe", 0)).toBeNull();
  });
});
