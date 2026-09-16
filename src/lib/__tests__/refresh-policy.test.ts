import { describe, expect, it } from "vitest";
import { refreshConfig, shouldGenerate } from "@/lib/server/refresh-policy";
import { extractTexts, mergeTexts } from "@/lib/bets/localise";
import type { BetSlate } from "@/lib/types";

const H = 3_600_000;
const now = Date.parse("2026-09-16T12:00:00Z");
const at = (h: number) => new Date(now + h * H).toISOString();

describe("shouldGenerate", () => {
  it("generates a game it has never seen", () => {
    expect(shouldGenerate({ existingGeneratedAt: null, startsAt: at(8), now, prematchHours: 0 }).reason).toBe("missing");
  });
  it("never regenerates a fresh game when the pre-match refresh is off", () => {
    expect(shouldGenerate({ existingGeneratedAt: at(-10), startsAt: at(1), now, prematchHours: 0 }).generate).toBe(false);
  });
  it("refreshes once inside the pre-match window, then leaves it alone", () => {
    const first = shouldGenerate({ existingGeneratedAt: at(-10), startsAt: at(2), now, prematchHours: 3 });
    expect(first.reason).toBe("prematch");
    // regenerated inside the window → the next run sees it as fresh
    const again = shouldGenerate({ existingGeneratedAt: at(0), startsAt: at(2), now: now + 0.5 * H, prematchHours: 3 });
    expect(again.generate).toBe(false);
  });
  it("does not touch a game that already kicked off", () => {
    expect(shouldGenerate({ existingGeneratedAt: null, startsAt: at(-1), now, prematchHours: 3 }).reason).toBe("started");
  });
});

describe("refreshConfig", () => {
  const all = ["nba", "soccer-bra", "tennis-atp", "tennis-wta"];
  it("drops tennis by default and caps games at six", () => {
    const c = refreshConfig({}, all);
    expect(c.sports).toEqual(["nba", "soccer-bra"]);
    expect(c.maxGames).toBe(6);
    expect(c.langs).toEqual(["pt", "en"]);
    expect(c.prematchHours).toBe(0);
  });
  it("honours env and ignores unknown sports", () => {
    const c = refreshConfig({ CRON_SPORTS: "nba,cricket", CRON_MAX_GAMES: "3", CRON_LANGS: "pt", CRON_PREMATCH_REFRESH_HOURS: "2" }, all);
    expect(c).toEqual({ sports: ["nba"], maxGames: 3, langs: ["pt"], prematchHours: 2 });
  });
});

describe("localisation merge", () => {
  const slate: BetSlate = {
    dataNote: "nota",
    suggestions: [{
      id: "value-0", kind: "single", bandKey: "value", title: "T", background: "B", riskNote: "R", confidence: "medium",
      evidenceScore: 80, evidenceNotes: ["e1"], combinedDecimal: 2, combinedAmerican: "+100", impliedProbability: 0.5, modelledProbability: 0.55, edgePct: 10,
      legs: [{ selection: "S", market: "moneyline", odds: "2.00", oddsDecimal: 2, explanation: "x", evidence: "y", fairProbability: 0.55, settlement: { type: "moneyline", sourceBasis: "book" } }],
    }],
  };
  it("swaps only prose and keeps every number and settlement rule", () => {
    const texts = extractTexts(slate);
    texts.suggestions[0].title = "Título"; texts.suggestions[0].legs[0].explanation = "explicação";
    const out = mergeTexts(slate, texts);
    expect(out.suggestions[0].title).toBe("Título");
    expect(out.suggestions[0].legs[0].explanation).toBe("explicação");
    expect(out.suggestions[0].legs[0].oddsDecimal).toBe(2);
    expect(out.suggestions[0].edgePct).toBe(10);
    expect(out.suggestions[0].legs[0].settlement).toEqual(slate.suggestions[0].legs[0].settlement);
    expect(slate.suggestions[0].title).toBe("T"); // source untouched
  });
  it("keeps the source ticket when the rewrite lost a leg", () => {
    const texts = extractTexts(slate); texts.suggestions[0].legs = [];
    expect(mergeTexts(slate, texts).suggestions[0].legs).toHaveLength(1);
  });
});
