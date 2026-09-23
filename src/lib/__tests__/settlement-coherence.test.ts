import { describe, expect, it } from "vitest";
import { settlementIsCoherent } from "@/lib/bets/builder";

const leg = (over: Partial<Parameters<typeof settlementIsCoherent>[0]>) => settlementIsCoherent({
  selection: "x", settlementType: "player_prop", settlementPlayer: "A B", settlementStat: "rebounds",
  settlementLine: 8.5, settlementSide: "under", settlementTeam: null, sourceBasis: "measured history", ...over,
});

// 22/09/2026: "Kamilla Cardoso under 8.5 rebotes" came out typed as a game total and was settled
// against the final score — 182 vs 8.5 — losing a ticket for a reason that had nothing to do with it.
describe("a settlement has to describe the bet its own text describes", () => {
  it("refuses a player's line typed as a game total", () => {
    expect(leg({ selection: "Kamilla Cardoso under 8.5 rebotes", settlementType: "total", settlementPlayer: null, settlementStat: null })).toBe(false);
    expect(leg({ selection: "Kamilla Cardoso menos de 8,5 rebotes", settlementType: "other", settlementPlayer: null })).toBe(false);
  });
  it("accepts a real game total and a real player prop", () => {
    expect(leg({ selection: "Mais de 158,5 pontos no jogo", settlementType: "total", settlementPlayer: null, settlementStat: null, settlementLine: 158.5, settlementSide: "over" })).toBe(true);
    expect(leg({ selection: "Kamilla Cardoso menos de 8,5 rebotes" })).toBe(true);
  });
  it("refuses a player prop missing any part the grader needs", () => {
    expect(leg({ settlementPlayer: null })).toBe(false);
    expect(leg({ settlementStat: null })).toBe(false);
    expect(leg({ settlementLine: null })).toBe(false);
    expect(leg({ settlementSide: "home" })).toBe(false);
  });
  it("refuses the catch-all type, which nothing can grade", () => {
    expect(leg({ settlementType: "other", selection: "algo esquisito", settlementPlayer: null, settlementStat: null })).toBe(false);
  });
  it("wants a team on a moneyline and on a spread, and no player", () => {
    expect(leg({ settlementType: "moneyline", settlementTeam: "CHI", settlementPlayer: null, selection: "Chicago Sky vence" })).toBe(true);
    expect(leg({ settlementType: "moneyline", settlementTeam: null, settlementPlayer: null })).toBe(false);
    expect(leg({ settlementType: "spread", settlementTeam: "CHI", settlementPlayer: null, settlementLine: -5.5, selection: "Chicago -5,5" })).toBe(true);
  });
});
