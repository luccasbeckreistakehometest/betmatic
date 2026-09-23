import { describe, expect, it } from "vitest";
import { freeCanSee, legsLabel, pickTeaser, teaserHeadline } from "@/lib/teaser";
import type { BetSuggestion } from "@/lib/types";

const bet = (bandKey: string, legs: number, evidenceScore: number, title = "Agoumé comete falta") =>
  ({ bandKey, evidenceScore, title, background: "Agoumé comete 1,81 faltas", legs: Array.from({ length: legs }, () => ({ selection: "Agoumé — 1+ falta" })) }) as unknown as BetSuggestion;

describe("ticket teaser", () => {
  it("describes the ticket's shape, never its title or selections", () => {
    expect(teaserHeadline(bet("safe", 1, 90), "pt")).toBe("Aposta simples · faixa Baixa");
    expect(teaserHeadline(bet("value", 3, 90), "pt")).toBe("Múltipla de 3 linhas · faixa Valor");
    expect(teaserHeadline(bet("mid", 2, 90), "en")).toBe("2-leg parlay · Mid band");
    expect(teaserHeadline(bet("value", 1, 90), "pt")).not.toMatch(/Agoumé/);
  });
  it("pluralises legs", () => {
    expect(legsLabel(1, "pt")).toBe("1 linha");
    expect(legsLabel(2, "pt")).toBe("2 linhas");
    expect(legsLabel(1, "en")).toBe("1 leg");
  });
  it("prefers a ticket a free account can open, and flags a paid one", () => {
    const safe = { bet: bet("safe", 1, 100) };
    const value = { bet: bet("value", 3, 80) };
    expect(freeCanSee(value.bet)).toBe(true);
    expect(pickTeaser([safe, value])).toMatchObject({ bet: value.bet, free: true });
    expect(pickTeaser([safe])).toMatchObject({ bet: safe.bet, free: false });
    expect(pickTeaser([])).toBeNull();
  });
});
