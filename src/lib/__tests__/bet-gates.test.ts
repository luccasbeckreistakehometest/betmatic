import { describe, expect, it } from "vitest";
import path from "node:path";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-gates");
const { capPlayerConcentration, playerKeysOf, MAX_PLAYER_SHARE } = await import("@/lib/bets/gates");
type Bet = import("@/lib/types").BetSuggestion;

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
