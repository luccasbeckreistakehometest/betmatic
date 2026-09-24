import { describe, expect, it } from "vitest";
import { EMPTY_QUARTERS, narrationTotals, parseQuarterProfiles, playClock } from "@/lib/live/quarters";
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
