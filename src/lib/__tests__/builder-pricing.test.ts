import { describe, expect, it } from "vitest";
import path from "node:path";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-builder");
const { priceSuggestion, priceAll, independentGames, describeModel, describeProps, minutesFromProps } = await import("@/lib/bets/builder");
const { anchoredProbability, ANCHOR_BAND, enrichLeg } = await import("@/lib/bets/enrich");
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
  // A real candidate row carries the rate model: bets/gates.ts will not emit a prop leg without one.
  const rateModel = { computed: 0.6, distribution: 0.6, pOver: 0.6, pUnder: 0.4, mean: 20, sd: 6, rate: 0.66, recentRate: 0.7, dispersion: 0.09,
    minutes: { expected: 30, sd: 4, availability: "ok" as const }, ladder: [], note: "0.66/min × 30 ± 4 min → 20.0 ± 6.0" };
  const prop = (player: string, line: number, decimal: number, athleteId: string) => ({
    player, market: "Points", marketKey: "points", athleteId, line, side: "over" as const, odds: decimal.toFixed(2), decimal, book: "DraftKings", priced: true, openDecimal: 1.95, noVigFair: 0.52,
    measured: { stat: "PTS", line, side: "over" as const, last5: { hits: 4, of: 5 }, last10: { hits: 7, of: 10 }, season: { hits: 20, of: 30 }, average: 20, median: 20, impliedFair: 0.66, sampleNote: "" },
    model: rateModel,
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


describe("the computed probability in the builder", () => {
  const model = (computed: number, over = computed): NonNullable<import("@/lib/types").PropRow["model"]> => ({
    computed, distribution: computed, pOver: over, pUnder: 1 - over, mean: 20, sd: 6, rate: 0.66, recentRate: 0.7, dispersion: 0.09,
    minutes: { expected: 30, sd: 4, availability: "ok" }, ladder: [{ line: 17.5, pOver: 0.7, pUnder: 0.3 }, { line: 18.5, pOver: 0.6, pUnder: 0.4 }, { line: 19.5, pOver: 0.45, pUnder: 0.55 }], note: "0.66/min × 30 ± 4 min → 20.0 ± 6.0",
  });
  const prop = (player: string, athleteId: string, computed: number, series?: { eventId: string; value: number; minutes: number }[]) => ({
    player, team: "DAL", market: "Points", marketKey: "points", athleteId, line: 18.5, side: "over" as const, odds: "1.90", decimal: 1.9, book: "DraftKings", priced: true, noVigFair: 0.5,
    measured: { stat: "PTS", line: 18.5, side: "over" as const, last5: { hits: 3, of: 5 }, last10: { hits: 6, of: 10 }, season: { hits: 24, of: 42 }, average: 20, median: 20, impliedFair: 0.57, sampleNote: "" },
    model: model(computed), series, minutesProjection: { player, expected: 30, sd: 4, availability: "ok" as const, note: "30 ± 4 min" },
  });
  const propLeg = (player: string, fair: number): Raw["legs"][number] => ({
    ...leg(`${player} over 18.5 points`, ""), market: "player prop", settlementType: "player_prop", settlementPlayer: player, settlementStat: "points", settlementLine: 18.5, fairProbability: fair,
  });

  it("pulls fairProbability inside the band around the computed number and records it on the leg", () => {
    expect(anchoredProbability(0.7, 0.45)).toBeCloseTo(0.45 + ANCHOR_BAND, 6);
    expect(anchoredProbability(0.3, 0.45)).toBeCloseTo(0.45 - ANCHOR_BAND, 6);
    expect(anchoredProbability(0.5, 0.45)).toBe(0.5);
    expect(anchoredProbability(0.7, undefined)).toBe(0.7);
    const [bet] = priceAll([raw([propLeg("Ana Lima", 0.75)])], { props: [prop("Ana Lima", "11", 0.45)], sportKey: "wnba" });
    expect(bet.legs[0].fairProbability).toBeCloseTo(0.53, 6);
    expect(bet.legs[0].computedProbability).toBe(0.45);
    expect(bet.legs[0].modelNote).toMatch(/0\.66\/min/);
    expect(bet.modelledProbability).toBeCloseTo(0.53, 6);
    expect(bet.edgePct).toBeCloseTo((0.53 * 1.9 - 1) * 100, 6);
  });

  it("keeps the model's raw estimate beside the anchored one, and leaves a LISTED OUT player unanchored", () => {
    const [bet] = priceAll([raw([propLeg("Ana Lima", 0.75)])], { props: [prop("Ana Lima", "11", 0.45)], sportKey: "wnba" });
    expect(bet.legs[0].rawProbability).toBe(0.75);
    expect(bet.legs[0].fairProbability).toBeCloseTo(0.53, 6);
    // Listed out: the computed number assumes she plays, so it must not pull a 20% up to 68%. The
    // ticket itself no longer reaches a reader — bets/gates.ts drops it before tip-off — but enrich
    // still has to leave the number alone for the paths that price such a leg anyway.
    const out = { ...prop("Ana Lima", "11", 0.76), model: { ...model(0.76), minutes: { expected: 32, sd: 5, availability: "listed_out" as const } } };
    expect(priceAll([raw([propLeg("Ana Lima", 0.2)])], { props: [out], sportKey: "wnba" })).toEqual([]);
    const enriched = enrichLeg(
      { selection: "Ana Lima over 18.5 points", market: "player prop", odds: "1.90", oddsDecimal: 1.9, explanation: "", evidence: "", fairProbability: 0.2 },
      { settlementType: "player_prop", settlementPlayer: "Ana Lima", settlementStat: "points", settlementLine: 18.5, settlementSide: "over", settlementTeam: null },
      { props: [out], sportKey: "wnba" },
    );
    expect(enriched.fairProbability).toBe(0.2);
    expect(enriched.computedProbability).toBe(0.76);
    expect(enriched.rawProbability).toBe(0.2);
  });

  it("drops a ticket with two rungs of the same stat on one player instead of showing an edge no book pays", () => {
    const ladder = [{ ...prop("Ana Lima", "11", 0.7), line: 18.5, decimal: 1.5, odds: "1.50" }, { ...prop("Ana Lima", "11", 0.4), line: 20.5, decimal: 2.6, odds: "2.60" }];
    const two = raw([{ ...propLeg("Ana Lima", 0.7), settlementLine: 18.5, selection: "Ana Lima over 18.5 points" }, { ...propLeg("Ana Lima", 0.4), settlementLine: 20.5, selection: "Ana Lima over 20.5 points" }]);
    expect(priceAll([two], { props: ladder, sportKey: "wnba" })).toEqual([]);
    // The same pair with the second rung priced from the model's text (not in the feed) is still one player.
    const unmatched = raw([{ ...propLeg("Ana Lima", 0.7), settlementLine: 18.5, selection: "Ana Lima over 18.5 points" }, { ...propLeg("Ana Lima", 0.4), settlementLine: 22.5, selection: "Ana Lima over 22.5 points", odds: "3.10" }]);
    expect(priceAll([unmatched], { props: ladder, sportKey: "wnba" })).toEqual([]);
    // An impossible pair is dropped the same way.
    const dead = raw([{ ...propLeg("Ana Lima", 0.4), settlementLine: 25.5, selection: "Ana Lima over 25.5 points", odds: "3.00" }, { ...propLeg("Ana Lima", 0.4), settlementLine: 20.5, settlementSide: "under", selection: "Ana Lima under 20.5 points", odds: "1.90" }]);
    expect(priceAll([dead], { props: ladder, sportKey: "wnba" })).toEqual([]);
    // One rung alone is fine.
    expect(priceAll([raw([{ ...propLeg("Ana Lima", 0.7), settlementLine: 18.5 }])], { props: ladder, sportKey: "wnba" })).toHaveLength(1);
  });

  it("resolves a leg the feed did not carry to its player, so two legs on one player are never strangers", () => {
    const ctx = { props: [prop("Ana Lima", "11", 0.6)], sportKey: "wnba" };
    const rebounds: Raw["legs"][number] = { ...propLeg("Ana Lima", 0.6), settlementStat: "rebounds", settlementLine: 6.5, selection: "Ana Lima over 6.5 rebounds", odds: "1.90" };
    // In play, where the pre-game availability gate does not run: a leg the feed never carried is
    // exactly what that gate drops before tip-off, and the resolution below is what prices it live.
    const [bet] = priceAll([raw([propLeg("Ana Lima", 0.6), rebounds])], ctx, { live: true });
    expect(bet.legs[1].athleteId).toBeUndefined();
    expect(bet.correlation).toBeDefined();
    expect(bet.correlation!.note).toMatch(/same player, different stats/);
    expect(bet.modelledProbability).toBeCloseTo(0.6 * 0.6 * 1.05, 3);
  });

  it("applies the same-game correlation to the ticket's probability and prints it", () => {
    const series = (values: number[]) => values.map((v, i) => ({ eventId: `e${i}`, value: v, minutes: 30 }));
    const together = Array.from({ length: 20 }, (_, i) => (i < 12 ? 25 : 10));
    const ctx = { props: [prop("Ana Lima", "11", 0.6, series(together)), prop("Bia Souza", "22", 0.6, series(together))], sportKey: "wnba" };
    const [bet] = priceAll([raw([propLeg("Ana Lima", 0.6), propLeg("Bia Souza", 0.6)])], ctx);
    expect(bet.correlation).toBeDefined();
    expect(bet.correlation!.independentProbability).toBeCloseTo(0.36, 6);
    expect(bet.correlation!.factor).toBeGreaterThan(1);
    expect(bet.modelledProbability).toBeCloseTo(0.36 * bet.correlation!.factor, 2);
    expect(bet.correlation!.note).toMatch(/measured ×/);
    // A cross-game ticket keeps its legs independent.
    const apart = priceAll([raw([{ ...propLeg("Ana Lima", 0.6), gameId: "g1" }, { ...propLeg("Bia Souza", 0.6), gameId: "g2" }])], ctx, { oneLegPerGame: true });
    expect(apart[0].correlation).toBeUndefined();
    expect(apart[0].modelledProbability).toBeCloseTo(0.36, 6);
  });

  it("describes the computed side of a candidate, before tip-off and in play", () => {
    const row = prop("Ana Lima", "11", 0.45);
    const text = describeModel(row);
    expect(text).toMatch(/COMPUTED 45% \(distribution 45%; 0\.66\/min × 30 ± 4 min → 20\.0 ± 6\.0; minutes 30 ± 4; rate 0\.66\/min, L5 0\.7\/min\)/);
    expect(text).toMatch(/\[ladder o17\.5 70%, o19\.5 45%\]/);
    expect(describeModel({ ...row, model: null })).toBe("");
    const live = { ...row, live: { current: 10, remaining: 9, minutesLeft: 20 }, model: { ...model(0.62), live: { needed: 9, remainingMinutes: 16, needPerMinute: 0.563, ratePerMinuteTonight: 0.625, ratePerMinutePreGame: 0.66, ratePerMinuteBlended: 0.64, minutesPlayed: 16, fouls: 4 } } };
    const liveText = describeModel(live);
    expect(liveText).toMatch(/COMPUTED 62% — needs 9 more in ~16 min = 0\.56\/min, vs 0\.63\/min tonight \(16 min played, 4 PF\), 0\.66\/min pre-game \(the rate used for the rest\)/);
    // An under has room, not a requirement.
    const under = { ...live, side: "under" as const, model: { ...live.model, live: { ...live.model.live, needed: 3, needPerMinute: 0.188 } } };
    expect(describeModel(under)).toMatch(/room for 3 more in ~16 min = 0\.19\/min/);
    const full = { ...under, model: { ...under.model, live: { ...under.model.live, needed: 0, needPerMinute: 0 } } };
    expect(describeModel(full)).toMatch(/no room left: the next one busts it/);
    const clockOut = { ...live, model: { ...live.model, live: { ...live.model.live, needed: 2, remainingMinutes: 0, needPerMinute: 99 } } };
    expect(describeModel(clockOut)).toMatch(/needs 2 more in ~0 min = ∞\/min/);
    expect(describeProps([live])).toContain("PRE-GAME REFERENCE");
    expect(describeProps([live])).toContain(liveText.trim());
    expect(minutesFromProps([row, { ...row, line: 20.5 }]).map((m) => m.player)).toEqual(["Ana Lima"]);
  });
});
