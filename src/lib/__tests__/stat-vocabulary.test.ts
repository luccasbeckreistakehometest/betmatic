import { describe, expect, it } from "vitest";
import { compositeStatLabels, resolveStatLabels } from "@/lib/props/history";

/**
 * Written on 23/09/2026 after reading the record. 57 settled legs had been written off as "não é
 * possível medir", and 56 of them were three strings the vocabulary simply did not know: PTS+AST
 * (20), REB+AST (19) and PTS+REB (17). The cost was not a blank cell — A'ja Wilson played 32
 * minutes for 10 rebounds and 2 assists, so "under 12,5 rebotes + assistências" landed on 12 and
 * WON, and it was voided; Chelsea Gray's "under 14,5 pontos + rebotes" finished on 20 and LOST, and
 * it was voided too. A public track record that silently drops the legs it cannot spell is not a
 * track record.
 *
 * The fix reads a combined market as its parts instead of matching it whole, because the model
 * writes the same bet a dozen ways.
 */

describe("a combined market read as its parts", () => {
  it("knows the abbreviations that were being thrown away", () => {
    expect(resolveStatLabels("PTS+AST", "wnba")).toEqual(["PTS", "AST"]);
    expect(resolveStatLabels("REB+AST", "wnba")).toEqual(["REB", "AST"]);
    expect(resolveStatLabels("PTS+REB", "wnba")).toEqual(["PTS", "REB"]);
  });

  it("reads the same bet however it was written", () => {
    const pra = ["PTS", "REB", "AST"];
    for (const spelling of [
      "PTS+REB+AST",
      "points_rebounds_assists",
      "points + rebounds + assists",
      "Pontos + Rebotes + Assistências",
      "Points and Assists".replace("Assists", "Rebounds and Assists"),
    ]) {
      expect(resolveStatLabels(spelling, "wnba"), spelling).toEqual(pra);
    }
    expect(resolveStatLabels("Pontos + Assistências", "wnba")).toEqual(["PTS", "AST"]);
    expect(resolveStatLabels("Rebotes + Assistências", "wnba")).toEqual(["REB", "AST"]);
  });

  it("puts the labels in one order, whatever order they were written in", () => {
    expect(compositeStatLabels("AST+PTS")).toEqual(["PTS", "AST"]);
    expect(compositeStatLabels("assists + rebounds")).toEqual(["REB", "AST"]);
  });

  it("stays unreadable when any part is unknown, rather than grading the half it understood", () => {
    expect(compositeStatLabels("PTS+minutos jogados no segundo tempo")).toBeNull();
    expect(resolveStatLabels("PTS+banana", "wnba")).toBeNull();
    expect(compositeStatLabels("double-double")).toBeNull();
  });

  it("leaves single markets to the patterns that already read them", () => {
    expect(compositeStatLabels("points")).toBeNull();
    expect(resolveStatLabels("points", "wnba")).toEqual(["PTS"]);
    expect(resolveStatLabels("PRA", "wnba")).toEqual(["PTS", "REB", "AST"]);
    expect(resolveStatLabels("3PM", "wnba")).toEqual(["3PT"]);
  });
});
