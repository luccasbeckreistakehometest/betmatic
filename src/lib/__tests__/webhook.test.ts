import { describe, expect, it } from "vitest";
import { ticketAnnouncement } from "@/lib/server/webhook";
import type { BetSuggestion } from "@/lib/types";

const s = (title: string, score: number, source = "Betano"): BetSuggestion => ({
  id: title, kind: "single", bandKey: "value", title, background: `Preço lido na ${source}.`, legs: [{ selection: "Sevilha vence", market: "moneyline", odds: "2.00", oddsDecimal: 2, book: source, explanation: "x", evidence: `Escada da ${source}`, fairProbability: 0.5 }],
  combinedDecimal: 2, combinedAmerican: "+100", impliedProbability: 0.5, modelledProbability: 0.5, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: score, evidenceNotes: [],
});

describe("ticket announcement", () => {
  it("posts the three best-evidenced tickets with permalinks, and never a source name", () => {
    const out = ticketAnnouncement({ gameId: "g1", matchup: "Valencia @ Sevilla", sportKey: "soccer-esp", lang: "pt", base: "https://x.y", suggestions: [s("a", 40), s("b", 90), s("c", 70), s("d", 10)] });
    expect(out.tickets.map((t) => t.title)).toEqual(["b", "c", "a"]);
    expect(out.content).toContain("https://x.y/p/");
    expect(out.content).toContain("Bilhetes novos");
    expect(JSON.stringify(out)).not.toMatch(/Betano/);
  });
});
