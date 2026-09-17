import { describe, expect, it } from "vitest";
import path from "node:path";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-builder");
const { priceSuggestion, priceAll, independentGames } = await import("@/lib/bets/builder");
type Raw = import("@/lib/bets/builder").RawSuggestion;

const leg = (selection: string, odds: string): Raw["legs"][number] => ({
  selection, market: "total", odds, book: null, explanation: "", evidence: "measured", fairProbability: 0.6,
  settlementType: "total", settlementTeam: null, settlementPlayer: null, settlementStat: null, settlementLine: 2.5, settlementSide: "over",
  sourceBasis: "book line", gameId: null,
});
const raw = (legs: Raw["legs"]): Raw => ({ kind: legs.length > 1 ? "parlay" : "single", alternativeOf: null, swapReason: null, title: "t", background: "b", legs, riskNote: "r", confidence: "medium" });

describe("priceSuggestion", () => {
  it("prices a ticket whose every leg has a published price", () => {
    const s = priceSuggestion(raw([leg("Over 2.5", "1.90"), leg("Home win", "2.10")]), "value");
    expect(s?.combinedDecimal).toBeCloseTo(3.99, 2);
    expect(Number.isFinite(s?.edgePct)).toBe(true);
  });
  it("drops a ticket with any unpriced leg instead of showing a smaller payout", () => {
    expect(priceSuggestion(raw([leg("Over 2.5", "1.90"), leg("Agoumé 1+ foul", "")]), "value")).toBeNull();
    expect(priceSuggestion(raw([leg("Agoumé 1+ foul", "—")]), "safe")).toBeNull();
  });
});

describe("priceAll", () => {
  const prop = (player: string, line: number, decimal: number, athleteId: string) => ({
    player, market: "Points", marketKey: "points", athleteId, line, side: "over" as const, odds: decimal.toFixed(2), decimal, book: "DraftKings", priced: true, openDecimal: 1.95, noVigFair: 0.52,
    measured: { stat: "PTS", line, side: "over" as const, last5: { hits: 4, of: 5 }, last10: { hits: 7, of: 10 }, season: { hits: 20, of: 30 }, average: 20, median: 20, impliedFair: 0.66, sampleNote: "" },
  });
  const propLeg = (player: string, line: number, odds: string, gameId: string | null = null): Raw["legs"][number] => ({
    ...leg(`${player} over ${line} points`, odds), market: "player prop", settlementType: "player_prop", settlementPlayer: player, settlementStat: "points", settlementLine: line, gameId,
  });
  const ctx = { props: [prop("Ana Lima", 18.5, 1.87, "11"), prop("Bia Souza", 6.5, 2.4, "22")], sportKey: "wnba" };

  it("replaces a mistyped price with the posted one and attaches the measured record", () => {
    const [bet] = priceAll([raw([propLeg("Ana Lima", 18.5, "2.50")])], ctx);
    expect(bet.legs[0].oddsDecimal).toBe(1.87);
    expect(bet.legs[0]).toMatchObject({ athleteId: "11", openOdds: 1.95, measured: { last5: "4/5", season: "20/30" } });
    expect(bet.combinedDecimal).toBeCloseTo(1.87, 5);
  });

  it("prices a prop-only ticket that carries a posted price, with a finite EV", () => {
    const [bet] = priceAll([raw([propLeg("Ana Lima", 18.5, ""), propLeg("Bia Souza", 6.5, "")])], ctx);
    expect(bet.combinedDecimal).toBeCloseTo(1.87 * 2.4, 5);
    expect(Number.isFinite(bet.edgePct)).toBe(true);
  });

  it("drops a cross-game ticket with two legs from one game", () => {
    const same = raw([propLeg("Ana Lima", 18.5, "", "g1"), propLeg("Bia Souza", 6.5, "", "g1")]);
    const apart = raw([propLeg("Ana Lima", 18.5, "", "g1"), propLeg("Bia Souza", 6.5, "", "g2")]);
    expect(priceAll([same], ctx, { oneLegPerGame: true })).toEqual([]);
    expect(priceAll([apart], ctx, { oneLegPerGame: true })).toHaveLength(1);
    expect(independentGames({ legs: [{ gameId: "g1" }, { gameId: undefined }] as never })).toBe(false);
  });

  it("links an alternative to its main ticket's final id after sorting", () => {
    const main = raw([leg("Over 2.5", "3.00")]);
    const cheap = raw([leg("Under 4.5", "1.40")]);
    const alt = { ...raw([leg("Over 1.5", "2.20")]), alternativeOf: 0, swapReason: "se a linha subir" };
    const out = priceAll([main, cheap, alt], { props: [], sportKey: "soccer-bra" });
    expect(out.map((b) => b.combinedDecimal)).toEqual([1.4, 2.2, 3]);
    const mainId = out.find((b) => b.combinedDecimal === 3)!.id;
    expect(out.find((b) => b.combinedDecimal === 2.2)).toMatchObject({ alternativeFor: mainId, swapReason: "se a linha subir" });
    expect(mainId).toMatch(/^value-[0-9a-f]{8}$/);
  });
});
