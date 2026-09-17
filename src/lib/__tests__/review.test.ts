import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BetSuggestion, LedgerEntry } from "@/lib/types";

const DIR = path.join(process.cwd(), "data", "unit-review");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });
const { evidenceFor, getOrCreateReview, cachedReview, reviewForViewer, reviewPrompt, settledLegLines, reviewStats } = await import("@/lib/ledger/review");
const { savePrediction } = await import("@/lib/server/predictions");

const entry: LedgerEntry = {
  id: "g1:mid:Mais de 2,5 gols|Ambas marcam", gameId: "g1", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00Z", settledAt: "2026-09-11T21:00:00Z",
  bandKey: "mid", kind: "parlay", title: "Jogo aberto", combinedDecimal: 4.6, modelledProbability: 0.22, outcome: "lost",
  legs: [
    { selection: "Mais de 2,5 gols", market: "total", sourceBasis: "book line", predictedProbability: 0.55, oddsDecimal: 2.3, outcome: "lost", actual: "total 2 vs line 2.5" },
    { selection: "Ambas marcam", market: "total", sourceBasis: "book line", predictedProbability: 0.6, oddsDecimal: 2.0, outcome: "won", actual: "both scored" },
  ],
};
const sug = (id: string, title: string, legs: string[], background: string): BetSuggestion => ({
  id, kind: "parlay", bandKey: "mid", title, background, legs: legs.map((l) => ({ selection: l, market: "total", odds: "2.00", oddsDecimal: 2, explanation: `porque ${l}`, evidence: "Linha da Betano", fairProbability: 0.55 })),
  combinedDecimal: 4.6, combinedAmerican: "+360", impliedProbability: 0.22, modelledProbability: 0.22, edgePct: 1, riskNote: "risco", confidence: "low", evidenceScore: 52, evidenceNotes: ["nota"],
});

describe("loss review", () => {
  it("formats the settled legs with predicted probability, price and the actual result", () => {
    const lines = settledLegLines(entry, "pt");
    expect(lines[0]).toBe("✗ Mais de 2,5 gols (total, previsto 55%, 2.30x) — real: total 2 vs line 2.5");
    expect(lines[1]).toBe("✓ Ambas marcam (total, previsto 60%, 2.00x) — real: both scored");
    expect(settledLegLines(entry, "en")[0]).toContain("predicted 55%");
  });
  it("finds the ticket's own pre-game reasoning in the stored slate, in the reader's language when it exists", () => {
    expect(evidenceFor(entry, "pt")).toBeNull();
    savePrediction({ scope: "game", sportKey: "soccer-esp", gameId: "g1", dateKey: "20260911", lang: "pt", slate: { suggestions: [sug("p9", "Jogo aberto", ["Mais de 2,5 gols", "Ambas marcam"], "Os dois times marcam muito.")], dataNote: "" } });
    savePrediction({ scope: "game", sportKey: "soccer-esp", gameId: "g1", dateKey: "20260911", lang: "en", slate: { suggestions: [sug("p9", "Open game", ["Over 2.5 goals", "Both teams score"], "Both sides score a lot.")], dataNote: "" } });
    expect(evidenceFor(entry, "pt")?.background).toBe("Os dois times marcam muito.");
    expect(evidenceFor(entry, "en")?.background).toBe("Both sides score a lot.");
    expect(evidenceFor(entry, "en")?.legs[0].selection).toBe("Over 2.5 goals");
    expect(evidenceFor({ ...entry, bandKey: "safe" }, "pt")).toBeNull();
  });
  it("builds a prompt that carries the actuals and the reasoning, and forbids naming sources", () => {
    const { system, prompt } = reviewPrompt(entry, evidenceFor(entry, "pt"), "pt");
    expect(prompt).toContain("total 2 vs line 2.5");
    expect(prompt).toContain("Os dois times marcam muito.");
    expect(prompt).toContain("LOST");
    expect(system).toMatch(/Never name data providers/);
    expect(system).toContain("Brazilian Portuguese");
    expect(reviewPrompt(entry, null, "en").prompt).toContain("not available for this ticket");
  });
  it("generates once per ticket and language, then serves the cache", async () => {
    let calls = 0;
    const fn = async () => { calls += 1; return { assumed: "Muitos gols, como na Betano.", happened: "Saíram 2 gols.", verdict: "variance" as const, reasoning: "55% perde mesmo.", keyLeg: "Mais de 2,5 gols", watchNext: ["Conferir escalação"] }; };
    const first = await getOrCreateReview(entry, "pt", fn);
    expect(first.cached).toBe(false);
    expect(first.review.verdict).toBe("variance");
    const second = await getOrCreateReview(entry, "pt", fn);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
    expect(cachedReview(entry.id, "pt")?.review.keyLeg).toBe("Mais de 2,5 gols");
    expect(cachedReview(entry.id, "en")).toBeNull();
    await getOrCreateReview(entry, "en", fn);
    expect(calls).toBe(2);
    expect(reviewStats().reviews).toBe(2);
  });
  it("rejects a malformed model answer instead of caching it", async () => {
    await expect(getOrCreateReview({ ...entry, id: "other" }, "pt", async () => ({ assumed: "x" }) as never)).rejects.toThrow();
    expect(cachedReview("other", "pt")).toBeNull();
  });
  it("scrubs source names for non-admins and leaves them for the admin", () => {
    const review = cachedReview(entry.id, "pt")!.review;
    expect(reviewForViewer(review, "user", "pt").assumed).toBe("Muitos gols, como na casa de apostas.");
    expect(reviewForViewer(review, "admin", "pt").assumed).toContain("Betano");
    expect(reviewForViewer({ ...review, keyLeg: null }, "user", "pt").keyLeg).toBeNull();
  });
});
