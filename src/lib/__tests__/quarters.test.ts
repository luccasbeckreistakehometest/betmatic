import { describe, expect, it } from "vitest";
import { EMPTY_QUARTERS, narrationTotals, parseQuarterProfiles, playClock, quartersBySubtraction, quartersPrompt, reconcileQuarters, type StoredSnapshot } from "@/lib/live/quarters";
import summary from "./fixtures/espn-summary-wnba-401857206-plays.json";

/**
 * ATL @ NY, 22/09, read at half-time: 198 narrated plays over two periods. The box score in the same
 * payload is the answer sheet — if the walk over the narration does not reproduce it, the walk is
 * wrong, and this is the only way to know that without watching the game.
 */
interface FixtureAthlete { athlete: { id: string; displayName: string }; starter?: boolean; didNotPlay?: boolean; stats?: string[] }
interface FixturePlay { period: { number: number }; type: { id: string }; clock: { displayValue: string }; participants?: { athlete: { id: string } }[] }
interface Fixture {
  plays: FixturePlay[];
  boxscore: { players: { team: { abbreviation: string; id: string }; statistics: { labels: string[]; athletes: FixtureAthlete[] }[] }[] };
}
const fixture = summary as unknown as Fixture;

const box = (name: string): Record<string, string> => {
  for (const group of fixture.boxscore.players) {
    const stat = group.statistics[0];
    const row = stat.athletes.find((a) => a.athlete.displayName === name);
    if (row) return Object.fromEntries(stat.labels.map((label, i) => [label, row.stats![i]]));
  }
  throw new Error(`no box score row for ${name}`);
};

const profiles = parseQuarterProfiles(fixture, 10);
const of = (name: string) => profiles.players.find((p) => p.name === name)!;

describe("the clock a play carries", () => {
  it("reads both shapes ESPN prints, and refuses anything else", () => {
    expect(playClock("10:00")).toBe(10);
    expect(playClock("4:04")).toBeCloseTo(4.067, 3);
    // Inside the last minute ESPN drops to bare seconds; reading "34.6" as 34 minutes would hand a
    // player a stint three times the length of the period.
    expect(playClock("34.6")).toBeCloseTo(0.577, 3);
    expect(playClock("0.0")).toBe(0);
    expect(playClock("")).toBeNull();
    expect(playClock(undefined)).toBeNull();
  });
});

describe("what the narration sustains", () => {
  it("reads the game", () => {
    expect(profiles.plays).toBe(198);
    expect(profiles.periods).toEqual([1, 2]);
    expect(profiles.players).toHaveLength(17);
    expect(profiles.notes).toEqual([]);
  });

  it("reproduces every counting stat in the box score, for every player who played", () => {
    for (const player of profiles.players) {
      const truth = box(player.name);
      const got = narrationTotals(player);
      expect({ name: player.name, pts: got.pts, reb: got.reb, ast: got.ast, pf: got.pf, stl: got.stl, tov: got.tov, blk: got.blk }).toEqual({
        name: player.name,
        pts: Number(truth.PTS), reb: Number(truth.REB), ast: Number(truth.AST),
        pf: Number(truth.PF), stl: Number(truth.STL), tov: Number(truth.TO), blk: Number(truth.BLK),
      });
    }
  });

  it("reproduces the minutes to within ESPN's own rounding", () => {
    // ESPN publishes MIN as a whole number, so the box score itself is only accurate to half a
    // minute. Every player lands inside that, and the five on the floor account for the whole game.
    let worst = 0;
    for (const player of profiles.players) {
      const mins = narrationTotals(player).minutes!;
      expect(mins).not.toBeNull();
      worst = Math.max(worst, Math.abs(mins - Number(box(player.name).MIN)));
    }
    expect(worst).toBeLessThanOrEqual(0.5);
    // Two sides, five on the floor, two periods of ten minutes: 200 player-minutes, and the walk
    // accounts for all of them (the 0.1 is the per-period rounding, not a player gone missing).
    const total = profiles.players.reduce((sum, p) => sum + narrationTotals(p).minutes!, 0);
    expect(Math.abs(total - 2 * 5 * 2 * 10)).toBeLessThanOrEqual(0.5);
    expect(profiles.minutesThrough).toBe(2);
  });

  it("splits the quarter the accumulated box score hides", () => {
    // The case the owner described: 12 points at half-time, and the model could not see that 10 of
    // them were the first quarter and 2 the second.
    const astier = of("Pauline Astier");
    expect(box("Pauline Astier").PTS).toBe("12");
    expect(astier.periods.map((p) => p.pts)).toEqual([10, 2]);
    // And the reverse shape, which is what a live over is bought on.
    const jones = of("Jonquel Jones");
    expect(jones.periods.map((p) => p.pts)).toEqual([3, 7]);
    expect(jones.periods.map((p) => p.minutes)).toEqual([7.2, 10]);
  });

  it("gives a starter who never left the floor the whole period", () => {
    expect(of("Breanna Stewart").periods[0].minutes).toBe(10);
  });
});

describe("what it refuses to sustain", () => {
  it("has nothing to say about a game ESPN has not narrated", () => {
    expect(parseQuarterProfiles({ boxscore: fixture.boxscore }, 10)).toEqual(EMPTY_QUARTERS);
    expect(parseQuarterProfiles({}, 10)).toEqual(EMPTY_QUARTERS);
  });

  it("stops the minutes at the period where the floor stops adding up, and keeps the stats", () => {
    // A change between periods that ESPN never narrated: a player who never took the floor turns up
    // in a second-quarter play. The walk cannot see the swap, so Q2 minutes are not measured — but
    // the second quarter's points are narrated plays and stand.
    const doctored = structuredClone(fixture);
    const q2 = doctored.plays.find((p) => p.period.number === 2 && p.type.id !== "584" && p.participants?.length)!;
    q2.participants = [{ athlete: { id: "4790258" } }]; // Raquel Carrera, a DNP
    const out = parseQuarterProfiles(doctored, 10);
    expect(out.minutesThrough).toBe(1);
    expect(out.notes[0]).toContain("was not narrated");
    const stewart = out.players.find((p) => p.name === "Breanna Stewart")!;
    expect(stewart.periods[0].minutes).toBe(10);
    expect(stewart.periods[1].minutes).toBeNull();
    expect(narrationTotals(stewart).minutes).toBeNull();
    expect(narrationTotals(stewart).pts).toBe(9);
  });

  it("refuses the walk when a substitution takes off a player who is not on the floor", () => {
    const doctored = structuredClone(fixture);
    const sub = doctored.plays.find((p) => p.type.id === "584")!;
    sub.participants = [{ athlete: { id: sub.participants![0].athlete.id } }, { athlete: { id: "4790258" } }];
    const out = parseQuarterProfiles(doctored, 10);
    expect(out.minutesThrough).toBe(0);
    expect(out.notes[0]).toContain("without being on it");
    expect(out.players.every((p) => p.periods.every((q) => q.minutes === null))).toBe(true);
  });

  it("refuses the walk when a substitution carries no clock", () => {
    const doctored = structuredClone(fixture);
    doctored.plays.find((p) => p.type.id === "584")!.clock = { displayValue: "" };
    const out = parseQuarterProfiles(doctored, 10);
    expect(out.minutesThrough).toBe(0);
    expect(out.notes[0]).toContain("no readable clock");
  });

  it("refuses the walk when a side does not field five", () => {
    const doctored = structuredClone(fixture);
    doctored.boxscore.players[0].statistics[0].athletes.find((a) => a.starter)!.starter = false;
    const out = parseQuarterProfiles(doctored, 10);
    expect(out.minutesThrough).toBe(0);
    expect(out.notes[0]).toContain("not 5");
  });
});

describe("the subtraction, and whether it agrees with the narration", () => {
  /**
   * What the product actually stores: the accumulated box score at the moment of each read. The Q1
   * read stored the Q1 accumulation; the half-time read stored the real box score out of the same
   * payload — which is ESPN's own number, not one this suite computed. Subtracting the first from
   * the second must give back the second quarter the narration read off the plays.
   */
  const snapshotAt = (period: number): StoredSnapshot => ({
    period,
    players: profiles.players.map((p) => {
      const upto = p.periods.filter((q) => q.period <= period);
      const sum = (key: "pts" | "reb" | "ast" | "pf" | "stl" | "tov" | "blk") => upto.reduce((n, q) => n + q[key], 0);
      return {
        id: p.id, name: p.name, team: p.team,
        stats: {
          PTS: sum("pts"), REB: sum("reb"), AST: sum("ast"), PF: sum("pf"), STL: sum("stl"), TO: sum("tov"), BLK: sum("blk"),
          // ESPN publishes MIN whole, so that is what a stored read holds — rounding and all.
          MIN: Math.round(upto.reduce((n, q) => n + (q.minutes ?? 0), 0)),
        },
      };
    }),
  });

  const halfTime: StoredSnapshot = {
    period: 2,
    players: profiles.players.map((p) => {
      const truth = box(p.name);
      return { id: p.id, name: p.name, team: p.team, stats: { PTS: Number(truth.PTS), REB: Number(truth.REB), AST: Number(truth.AST), PF: Number(truth.PF), STL: Number(truth.STL), TO: Number(truth.TO), BLK: Number(truth.BLK), MIN: Number(truth.MIN) } };
    }),
  };

  it("recovers the second quarter from two stored reads, and agrees with the narration on every cell", () => {
    const subtracted = quartersBySubtraction([snapshotAt(1), halfTime]);
    expect(subtracted).toHaveLength(17);
    const astier = subtracted.find((p) => p.name === "Pauline Astier")!;
    expect(astier.periods.map((q) => q.pts)).toEqual([10, 2]);

    const agreement = reconcileQuarters(profiles, subtracted);
    expect(agreement.notes).toEqual([]);
    expect(agreement.agreed).toBe(agreement.compared);
    // 17 players × 2 periods × (7 counting stats + minutes).
    expect(agreement.compared).toBe(17 * 2 * 8);
  });

  it("will not call a period a quarter when the read before it was never stored", () => {
    // The product joined the game at half-time: one snapshot, at period 2. Q2 alone cannot be
    // isolated from it — everything up to half-time is one figure — so no period is emitted.
    expect(quartersBySubtraction([halfTime])).toEqual([]);
    // With period 1 the baseline is zero, which is a real baseline and not an assumption.
    expect(quartersBySubtraction([snapshotAt(1)])[0].periods.map((q) => q.period)).toEqual([1]);
  });

  it("never returns a negative quarter when a read arrives out of order", () => {
    const late = { period: 2, players: [{ id: "x", name: "X", team: "NY", stats: { PTS: 4, MIN: 6 } }] };
    const early = { period: 1, players: [{ id: "x", name: "X", team: "NY", stats: { PTS: 9, MIN: 9 } }] };
    const [player] = quartersBySubtraction([early, late]);
    expect(player.periods.find((q) => q.period === 2)).toMatchObject({ pts: 0, minutes: 0 });
  });

  it("reports a disagreement instead of silently preferring one route", () => {
    const wrong = quartersBySubtraction([snapshotAt(1), {
      period: 2,
      players: halfTime.players.map((p) => (p.name === "Jonquel Jones" ? { ...p, stats: { ...p.stats, PTS: 99 } } : p)),
    }]);
    const agreement = reconcileQuarters(profiles, wrong);
    expect(agreement.agreed).toBeLessThan(agreement.compared);
    expect(agreement.notes.join(" ")).toContain("Jonquel Jones Q2 PTS: narration 7, subtraction 96");
  });
});

describe("the block the model reads", () => {
  const block = quartersPrompt(profiles, { lastComplete: 2 });

  it("gives each player the trajectory and then the total, and never only the total", () => {
    expect(block).toContain("- Pauline Astier (NY, starter): Q1 10pt 1rb 1as 2pf 7.3min · Q2 2pt 0rb 0as 8.6min → accumulated 12pt 1rb 1as 15.9min");
    expect(block).toContain("- DeWanna Bonner (ATL, bench):");
    // Ten players, one line each: the block sits beside the others in the prompt, it does not bury them.
    expect(block.split("\n").filter((l) => l.startsWith("- ") && l.includes("accumulated"))).toHaveLength(10);
  });

  it("says which quarter has just ended, so current is not read as history", () => {
    expect(block).toContain("THE QUARTER THAT HAS JUST ENDED IS Q2");
  });

  it("names who changed, with the two rates it is claiming", () => {
    expect(block).toContain("Pauline Astier went quiet: 1.37pts/min before Q2, 0.23 in it");
    // A player who was scoreless has no rate to double, and is not described as if he had one.
    expect(block).toContain("Rhyne Howard woke up: scoreless before Q2, 4pt at 0.40/min in it");
    expect(block).not.toMatch(/accelerated: 0\.00pts\/min/);
  });

  it("marks a quarter still in play as partial rather than as a finished one", () => {
    expect(quartersPrompt(profiles, { lastComplete: 1 })).toContain("Q2 2pt 0rb 0as 8.6min SO FAR (still in play)");
  });

  it("says plainly when the minutes are not measured, and does not let them read as zero", () => {
    const doctored = structuredClone(fixture);
    doctored.plays.find((p) => p.period.number === 2 && p.type.id !== "584" && p.participants?.length)!.participants = [{ athlete: { id: "4790258" } }];
    const partial = quartersPrompt(parseQuarterProfiles(doctored, 10), { lastComplete: 2 });
    expect(partial).toContain("Q2 2pt 0rb 0as min not measured");
    expect(partial).toContain("MINUTES ARE NOT MEASURED BEYOND Q1");
    expect(partial).toContain("was not narrated");
    // With no minutes there is no rate, so nothing is claimed about who changed.
    expect(partial).not.toContain("WHAT CHANGED");
  });

  it("says it has nothing rather than inventing a block, when ESPN has not narrated the game", () => {
    expect(quartersPrompt(EMPTY_QUARTERS, { lastComplete: 2 })).toBe("QUARTER BY QUARTER: not computed — ESPN has published no play-by-play for this game.");
  });
});
