import { describe, expect, it } from "vitest";
import { parseLiveSnapshot, soccerMinute } from "@/lib/live/snapshot";
import { normalCdf, ticketChance, trackLeg } from "@/lib/live/tracker";

const bbSummary = {
  header: { competitions: [{ status: { clock: 312, displayClock: "5:12", period: 3, type: { state: "in" } }, competitors: [
    { homeAway: "home", score: "58", team: { abbreviation: "CED" } }, { homeAway: "away", score: "61", team: { abbreviation: "DUN" } },
  ] }] },
  boxscore: { players: [{ team: { abbreviation: "CED" }, statistics: [{ labels: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"], athletes: [
    { athlete: { id: "7301", displayName: "Gabi Reis" }, stats: ["24", "14", "5-11", "2-4", "2-2", "5", "3", "1", "1", "0", "1", "4", "5", "+3"] },
    { athlete: { id: "7302", displayName: "Rosa Lima" }, stats: ["22", "8", "3-8", "0-1", "2-2", "9", "1", "2", "0", "1", "3", "6", "2", "-3"] },
  ] }] }] },
};
const prop = (player: string, stat: string, line: number, side: "over" | "under") => ({ type: "player_prop" as const, player, stat, line, side, sourceBasis: "" });

describe("live snapshot", () => {
  it("reads the clock, the score and per-player lines", () => {
    const s = parseLiveSnapshot(bbSummary, "g", "basketball", 10);
    expect(s).toMatchObject({ state: "in", period: 3, home: { abbr: "CED", score: 58 }, away: { abbr: "DUN", score: 61 } });
    expect(s.minute).toBeCloseTo(24.8, 1);
    expect(s.elapsed).toBeCloseTo(0.62, 2);
    expect(s.players[0].stats).toMatchObject({ PTS: 14, REB: 5, "3PT": 2, PF: 5, MIN: 24 });
    expect(soccerMinute("90'+3'")).toBe(90);
    expect(soccerMinute("67'")).toBe(67);
  });
});

describe("leg tracker", () => {
  const snap = parseLiveSnapshot(bbSummary, "g", "basketball", 10);
  it("marks an over already cleared as won and an under already passed as lost", () => {
    expect(trackLeg(prop("Gabi Reis", "points", 12.5, "over"), ["PTS"], snap).state).toBe("won");
    const busted = trackLeg(prop("Rosa Lima", "rebounds", 5.5, "under"), ["REB"], snap);
    expect(busted.state).toBe("lost");
    expect(busted.reason.pt).toContain("caiu: 9 contra 5.5");
    expect(ticketChance([trackLeg(prop("Gabi Reis", "points", 12.5, "over"), ["PTS"], snap), busted])).toBe(0);
  });

  it("flags foul trouble and lowers the chance of a far-away over", () => {
    const pre = { average: 16, minutes: 30 };
    const t = trackLeg(prop("Gabi Reis", "points", 22.5, "over"), ["PTS"], snap, pre);
    expect(t.state).toBe("alive");
    expect(t.flags).toContain("foul_trouble");
    expect(t.probability!).toBeLessThan(0.1);
    expect(t.reason.pt).toContain("faltam 9");
    const near = trackLeg(prop("Gabi Reis", "points", 15.5, "over"), ["PTS"], snap, pre);
    expect(near.probability!).toBeGreaterThan(t.probability!);
  });

  it("a football cards over at 70' with one card shown is a long shot", () => {
    const soccer = parseLiveSnapshot({
      header: { competitions: [{ status: { displayClock: "70'", period: 2, type: { state: "in" } }, competitors: [{ homeAway: "home", score: "1", team: { abbreviation: "TUP" } }, { homeAway: "away", score: "0", team: { abbreviation: "IPE" } }] }] },
      boxscore: { teams: [{ team: { abbreviation: "TUP" }, statistics: [{ name: "yellowCards", displayValue: "1" }] }, { team: { abbreviation: "IPE" }, statistics: [{ name: "yellowCards", displayValue: "0" }] }] },
    }, "s", "soccer");
    const t = trackLeg({ type: "other", stat: "cards", line: 4.5, side: "over", sourceBasis: "" }, null, soccer, { total: 5 });
    expect(t.state).toBe("alive");
    expect(t.probability!).toBeLessThan(0.05);
    const ml = trackLeg({ type: "moneyline", teamAbbreviation: "TUP", sourceBasis: "" }, null, soccer, { total: 2.5 });
    expect(ml.probability!).toBeGreaterThan(0.7);
  });

  it("scores a trailing home side below even and handles a finished game", () => {
    const ml = trackLeg({ type: "moneyline", teamAbbreviation: "CED", sourceBasis: "" }, null, snap);
    expect(ml.probability!).toBeLessThan(0.5);
    const final = { ...snap, state: "post" as const, elapsed: 1 };
    expect(trackLeg({ type: "moneyline", teamAbbreviation: "DUN", sourceBasis: "" }, null, final).state).toBe("won");
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});
