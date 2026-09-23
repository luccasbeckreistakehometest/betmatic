import { describe, expect, it } from "vitest";
import path from "node:path";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-gates");
const { capPlayerConcentration, playerKeysOf, unplayableReason, MAX_PLAYER_SHARE, MIN_MINUTES_FOR_VOLUME_OVER } = await import("@/lib/bets/gates");
const { priceAll } = await import("@/lib/bets/builder");
type Raw = import("@/lib/bets/builder").RawSuggestion;
type Bet = import("@/lib/types").BetSuggestion;
type Drop = import("@/lib/bets/gates").GateDrop;

/** A priced ticket, reduced to what the cap reads: its band, its quality and who it is a bet on. */
const ticket = (id: string, bandKey: string, players: string[], evidenceScore = 100, modelledProbability = 0.5): Bet => ({
  id, kind: players.length > 1 ? "parlay" : "single", bandKey, title: id, background: "", legs: players.map((p) => ({
    selection: `${p} over 10.5 points`, market: "player prop", odds: "1.90", oddsDecimal: 1.9, explanation: "", evidence: "measured",
    fairProbability: 0.6, athleteId: p, settlement: { type: "player_prop" as const, player: p, stat: "points", line: 10.5, side: "over" as const, sourceBasis: "measured history" },
  })), combinedDecimal: 1.9, combinedAmerican: "-111", impliedProbability: 0.53, modelledProbability, edgePct: 1,
  riskNote: "", confidence: "medium", evidenceScore, evidenceNotes: [],
});

describe("the by-player concentration cap", () => {
  it("counts by player, not by leg: two lines on one player are one night's exposure", () => {
    const bet = { legs: [
      { settlement: { type: "player_prop" as const, player: "Ariel Atkins", stat: "points", sourceBasis: "x" }, athleteId: "9" },
      { settlement: { type: "player_prop" as const, player: "ARIEL  ATKINS", stat: "rebounds", sourceBasis: "x" }, athleteId: "9" },
      { settlement: { type: "moneyline" as const, sourceBasis: "x" } },
    ] } as unknown as Bet;
    expect(playerKeysOf(bet)).toEqual(["id:9"]);
    // Without an athlete id the normalised name still keeps two spellings together.
    const unfeeded = { legs: [
      { settlement: { type: "player_prop" as const, player: "Chelsea Gray", stat: "PRA", sourceBasis: "x" } },
      { settlement: { type: "player_prop" as const, player: "chelsea  gray", stat: "points", sourceBasis: "x" } },
    ] } as unknown as Bet;
    expect(unfeeded.legs.length).toBe(2);
    expect(playerKeysOf(unfeeded)).toEqual(["name:chelsea gray"]);
  });

  it("drops the tickets over the cap instead of rewriting them, with the reason", () => {
    // Seven of nine tickets on one player: the shape of the build that put Isabelle Harrison in 10
    // of 15 and lost all ten.
    const bets = [
      ...Array.from({ length: 7 }, (_, i) => ticket(`h${i}`, "mid", ["harrison", `other${i}`], 100 - i)),
      ticket("a", "mid", ["gray"], 90),
      ticket("b", "mid", ["leite"], 80),
    ];
    const { kept, dropped } = capPlayerConcentration(bets);
    const share = kept.filter((b) => b.legs.some((l) => l.settlement?.player === "harrison")).length / kept.length;
    expect(share).toBeLessThanOrEqual(MAX_PLAYER_SHARE);
    expect(dropped.length).toBe(bets.length - kept.length);
    expect(dropped.every((d) => d.gate === "player_concentration")).toBe(true);
    expect(dropped[0].reason).toMatch(/already carries \d+ of the \d+ tickets/);
    // Nothing is rewritten: every surviving ticket is the object that went in.
    for (const k of kept) expect(bets).toContain(k);
  });

  it("keeps every band alive: the cap never empties one to protect another", () => {
    const bets = [
      ticket("safe", "safe", ["star"], 100, 0.8),
      ticket("value", "value", ["star", "x"], 99, 0.6),
      ticket("mid", "mid", ["star", "y"], 98, 0.4),
      ticket("long", "long", ["star", "z"], 97, 0.1),
    ];
    const { kept } = capPlayerConcentration(bets);
    // No band is emptied to protect another: every survivor comes from a band of its own.
    expect(new Set(kept.map((b) => b.bandKey)).size).toBe(kept.length);
    expect(kept.map((b) => b.bandKey)).toContain("safe");
  });

  it("collapses a build that is one idea written four times, because no subset satisfies the cap", () => {
    // Nine tickets that all needed Janelle Salaun's night went out on 22/09/2026 as nine tickets.
    const bets = ["safe", "value", "mid", "long"].map((band, i) => ticket(band, band, ["salaun"], 100 - i));
    const { kept, dropped } = capPlayerConcentration(bets);
    expect(kept.map((b) => b.id)).toEqual(["safe"]);
    expect(dropped).toHaveLength(3);
  });

  it("is deterministic and prefers the better-evidenced ticket over the first in the list", () => {
    const bets = [ticket("weak", "mid", ["star"], 40), ticket("strong", "mid", ["star"], 100), ticket("other", "mid", ["someone"], 60)];
    const first = capPlayerConcentration(bets);
    const again = capPlayerConcentration([...bets].reverse());
    expect(first.kept.map((b) => b.id).sort()).toEqual(again.kept.map((b) => b.id).sort());
    expect(first.kept.map((b) => b.id)).toContain("strong");
    expect(first.kept.map((b) => b.id)).not.toContain("weak");
  });

  it("takes an alternative down with its main, and never counts one as a second bet", () => {
    const alt: Bet = { ...ticket("alt", "mid", ["star"], 100), alternativeFor: "weak" };
    const bets = [ticket("weak", "mid", ["star"], 10), ticket("strong", "mid", ["star"], 100), ticket("other", "mid", ["someone"], 50), alt];
    const { kept, dropped } = capPlayerConcentration(bets);
    expect(kept.map((b) => b.id)).not.toContain("alt");
    expect(dropped.find((d) => d.ticketId === "alt")?.reason).toMatch(/its main ticket weak was dropped/);
    // "strong" survives although it shares the player: the alternative was never counted against it.
    expect(kept.map((b) => b.id)).toContain("strong");
  });

  it("leaves a build of one ticket alone", () => {
    const one = [ticket("only", "safe", ["star"])];
    expect(capPlayerConcentration(one)).toEqual({ kept: one, dropped: [] });
  });
});

describe("the availability gate", () => {
  const model = (over: Partial<NonNullable<import("@/lib/types").PropRow["model"]>> = {}) => ({
    computed: 0.6, distribution: 0.6, pOver: 0.6, pUnder: 0.4, mean: 20, sd: 6, rate: 0.66, recentRate: 0.7, dispersion: 0.09,
    minutes: { expected: 30, sd: 4, availability: "ok" as const }, ladder: [], note: "0.66/min × 30 ± 4 min → 20.0 ± 6.0", ...over,
  });
  const prop = (over: Record<string, unknown> = {}) => ({
    player: "Kayla McBride", team: "MIN", market: "Points", marketKey: "points", athleteId: "11", line: 18.5, side: "over" as const,
    odds: "1.90", decimal: 1.9, book: "DraftKings", priced: true, noVigFair: 0.5, model: model(), ...over,
  });
  const key = (over: Record<string, unknown> = {}) => ({
    settlementType: "player_prop", settlementPlayer: "Kayla McBride", settlementStat: "points", settlementLine: 18.5,
    settlementSide: "over", settlementTeam: null, ...over,
  } as import("@/lib/bets/enrich").LegKey);

  it("emits a line the rate model priced", () => {
    expect(unplayableReason([key()], { props: [prop()], sportKey: "wnba" })).toBeNull();
  });

  it("refuses a line on a player the report lists out, on either side", () => {
    const listed = model({ minutes: { expected: 32, sd: 5, availability: "listed_out" as const } });
    // The feed posts both sides of a line; the gate has to read the same flag on either of them.
    const out = [prop({ model: listed }), prop({ model: listed, side: "under" as const })];
    expect(unplayableReason([key()], { props: out, sportKey: "wnba" })).toMatch(/listed OUT/);
    expect(unplayableReason([key({ settlementSide: "under" })], { props: out, sportKey: "wnba" })).toMatch(/listed OUT/);
  });

  it("refuses a line the feed never carried, so no minutes stand behind it", () => {
    // Four of the six losing overs on a player who finished 0/0/0/0 were legs of exactly this kind.
    expect(unplayableReason([key({ settlementStat: "PTS+AST", settlementLine: 19.5 })], { props: [prop()], sportKey: "wnba" }))
      .toMatch(/no projected minutes/);
    expect(unplayableReason([key()], { props: [], sportKey: "wnba" })).toMatch(/no projected minutes/);
  });

  it("refuses an over on a volume stat under the minutes floor, and leaves the under alone", () => {
    const short = model({ minutes: { expected: MIN_MINUTES_FOR_VOLUME_OVER - 5, sd: 4, availability: "ok" as const } });
    const thin = [prop({ model: short }), prop({ model: short, side: "under" as const })];
    expect(unplayableReason([key()], { props: thin, sportKey: "wnba" })).toMatch(/projected minutes, under the 20/);
    expect(unplayableReason([key({ settlementSide: "under" })], { props: thin, sportKey: "wnba" })).toBeNull();
  });

  it("gates basketball only: a football prop has no candidate of this shape to read", () => {
    expect(unplayableReason([key({ settlementStat: "shots", settlementPlayer: "Yuri Alberto" })], { props: [], sportKey: "soccer-bra" })).toBeNull();
  });

  it("drops the whole ticket before tip-off, and stands down in play", () => {
    const raw = (): Raw => ({
      kind: "single", alternativeOf: null, swapReason: null, title: "t", background: "b", riskNote: "r", confidence: "medium",
      legs: [{ selection: "Kayla McBride over 19.5 PTS+AST", market: "player prop", odds: "1.90", book: null, explanation: "", evidence: "measured",
        fairProbability: 0.68, settlementType: "player_prop", settlementTeam: null, settlementPlayer: "Kayla McBride", settlementStat: "PTS+AST",
        settlementLine: 19.5, settlementSide: "over", sourceBasis: "measured history", gameId: null }],
    });
    const ctx = { props: [prop()], sportKey: "wnba" };
    const drops: Drop[] = [];
    expect(priceAll([raw()], ctx, { onDrop: (d) => drops.push(d) })).toEqual([]);
    expect(drops.map((d) => d.gate)).toEqual(["availability"]);
    // In play the projection reports the minutes that REMAIN and the report has nothing left to say.
    expect(priceAll([raw()], ctx, { live: true })).toHaveLength(1);
  });
});
