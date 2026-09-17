import { describe, expect, it } from "vitest";
import { groupAlternatives, legDiff, linkAlternatives, ticketId } from "@/lib/bets/alternatives";
import type { BetSuggestion } from "@/lib/types";

const bet = (sel: string[], decimal: number): BetSuggestion => ({
  id: ticketId("value", sel), kind: sel.length > 1 ? "parlay" : "single", bandKey: "value", title: sel.join("+"), background: "",
  legs: sel.map((s) => ({ selection: s, market: "total", odds: "2", oddsDecimal: 2, explanation: "", evidence: "", fairProbability: 0.5 })),
  combinedDecimal: decimal, combinedAmerican: "+100", impliedProbability: 1 / decimal, modelledProbability: 0.3, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: 60, evidenceNotes: [],
});

describe("linkAlternatives", () => {
  it("promotes an alternative whose main ticket was dropped", () => {
    const out = linkAlternatives([
      { alternativeOf: null, swapReason: null, priced: null },
      { alternativeOf: 0, swapReason: "x", priced: bet(["a"], 2) },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].alternativeFor).toBeUndefined();
    expect(out[0].swapReason).toBeUndefined();
  });

  it("trims a main ticket's alternatives to two, keeping the model's order", () => {
    const out = linkAlternatives([
      { alternativeOf: null, swapReason: null, priced: bet(["m"], 3) },
      { alternativeOf: 0, swapReason: "1", priced: bet(["a1"], 2.5) },
      { alternativeOf: 0, swapReason: "2", priced: bet(["a2"], 2.6) },
      { alternativeOf: 0, swapReason: "3", priced: bet(["a3"], 2.7) },
    ]);
    expect(out.filter((b) => b.alternativeFor).map((b) => b.swapReason)).toEqual(["1", "2"]);
  });

  it("does not chain an alternative onto another alternative or onto itself", () => {
    const out = linkAlternatives([
      { alternativeOf: null, swapReason: null, priced: bet(["m"], 3) },
      { alternativeOf: 0, swapReason: "ok", priced: bet(["a"], 2) },
      { alternativeOf: 1, swapReason: "chain", priced: bet(["b"], 2.1) },
      { alternativeOf: 3, swapReason: "self", priced: bet(["c"], 2.2) },
      { alternativeOf: 9, swapReason: "nowhere", priced: bet(["d"], 2.3) },
    ]);
    expect(out.filter((b) => b.alternativeFor)).toHaveLength(1);
    expect(groupAlternatives(out)).toHaveLength(4);
  });

  it("keeps a duplicate leg set once", () => {
    const out = linkAlternatives([
      { alternativeOf: null, swapReason: null, priced: bet(["m"], 3) },
      { alternativeOf: null, swapReason: null, priced: bet(["m"], 3) },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("legDiff", () => {
  it("names what an alternative removes and adds", () => {
    expect(legDiff(bet(["a", "b"], 3), bet(["a", "c"], 3))).toEqual({ removed: ["b"], added: ["c"], kept: ["a"] });
  });
});
