import { describe, expect, it } from "vitest";
import { canonicalMarket, canonicalStat, marketKeyOf } from "@/lib/ledger/stat-key";

/**
 * The names have to collapse before any slice of the ledger means anything. These are the exact
 * spellings the production ledger carries today.
 */
describe("canonicalStat", () => {
  it("collapses the six spellings of points + rebounds + assists", () => {
    const spellings = ["PRA", "pra", "Points + Rebounds + Assists", "points_rebounds_assists", "Pontos + Rebotes + Assistências", "P+R+A"];
    const keys = spellings.map((s) => canonicalStat(s, "wnba"));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("pra");
  });

  it("collapses threes however they are written", () => {
    for (const s of ["3PM", "3-pointers made", "threes", "Bolas de 3"]) expect(canonicalStat(s, "wnba")).toBe("threes");
  });

  it("returns null for a label nobody knows, instead of inventing a bucket", () => {
    expect(canonicalStat("double-double", "wnba")).toBeNull();
    expect(canonicalStat("", "wnba")).toBeNull();
    expect(canonicalStat(undefined, "wnba")).toBeNull();
  });

  it("does not borrow another sport's meaning of the same word", () => {
    expect(canonicalStat("assists", "wnba")).toBe("assists");
    expect(canonicalStat("assists", "soccer-bra")).toBe("assists");
    // Basketball assists are AST, soccer assists are A: the keys are the sport's own.
    expect(canonicalStat("rebounds", "soccer-bra")).toBeNull();
  });

  it("is pure — the same input always gives the same key", () => {
    expect(canonicalStat("PRA", "wnba")).toBe(canonicalStat("PRA", "wnba"));
  });
});

describe("canonicalMarket", () => {
  it("keeps team markets under their own names", () => {
    expect(canonicalMarket({ settlement: { type: "moneyline" } }, "wnba")).toBe("moneyline");
    expect(canonicalMarket({ settlement: { type: "total" } }, "wnba")).toBe("total");
  });

  it("names a player prop by its stat, not by 'player_prop'", () => {
    expect(canonicalMarket({ market: "player_prop", settlement: { type: "player_prop", stat: "PRA" } }, "wnba")).toBe("pra");
  });

  it("sends the unknown to a bucket that is visible, never to silence", () => {
    expect(marketKeyOf({ market: "player_prop", settlement: { type: "player_prop", stat: "double-double" } }, "wnba")).toBe("unmapped");
  });
});
