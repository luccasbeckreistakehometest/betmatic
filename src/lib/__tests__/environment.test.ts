import { describe, expect, it } from "vitest";
import { baselineBlowout, blowoutProbability, bookLine, currentSeasonParam, environmentFrom, environmentPrompt, formFromSchedule, regulationMinutes } from "@/lib/signals/environment";
import { projectRemainingMinutes } from "@/lib/props/minutes";
import type { GameDetail } from "@/lib/types";

const detail = (books: GameDetail["books"], odds?: GameDetail["game"]["odds"]): GameDetail => ({
  game: {
    id: "401857207", sportKey: "wnba", startsAt: "2026-09-22T02:00Z", status: "scheduled", statusDetail: "",
    home: { id: "11", abbreviation: "PHX", name: "Mercury", displayName: "Phoenix Mercury" },
    away: { id: "3", abbreviation: "DAL", name: "Wings", displayName: "Dallas Wings" },
    odds,
  },
  injuries: [], teamStats: { home: [], away: [] }, books, ats: [], leaders: [], lastMeetings: [], rosters: [],
});

describe("blowout probability", () => {
  it("rises with the spread, is symmetric in sign, and shrinks as the clock runs out", () => {
    const base = baselineBlowout(40);
    expect(base).toBeGreaterThan(0.15);
    expect(base).toBeLessThan(0.25);
    expect(blowoutProbability(5.5, 40)).toBeGreaterThan(base);
    expect(blowoutProbability(-5.5, 40)).toBeCloseTo(blowoutProbability(5.5, 40), 6);
    expect(blowoutProbability(14, 40)).toBeGreaterThan(0.4);
    // Up 24 with five minutes left is decided; level with five left is not.
    expect(blowoutProbability(0, 40, 5, 24)).toBeGreaterThan(0.95);
    expect(blowoutProbability(0, 40, 5, 0)).toBeLessThan(0.01);
    expect(blowoutProbability(0, 40, 0, 16)).toBe(1);
    expect(regulationMinutes("wnba")).toBe(40);
    expect(regulationMinutes("nba")).toBe(48);
  });
});

describe("blowout probability in play", () => {
  // The spread is the home handicap and the margin is home minus away: a home favourite at -12
  // leading by 12 at half-time is expected to win by 18. The first version added the spread with
  // the wrong sign and read that game as a 15% blowout — a starter gaining fourth-quarter minutes.
  it("drifts the margin toward the favourite over the minutes left", () => {
    expect(blowoutProbability(-12, 40, 20, 12)).toBeCloseTo(0.64, 2);
    expect(blowoutProbability(12, 40, 20, 12)).toBeCloseTo(0.148, 2);
    // Dallas @ Phoenix at half-time: home underdog +5.5 trailing by 4 is expected to lose by more.
    expect(blowoutProbability(5.5, 40, 20, -4)).toBeGreaterThan(blowoutProbability(-5.5, 40, 20, -4));
    // Before tip-off the sign cannot matter.
    expect(blowoutProbability(-7, 40)).toBeCloseTo(blowoutProbability(7, 40), 9);
  });

  it("takes minutes off a favourite's starter who is already up big, not a dog's", () => {
    const pre = { player: "s", expected: 34, sd: 3, baseline: { recent5: 34, recent10: 34, season: 34, trend: 0, games: 20, sd: 1 }, blowoutProbability: 0.2, baselineBlowout: 0.2, adjustments: [], availability: "ok" as const, note: "" };
    const favourite = projectRemainingMinutes({ player: "s", preGame: pre, minutesPlayed: 17, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: 40, fouls: 0, currentMargin: 12, expectedMargin: -12 });
    const underdog = projectRemainingMinutes({ player: "s", preGame: pre, minutesPlayed: 17, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: 40, fouls: 0, currentMargin: 12, expectedMargin: 12 });
    expect(favourite.expected).toBeLessThan(underdog.expected - 1);
    expect(favourite.adjustments.find((a) => a.kind === "margin")!.minutes).toBeLessThan(0);
  });
});

describe("form from a schedule", () => {
  const tipoff = new Date("2026-09-22T02:00Z");
  const games = [
    { id: "1", date: "2026-09-14T00:00Z", completed: true, ownScore: 80, oppScore: 70 },
    { id: "2", date: "2026-09-16T00:00Z", completed: true, ownScore: 90, oppScore: 95 },
    { id: "3", date: "2026-09-18T00:00Z", completed: true, ownScore: 97, oppScore: 77 },
    { id: "4", date: "2026-09-19T17:00Z", completed: true, ownScore: 87, oppScore: 82 },
    { id: "5", date: "2026-09-22T02:00Z", completed: false, ownScore: NaN, oppScore: NaN },
    { id: "6", date: "2026-09-24T02:00Z", completed: false, ownScore: NaN, oppScore: NaN },
  ];

  it("counts only games played before tip-off and reads rest from the last of them", () => {
    const f = formFromSchedule("DAL", games, tipoff)!;
    expect(f.games).toBe(4);
    expect(f.pointsFor).toBeCloseTo(88.5, 1);
    expect(f.averageTotal).toBeCloseTo((150 + 185 + 174 + 169) / 4, 1);
    expect(f.restDays).toBe(2);
    expect(f.backToBack).toBe(false);
    expect(f.gamesInLastWeek).toBe(3);
    expect(formFromSchedule("X", games.slice(0, 2), tipoff)).toBeNull();
  });

  it("flags a back-to-back", () => {
    const f = formFromSchedule("DAL", games, new Date("2026-09-20T02:00Z"))!;
    expect(f.backToBack).toBe(true);
  });
});

describe("the book line", () => {
  it("reads the home handicap from the pickcenter details when there is no live line", () => {
    const d = detail([{ provider: "DraftKings", details: "DAL -5.5", spread: 5.5, overUnder: 173.5 }]);
    expect(bookLine(d)).toEqual({ spread: 5.5, total: 173.5 });
    const homeFav = detail([{ provider: "DraftKings", details: "PHX -3", spread: 3, overUnder: 160 }]);
    expect(bookLine(homeFav).spread).toBe(-3);
  });

  it("prefers DraftKings' current line and falls back to the scoreboard odds", () => {
    const d = detail([{ provider: "DraftKings", details: "DAL -5.5", spread: 5.5, overUnder: 173.5 }]);
    const lines = [{ provider: "DraftKings", open: null, close: null, current: { homeMl: 2.85, awayMl: 1.44, draw: null, total: 174.5, over: 1.86, under: 1.95, spread: 6.5, homeSpread: 1.95, awaySpread: 1.86 } }];
    expect(bookLine(d, lines)).toEqual({ spread: 6.5, total: 174.5 });
    expect(bookLine(detail([], { overUnder: 165 }))).toEqual({ spread: null, total: 165 });
    // Without `details`, ESPN's spread is already the home handicap and keeps its sign.
    expect(bookLine(detail([{ provider: "DraftKings", spread: -3, overUnder: 160 }])).spread).toBe(-3);
    expect(bookLine(detail([{ provider: "DraftKings", spread: 5.5, overUnder: 173.5 }])).spread).toBe(5.5);
  });
});

describe("the environment block", () => {
  const home = { abbreviation: "PHX", games: 42, pointsFor: 84.4, pointsAgainst: 87.3, averageTotal: 171.7, last5Total: 168, last5Margin: -6, restDays: 2, backToBack: false, gamesInLastWeek: 3 };
  const away = { abbreviation: "DAL", games: 42, pointsFor: 89.1, pointsAgainst: 85.1, averageTotal: 174.2, last5Total: 176, last5Margin: 8, restDays: 1, backToBack: true, gamesInLastWeek: 4 };

  it("computes the pace delta and blowout risk and reads them out", () => {
    const env = environmentFrom(detail([]), home, away, { spread: 5.5, total: 178.5 });
    expect(env.seasonTotal).toBeCloseTo(172.95, 1);
    expect(env.paceDelta).toBeCloseTo(5.55, 1);
    expect(env.favourite).toBe("DAL");
    expect(env.blowoutProbability).toBeGreaterThan(env.baselineBlowout);
    expect(env.reading).toMatch(/faster night/);
    expect(env.reading).toMatch(/DAL on a back-to-back/);
    const text = environmentPrompt(env);
    expect(text).toMatch(/GAME ENVIRONMENT/);
    expect(text).toMatch(/pace delta \+5\.[56]/);
    expect(text).toMatch(/BACK-TO-BACK/);
    expect(text).toMatch(/favourite DAL/);
  });

  it("calls a big spread a blowout script and a pick'em a coin flip", () => {
    expect(environmentFrom(detail([]), home, away, { spread: -14, total: 170 }).reading).toMatch(/blowout risk \d+%.*favours their unders/);
    const flip = environmentFrom(detail([]), home, away, { spread: 0, total: 170 });
    expect(flip.reading).toMatch(/coin flip/);
    expect(flip.favourite).toBeNull();
    expect(environmentPrompt(null)).toMatch(/not computed/);
  });

  it("numbers the ESPN season by league", () => {
    expect(currentSeasonParam("wnba", new Date("2026-09-22T00:00Z"))).toBe(2026);
    expect(currentSeasonParam("nba", new Date("2026-09-22T00:00Z"))).toBe(2026);
    expect(currentSeasonParam("nba", new Date("2026-11-01T00:00Z"))).toBe(2027);
  });
});
