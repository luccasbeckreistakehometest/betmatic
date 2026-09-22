import { describe, expect, it } from "vitest";
import { scrubGame, scrubText } from "@/lib/server/whitelabel";

/**
 * The books' names are prices in the comparison (shown on purpose) and sources everywhere the
 * white-label hides sources: the model's prose reaches the public game page, the OG image, /prova,
 * Telegram and the webhook, and there "best 1.92 at Superbet" must read like any other source.
 */
const BOOKS = ["Superbet", "KTO", "EstrelaBet", "Aposta Ganha", "BetPix365", "LotoGreen", "Vaidebet", "Betfair Exchange", "Betfair", "Sportingbet", "Betnacional"];

describe("whitelabel and the Brazilian books", () => {
  it("neutralises every book the product reads, in Portuguese with the article agreed", () => {
    for (const book of BOOKS) {
      const out = scrubText(`Melhor preço na ${book} (1,95); a ${book} paga mais.`, "pt");
      expect(out, book).not.toContain(book);
      expect(out, book).toBe("Melhor preço na casa de apostas (1,95); a casa de apostas paga mais.");
    }
    expect(scrubText("O KTO abriu 1,88 e o Superbet 1,92.", "pt")).toBe("A casa de apostas abriu 1,88 e a casa de apostas 1,92.");
  });

  it("neutralises them in English too", () => {
    expect(scrubText("Best price at Superbet 1.95; Betfair Exchange trades 2.00; KTO and Sportingbet follow.", "en")).toBe("Best price at sportsbook 1.95; sportsbook trades 2.00; sportsbook and sportsbook follow.");
  });

  it("leaves the verb 'a aposta ganha' alone: only the capitalised book is a source", () => {
    expect(scrubText("Se a aposta ganha, o retorno é 2x; a Aposta Ganha paga 1,90.", "pt")).toBe("Se a aposta ganha, o retorno é 2x; a casa de apostas paga 1,90.");
  });

  it("drops a broadcast channel that names a book", () => {
    const game = { id: "1", sportKey: "wnba", startsAt: "2026-09-22T23:30:00Z", status: "scheduled" as const, statusDetail: "", home: { id: "1", abbreviation: "A", name: "A", displayName: "A" }, away: { id: "2", abbreviation: "B", name: "B", displayName: "B" }, broadcast: "Superbet TV" };
    expect(scrubGame(game, "user", "pt").broadcast).toBeUndefined();
    expect(scrubGame(game, "admin", "pt").broadcast).toBe("Superbet TV");
  });
});
