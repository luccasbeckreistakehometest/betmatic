import { describe, expect, it } from "vitest";
import { gateByRole, previousSeasonParam, rankCandidates } from "@/lib/props/candidates";
import { buildRoleFromStarts, buildRoleProfile, rolePrompt } from "@/lib/props/role";
import type { PlayerHistory, PropRow } from "@/lib/types";

const history = (minutes: number[]): PlayerHistory => ({
  athleteId: "x", player: "", team: "", availableStats: ["MIN", "PTS"],
  games: minutes.map((m, i) => ({ eventId: String(i), date: `2026-09-${String(20 - i).padStart(2, "0")}`, opponent: "OPP", homeAway: "vs", result: "", stats: { MIN: m, PTS: 10 } })),
});
const row = (player: string, gap: number, priced = true): PropRow => ({
  player, market: "Points", marketKey: "points", line: 9.5, side: "over", priced, decimal: priced ? 2 : undefined, noVigFair: priced ? 0.5 : null,
  measured: { stat: "PTS", line: 9.5, side: "over", last5: { hits: 3, of: 5 }, last10: { hits: 6, of: 10 }, season: { hits: 12, of: 20 }, average: 10, median: 10, impliedFair: 0.5 + gap, sampleNote: "" },
});

describe("minutes and role gate", () => {
  it("removes a 12-minute bench player's candidates before the prompt", () => {
    const starter = buildRoleProfile(history([34, 33, 35, 32, 36, 34]), "Starter", "basketball");
    const bench = buildRoleProfile(history([12, 11, 13, 12, 10, 14]), "Bench", "basketball");
    const { kept, dropped } = gateByRole([row("Starter", 0.1), row("Bench", 0.3)], new Map([["Starter", starter], ["Bench", bench]]), "basketball");
    expect(kept.map((r) => r.player)).toEqual(["Starter"]);
    expect(dropped).toEqual(["Bench"]);
  });

  it("drops a player whose role could not be read", () => {
    expect(gateByRole([row("Ghost", 0.2)], new Map(), "basketball").kept).toEqual([]);
  });

  it("gates soccer players on starts, since the log has no minutes", () => {
    const sub = buildRoleFromStarts("Sub", { starts: 1, subIns: 8, appearances: 9, startShare: 0.11 });
    const regular = buildRoleFromStarts("Regular", { starts: 8, subIns: 1, appearances: 9, startShare: 0.89 });
    const { kept } = gateByRole([row("Sub", 0.2), row("Regular", 0.1)], new Map([["Sub", sub], ["Regular", regular]]), "soccer");
    expect(kept.map((r) => r.player)).toEqual(["Regular"]);
  });

  it("prints real rows instead of 'not computed' once roles exist", () => {
    const starter = buildRoleProfile(history([34, 33, 35, 32, 36, 34]), "Starter", "basketball")!;
    expect(rolePrompt([starter])).not.toContain("not computed");
  });
});

describe("candidate ranking", () => {
  it("puts priced rows first, by measured gap, and keeps two rungs per player and market", () => {
    const ranked = rankCandidates([row("A", 0.05), row("A", 0.2), row("A", 0.1), row("B", 0.15), row("C", 0.4, false)]);
    expect(ranked.map((r) => `${r.player}:${r.measured!.impliedFair.toFixed(2)}`)).toEqual(["A:0.70", "B:0.65", "A:0.60", "C:0.90"]);
  });
});

describe("previous-season fallback", () => {
  it("asks ESPN for the NBA season that ended last, including from the October tip-off", () => {
    // ESPN: nba gamelog?season=2025 is 2024-25; the 2026-27 season starts in October 2026.
    expect(previousSeasonParam("nba", new Date("2026-09-17T12:00:00Z"))).toBe(2025);
    expect(previousSeasonParam("nba", new Date("2026-10-25T12:00:00Z"))).toBe(2026);
    expect(previousSeasonParam("nba", new Date("2026-12-31T23:00:00Z"))).toBe(2026);
    expect(previousSeasonParam("nba", new Date("2027-02-10T12:00:00Z"))).toBe(2026);
  });
  it("uses last calendar year for leagues numbered by the year they start", () => {
    expect(previousSeasonParam("wnba", new Date("2026-10-25T12:00:00Z"))).toBe(2025);
    expect(previousSeasonParam("soccer-bra", new Date("2026-10-25T12:00:00Z"))).toBe(2025);
  });
});
