import { describe, expect, it } from "vitest";
import { expectedValue, impliedProbability, parlayDecimal, parlayHold } from "@/lib/odds";
import { expectedCards, cardsOverProbability, LEAGUE_CARDS_BASELINE } from "@/lib/signals/cards";
import { expectedSaves } from "@/lib/signals/saves";
import { poissonAtLeast } from "@/lib/live/state";
import { scrubSlate } from "@/lib/server/whitelabel";
import type { BetSlate } from "@/lib/types";

describe("odds math", () => {
  it("prices a parlay as the product of its legs", () => {
    expect(parlayDecimal([1.5, 2, 3])).toBeCloseTo(9, 10);
  });

  it("reports hold as the gap between implied and fair, not its inverse", () => {
    // -110 both sides: implied 0.5238 each, fair 0.5. A single leg holds 4.55%.
    const hold = parlayHold([1.909, 1.909], [0.5, 0.5]);
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeCloseTo(0.0889, 4); // two legs compound the single-leg 4.55%
  });

  it("refuses to price EV when the leg counts disagree", () => {
    // Silently zipping mismatched arrays would label a two-leg ticket with one leg's edge.
    expect(expectedValue([2, 3], [0.5])).toBeNaN();
  });

  it("treats implied probability as the reciprocal of decimal odds", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5, 10);
  });
});

describe("card model", () => {
  it("scales the teams' own rate by the referee rather than replacing it", () => {
    // The Flamengo loss: the referee averaged 5.46, but both sides were disciplined.
    const disciplined = expectedCards({
      homeCardsPerGame: 0.8,
      awayCardsPerGame: 1.2,
      refereeCardsPerGame: 5.46,
    });
    // Referee-only reasoning gave 68% for over 4.5 and the match produced 3 cards.
    expect(cardsOverProbability(4.5, disciplined)).toBeLessThan(0.55);
  });

  it("flags which inputs had to be assumed", () => {
    const partial = expectedCards({
      homeCardsPerGame: null,
      awayCardsPerGame: 1.5,
      refereeCardsPerGame: null,
    });
    expect(partial.assumed).toContain("mandante");
    expect(partial.assumed).toContain("árbitro");
    // With no referee measured the factor must be neutral, not invented.
    expect(partial.refereeFactor).toBe(1);
    expect(partial.teamsExpected).toBeCloseTo(LEAGUE_CARDS_BASELINE / 2 + 1.5, 10);
  });
});

describe("save model", () => {
  it("routes shots through an on-target rate before subtracting goals", () => {
    // 18 shots at 17% on target, conceding 0.06 — the actual keeper made 3 saves.
    const s = expectedSaves({ opponentShotsPerGame: 18, onTargetRate: 0.17, expectedGoalsConceded: 0.06 });
    expect(s.savesExpected).toBeGreaterThan(2.5);
    expect(s.savesExpected).toBeLessThan(3.5);
  });
});

describe("poisson tail", () => {
  it("rises with the rate and falls with the threshold", () => {
    expect(poissonAtLeast(5, 4.7)).toBeGreaterThan(poissonAtLeast(5, 3.9));
    expect(poissonAtLeast(6, 4.7)).toBeLessThan(poissonAtLeast(5, 4.7));
  });
});

describe("whitelabel", () => {
  const slate = (): BetSlate => ({
    dataNote: "Preços lidos na Betano e no ESPN.",
    suggestions: [
      {
        id: "t-0", kind: "single", bandKey: "value", title: "Teste",
        background: "A Betano abriu essa linha.", legs: [
          {
            selection: "X", market: "Y", odds: "2.00", oddsDecimal: 2, book: "Betano",
            explanation: "Pela escada da Betano.", evidence: "Dados do ESPN.",
            fairProbability: 0.5,
            settlement: { type: "other", sourceBasis: "escada da Betano" },
          },
        ],
        combinedDecimal: 2, combinedAmerican: "+100", impliedProbability: 0.5,
        modelledProbability: 0.5, edgePct: 0, riskNote: "Risco na Betano.",
        confidence: "medium", evidenceScore: 100, evidenceNotes: ["medido na Betano"],
      },
    ],
  });

  it("leaves the admin slate untouched", () => {
    expect(JSON.stringify(scrubSlate(slate(), "admin", "pt"))).toContain("Betano");
  });

  it("removes every book and source name for a paying user", () => {
    // Hiding these in the UI still ships them to the browser, so the cut has to happen here.
    const blob = JSON.stringify(scrubSlate(slate(), "user", "pt"));
    for (const name of ["Betano", "ESPN"]) expect(blob).not.toContain(name);
  });

  it("scrubs the book field, not just the prose", () => {
    const out = scrubSlate(slate(), "user", "pt");
    expect(out.suggestions[0].legs[0].book).toBe("Casa de apostas");
  });

  it("agrees the Portuguese article with the replacement's gender", () => {
    // "da Betano" (f) must not become "do casa de apostas".
    const out = scrubSlate(slate(), "user", "pt");
    expect(out.suggestions[0].legs[0].settlement?.sourceBasis).toBe("escada da casa de apostas");
  });
});
